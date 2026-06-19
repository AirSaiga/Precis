"""
@fileoverview YAML 原子写入与文件锁模块

功能概述:
- 跨平台文件锁（Windows msvcrt / Unix fcntl）保证并发安全
- 原子性 YAML 文件写入（先写临时文件再重命名）
- 优先使用 ruamel.yaml 保留注释和格式，回退到标准 yaml

架构设计:
- FileLock 上下文管理器实现跨平台文件锁
- atomic_write_yaml 提供原子写入能力
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 文件锁导入（跨平台支持）
msvcrt: Any = None
fcntl: Any = None
_HAS_FILE_LOCK = False

try:
    # Windows
    import msvcrt

    _HAS_FILE_LOCK = True
    logger.debug("文件锁: 使用 Windows msvcrt 模式")
except ImportError:
    logger.debug("Windows文件锁模块未安装", exc_info=True)

if not _HAS_FILE_LOCK:
    try:
        # Unix/Linux/Mac
        import fcntl

        _HAS_FILE_LOCK = True
        logger.debug("文件锁: 使用 Unix fcntl 模式")
    except ImportError:
        pass

if not _HAS_FILE_LOCK:
    logger.warning("文件锁功能不可用，并发写入时可能存在竞态条件风险")


class ActionParseError(Exception):
    """
    @classdesc 动作解析异常

    当 LLM 返回的响应无法解析为有效 JSON 时抛出。
    """

    pass


class YamlUpdateError(Exception):
    """
    @classdesc YAML 更新异常

    当 YAML 文件的原子写入或文件锁操作失败时抛出。
    """

    pass


class FileLock:
    """
    @classdesc 跨平台文件锁上下文管理器

    支持 Windows(msvcrt) 和 Unix(fcntl) 两种文件锁实现，
    通过上下文管理器确保并发写入安全。

    使用场景:
    - 多个进程/线程同时写入同一 YAML 文件时防止数据损坏
    - 内联约束批量处理时的文件访问控制

    使用示例:
        with FileLock("/path/to/file.yaml"):
            # 独占访问文件
            with open("/path/to/file.yaml", 'w') as f:
                yaml.dump(data, f)
    """

    def __init__(self, file_path: str, timeout: float = 10.0):
        """
        @methoddesc 初始化文件锁

        参数:
            file_path: 要加锁的文件路径
            timeout: 获取锁的超时时间（秒），默认 10 秒
        """
        self.file_path = file_path
        self.timeout = timeout
        self.lock_file = None
        self.lock_path = f"{file_path}.lock"

    def __enter__(self):
        """
        @methoddesc 获取文件锁

        进入上下文时尝试获取文件锁，如果锁已被占用则等待，
        超过 timeout 时间后抛出 YamlUpdateError。

        返回:
            FileLock 实例自身
        """
        if not _HAS_FILE_LOCK:
            logger.debug(f"文件锁不可用，跳过加锁: {self.file_path}")
            return self

        import time

        start_time = time.time()

        while True:
            try:
                if msvcrt:
                    # Windows: 使用独占模式打开锁文件
                    self.lock_file = open(self.lock_path, "x")  # 独占创建
                else:
                    # Unix: 使用 fcntl 文件锁
                    self.lock_file = open(self.lock_path, "w")
                    fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

                logger.debug(f"获取文件锁成功: {self.lock_path}")
                return self

            except OSError as e:
                if self.lock_file:
                    self.lock_file.close()
                    self.lock_file = None

                if time.time() - start_time > self.timeout:
                    raise YamlUpdateError(f"获取文件锁超时: {self.lock_path}") from e

                time.sleep(0.1)  # 100ms 后重试

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        @methoddesc 释放文件锁

        退出上下文时释放文件锁并尝试删除锁文件。
        不会吞掉异常。

        返回:
            False（不吞掉异常）
        """
        if self.lock_file:
            try:
                # 只在有 fcntl 模块的系统上解锁（Unix）
                if fcntl is not None:
                    fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
                self.lock_file.close()

                # 尝试删除锁文件
                try:
                    os.remove(self.lock_path)
                except OSError:
                    logger.debug("删除锁文件失败", exc_info=True)

                logger.debug(f"释放文件锁: {self.lock_path}")
            except Exception as e:
                logger.warning(f"释放文件锁时出错: {e}")

        return False  # 不吞掉异常


def atomic_write_yaml(file_path: Path, data: dict[str, Any], preserve_format: bool = True) -> None:
    """
    @methoddesc 原子性写入 YAML 文件

    先写入临时文件，再重命名，确保不会因为崩溃导致原文件损坏。
    当 preserve_format=True 且文件存在时，使用 ruamel.yaml 保留注释和空行。

    参数:
        file_path: 目标文件路径
        data: 要写入的数据字典
        preserve_format: 是否保留原有格式（注释、空行等）

    异常:
        YamlUpdateError: 写入失败时抛出

    示例:
        >>> atomic_write_yaml(Path("config.yaml"), {"version": 2})
    """
    import yaml  # type: ignore[import-untyped]

    file_path = Path(file_path)

    try:
        # 如果文件已存在且需要保留格式，使用 ruamel.yaml
        if preserve_format and file_path.exists():
            try:
                from ruamel.yaml import YAML

                # 使用 ruamel.yaml 加载保留格式的 YAML
                yaml_parser = YAML()
                yaml_parser.preserve_quotes = True
                yaml_parser.default_flow_style = False

                with open(file_path, encoding="utf-8") as f:
                    existing_data = yaml_parser.load(f)

                if existing_data is not None:
                    # 递归更新数据，保留格式
                    _update_yaml_data(existing_data, data)

                    # 原子性写入
                    fd, temp_path = tempfile.mkstemp(
                        dir=file_path.parent, prefix=f".{file_path.stem}_tmp_", suffix=".yaml"
                    )

                    try:
                        with os.fdopen(fd, "w", encoding="utf-8") as f:
                            yaml_parser.dump(existing_data, f)
                        os.replace(temp_path, file_path)
                        logger.debug(f"原子写入成功(保留格式): {file_path}")
                        return
                    except OSError:
                        try:
                            os.remove(temp_path)
                        except OSError:
                            logger.debug("删除临时文件失败", exc_info=True)
                        raise
            except ImportError:
                logger.warning("ruamel.yaml 未安装，无法保留 YAML 格式")
            except Exception as e:
                logger.warning(f"使用 ruamel.yaml 失败，回退到标准方式: {e}")

        # 标准写入方式（不保留格式）
        fd, temp_path = tempfile.mkstemp(dir=file_path.parent, prefix=f".{file_path.stem}_tmp_", suffix=".yaml")

        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)

            os.replace(temp_path, file_path)
            logger.debug(f"原子写入成功: {file_path}")

        except OSError:
            try:
                os.remove(temp_path)
            except OSError:
                logger.debug("删除临时文件失败", exc_info=True)
            raise

    except Exception as e:
        raise YamlUpdateError(f"原子写入失败: {file_path}") from e


def _update_yaml_data(existing: Any, new: Any) -> None:
    """
    @methoddesc 递归更新 YAML 数据，保留现有格式

    用于 ruamel.yaml 加载的数据结构，在保留注释和格式的前提下递归更新数据。

    参数:
        existing: 现有的 YAML 数据结构（来自 ruamel.yaml）
        new: 新的数据字典
    """
    from ruamel.yaml.comments import CommentedMap, CommentedSeq

    if isinstance(existing, CommentedMap) and isinstance(new, dict):
        # 更新或添加键值
        for key, value in new.items():
            if key in existing:
                if isinstance(value, dict) and isinstance(existing[key], CommentedMap):
                    _update_yaml_data(existing[key], value)
                elif isinstance(value, list) and isinstance(existing[key], CommentedSeq):
                    _update_yaml_list(existing[key], value)
                else:
                    existing[key] = value
            else:
                # 新键，直接添加
                existing[key] = value
    elif isinstance(existing, CommentedSeq) and isinstance(new, list):
        _update_yaml_list(existing, new)


def _update_yaml_list(existing_list: Any, new_list: list) -> None:
    """
    @methoddesc 更新 YAML 列表，保留现有格式

    用于更新 constraints 等列表，根据 id 匹配更新现有项或添加新项。
    没有 id 的项直接追加到列表末尾。

    参数:
        existing_list: 现有的 YAML 列表（来自 ruamel.yaml）
        new_list: 新的数据列表
    """
    from ruamel.yaml.comments import CommentedMap

    if not new_list:
        return

    # 为现有项建立 id 到索引的映射
    existing_ids = {}
    for idx, item in enumerate(existing_list):
        if isinstance(item, CommentedMap) and "id" in item:
            existing_ids[item["id"]] = idx

    # 处理新列表中的每一项
    for new_item in new_list:
        if isinstance(new_item, dict) and "id" in new_item:
            item_id = new_item["id"]
            if item_id in existing_ids:
                # 更新现有项
                idx = existing_ids[item_id]
                existing_item = existing_list[idx]
                if isinstance(existing_item, CommentedMap):
                    _update_yaml_data(existing_item, new_item)
                else:
                    existing_list[idx] = new_item
            else:
                # 添加新项
                existing_list.append(new_item)
        else:
            # 没有 id 的项，直接添加
            if new_item not in existing_list:
                existing_list.append(new_item)
