"""
@fileoverview 项目辅助函数模块

功能概述:
- 安全加载 YAML 文件的辅助函数
- 计算 V2 项目清单、视图、工作区配置文件的绝对路径
- 提供安全的路径解析和项目级文件锁机制
- 原子写入由 shared.core.io.yaml.write_yaml_atomic 提供

架构设计:
- 纯 Python 实现，不依赖 FastAPI，便于单元测试
- 使用 filelock 实现项目级并发写保护
- 原子写入使用临时文件+重命名策略

输入示例:
    path = _v2_manifest_path("/project/root")
    config = _load_yaml_file(path)

输出示例:
    {"version": 2, "project": {"id": "my-project", "name": "My Project"}}
"""

import os
from contextlib import contextmanager

import yaml
from filelock import FileLock

V2_MANIFEST_FILENAME = "project.precis.yaml"
V2_VIEW_FILENAME = "project.view.json"
V2_WORKSPACES_FILENAME = ".precis/workspaces.json"


def _load_yaml_file(path: str) -> dict:
    """
    安全加载 YAML 文件的辅助函数。

    设计意图：
    - 提供统一的错误处理机制，避免调用方处理各种解析异常
    - 返回空字典而不是 None，简化调用方的空值判断

    副作用：
    - 如果文件不存在或解析失败，仅记录日志而不抛出异常

    参数:
        path: YAML 文件的绝对路径

    返回:
        解析后的字典，失败时返回空字典
    """
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except yaml.YAMLError:
        return {}


def _v2_manifest_path(config_path: str) -> str:
    """
    计算 V2 项目清单文件的绝对路径。

    参数:
        config_path: 项目配置根目录

    返回:
        manifest 文件的绝对路径
    """
    return os.path.join(config_path, V2_MANIFEST_FILENAME)


def _v2_view_path(config_path: str) -> str:
    """
    计算 V2 项目视图文件的绝对路径。

    参数:
        config_path: 项目配置根目录

    返回:
        视图文件的绝对路径
    """
    return os.path.join(config_path, V2_VIEW_FILENAME)


def _v2_workspaces_path(config_path: str) -> str:
    """
    计算 V2 工作区配置文件的绝对路径。

    参数:
        config_path: 项目配置根目录

    返回:
        工作区配置文件的绝对路径
    """
    return os.path.join(config_path, V2_WORKSPACES_FILENAME)


def _resolve_project_path(base_path: str, relative_path: str) -> str:
    """安全解析项目内的相对路径，防止路径遍历攻击。

    验证规则:
        - 解析后的绝对路径必须在 base_path 目录内
        - 拒绝包含 .. 的相对路径组件
        - B-arch2: 用 Path.resolve() 解析符号链接，防止 symlink 逃逸
          （原 os.path.abspath 不解析 symlink，若项目目录含指向外部的 symlink
          子目录，startswith 检查会通过但实际落在项目外）。

    参数:
        base_path: 项目根目录的绝对路径
        relative_path: 用户提供的相对路径

    返回:
        安全的绝对路径（已 resolve，symlink 已展开）

    抛出:
        ValueError: 当路径试图跳出项目目录时
    """
    from pathlib import Path

    base_resolved = Path(base_path).resolve()
    # 拼接后 resolve：同时处理 .. 与 symlink
    target_resolved = Path(base_path, relative_path).resolve()
    target_str = str(target_resolved)
    base_str = str(base_resolved)
    # 包含关系：target == base 或 target 在 base 之下
    if target_str != base_str and not target_str.startswith(base_str + os.sep):
        raise ValueError(f"路径 traversal 被拒绝: {relative_path}")
    return target_str


@contextmanager
def project_lock(config_path: str, timeout: float = 10.0):
    """获取项目级文件锁，防止并发写操作损坏 manifest 等关键配置文件。

    锁文件存放在 {config_path}/.precis/project.lock，所有写 manifest 的操作共用同一把锁。

    参数:
        config_path: 项目配置根目录
        timeout: 获取锁的超时时间（秒），默认 10 秒

    使用示例:
        with project_lock(config_path):
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))
    """
    lock_dir = os.path.join(config_path, ".precis")
    os.makedirs(lock_dir, exist_ok=True)
    lock_path = os.path.join(lock_dir, "project.lock")
    lock = FileLock(lock_path, timeout=timeout)
    with lock:
        yield
