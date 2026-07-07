# backend/app/cli/shared_services/project_ops.py
"""
@fileoverview 项目操作共享逻辑（CLI/TUI 同源）

功能概述:
- 收敛「打开项目」相关的纯业务逻辑：历史记录读写、清单定位与加载、项目显示名解析
- 供 CLI 的 open 命令与未来 TUI 的项目管理屏共同调用，确保「改一处即可」

架构设计:
- 本模块只含纯逻辑与文件 IO，不含任何 UI/交互（InteractiveMenu 等留在各 UI 层）
- 历史记录持久化到 ~/.precis_project_history，去重 + MAX_HISTORY 容量上限
- 清单加载复用 shared/core 的 load_manifest，保证解析与系统其余部分一致

接口契约（P0b 冻结）:
    def load_history() -> list[dict]
    def add_to_history(project_path: str) -> None
    def find_manifest(project_path: str) -> str | None
    def load_manifest_config(manifest_path: str) -> dict | None
    def resolve_project_label(project_path: str) -> str
    def open_project(project_path: str) -> OpenResult
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# 历史记录文件路径：存储在用户主目录下
HISTORY_FILE = os.path.expanduser("~/.precis_project_history")
# 最大历史记录数量，超过时会自动丢弃最旧的项目
MAX_HISTORY = 10


def load_history() -> list[dict]:
    """加载项目打开历史。

    从 HISTORY_FILE 读取历史记录。文件不存在、格式损坏或权限不足时返回空列表。

    Returns:
        历史记录列表，每个元素为包含 path 和 last_opened 的字典
    """
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except json.JSONDecodeError:
        # JSON 格式损坏，返回空列表
        return []
    except PermissionError:
        # 无权限读取，返回空列表
        return []
    except OSError:
        # 其他操作系统错误（如文件被锁定），返回空列表
        return []


def _save_history(history: list[dict]) -> None:
    """保存项目打开历史。

    将历史记录写入 HISTORY_FILE。保存失败仅记录日志，不阻断主流程。

    Args:
        history: 历史记录列表
    """
    try:
        # 确保目录存在（用户主目录）
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except (PermissionError, OSError):
        # 保存失败时记录错误日志，但不阻断主流程
        logging.error("保存项目历史记录失败", exc_info=True)


def add_to_history(project_path: str) -> None:
    """将项目路径添加到历史记录顶部。

    如果路径已存在，先移除旧记录，再插入到顶部。超过 MAX_HISTORY 时自动截断。

    Args:
        project_path: 项目的绝对路径
    """
    history = load_history()
    # 去重：移除已存在的相同路径
    history = [h for h in history if h.get("path") != project_path]
    # 插入到列表头部（最新的项目）
    history.insert(0, {"path": project_path, "last_opened": None})
    # 容量控制：只保留最近的 MAX_HISTORY 个项目
    if len(history) > MAX_HISTORY:
        history = history[:MAX_HISTORY]
    _save_history(history)


def find_manifest(project_path: str) -> str | None:
    """定位项目清单文件，兼容 .yaml / .yml 后缀。

    Args:
        project_path: 项目根目录绝对路径

    Returns:
        清单文件绝对路径；不存在则返回 None
    """
    # 优先 .yaml 后缀（项目规范）
    primary = os.path.join(project_path, "project.precis.yaml")
    if os.path.isfile(primary):
        return primary
    # 兼容 .yml 后缀
    alt = os.path.join(project_path, "project.precis.yml")
    if os.path.isfile(alt):
        return alt
    return None


def load_manifest_config(manifest_path: str) -> dict | None:
    """加载并序列化清单为字典。

    复用 shared/core 中的 load_manifest 以保持与系统其余部分解析一致，
    返回 model_dump() 字典以匹配 project_config 的 dict 消费约定。

    Args:
        manifest_path: 清单文件绝对路径

    Returns:
        清单配置字典；解析失败时返回 None（由调用方决定如何提示）
    """
    try:
        # 延迟导入：避免在未使用时引入 shared.core 的依赖链。
        # 注意 manifest 为 namespace package，需直接从 reader 子模块导入。
        from app.shared.core.project.manifest.reader import load_manifest

        manifest = load_manifest(manifest_path)
        return manifest.model_dump(exclude_none=True)
    except Exception as e:
        # 记录日志但不抛出，避免加载失败阻断项目切换
        logging.warning("加载项目清单失败: %s", e, exc_info=True)
        return None


def resolve_project_label(project_path: str) -> str:
    """解析项目用于菜单显示的名称。

    优先读取 project.precis.yaml 中的 project.name，失败则降级为目录名。
    用于交互菜单 label，不做完整项目加载。

    Args:
        project_path: 项目根目录绝对路径

    Returns:
        项目显示名称
    """
    manifest_path = find_manifest(project_path)
    if manifest_path is not None:
        config = load_manifest_config(manifest_path)
        if config is not None:
            name = config.get("project", {}).get("name")
            if name:
                return str(name)
    # 降级：目录名
    return os.path.basename(project_path) or project_path


@dataclass
class OpenResult:
    """打开项目纯逻辑的结果。

    Attributes:
        success: 是否成功打开
        project_path: 项目绝对路径
        config: 清单配置字典（无清单或加载失败时为 None）
        manifest_path: 清单文件绝对路径；未找到时为 None
        message: 给用户的消息文案（与原 CLI 文案保持一致，保证零回归）
    """

    success: bool
    project_path: str
    config: dict | None
    manifest_path: str | None
    message: str


def open_project(project_path: str) -> OpenResult:
    """打开项目的纯逻辑（存在性校验 + 写历史 + 加载清单）。

    不修改任何 UI 上下文，仅返回 OpenResult 由调用方（CLI/TUI）自行更新各自上下文。
    消息文案与原 open.py 保持完全一致，确保 CLI 零回归。

    Args:
        project_path: 项目目录的绝对路径

    Returns:
        OpenResult：包含成功标志、配置、清单路径与消息文案
    """
    if not os.path.exists(project_path):
        return OpenResult(
            success=False,
            project_path=project_path,
            config=None,
            manifest_path=None,
            message=f"项目路径不存在: {project_path}",
        )
    if not os.path.isdir(project_path):
        return OpenResult(
            success=False,
            project_path=project_path,
            config=None,
            manifest_path=None,
            message=f"路径不是目录: {project_path}",
        )

    # 写入历史记录
    add_to_history(project_path)

    # 定位清单文件，兼容 .yaml / .yml 两种后缀
    manifest_path = find_manifest(project_path)

    # 加载清单，加载失败不阻断切换项目，仅清空配置并给出警告
    config: dict | None = None
    load_warning = ""
    if manifest_path is not None:
        loaded = load_manifest_config(manifest_path)
        if loaded is not None:
            config = loaded
        else:
            config = None
            load_warning = "\n警告：project.precis.yaml 存在但解析失败，配置未加载"

    msg = f"已切换到项目: {project_path}"
    if manifest_path is not None:
        msg += "\n检测到项目清单文件 (project.precis.yaml)"
    else:
        msg += "\n警告：未找到 project.precis.yaml，可能需要初始化项目"
    msg += load_warning

    return OpenResult(
        success=True,
        project_path=project_path,
        config=config,
        manifest_path=manifest_path,
        message=msg,
    )


__all__ = [
    "HISTORY_FILE",
    "MAX_HISTORY",
    "OpenResult",
    "add_to_history",
    "find_manifest",
    "load_history",
    "load_manifest_config",
    "open_project",
    "resolve_project_label",
]
