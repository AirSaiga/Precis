"""@fileoverview Regex 动作处理器模块

功能概述:
- 处理 AI 生成的 Regex CRUD 动作（ADD_REGEX / UPDATE_REGEX / DELETE_REGEX）
- 通过 core 层 writer 持久化 Regex YAML 文件
- 同步更新 project.precis.yaml 中的 RegexRef

架构设计:
- 复用 core/project/regex/writer.py 的 save_regex_node()
- 复用 core/project/manifest/writer.py 的 ensure_regex_ref() / save_manifest()
- 使用 RegexNodeFile Pydantic 模型确保类型安全
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.writer import ensure_regex_ref, save_manifest
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.regex.writer import save_regex_node
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)

VALID_MATCH_MODES = {"full", "partial", "extract"}


def process_regex_action(action: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """
    @methoddesc 处理 Regex 动作

    根据 actionType 分发到对应的处理函数。

    参数:
        action: 动作字典，包含 actionType 和 regexSpec
        workspace_path: 项目工作区路径

    返回:
        处理结果字典 {"success": bool, "message": str}
    """
    action_type = action.get("actionType", "")
    spec = action.get("regexSpec", {})

    if action_type == "ADD_REGEX":
        return _add_regex(spec, workspace_path)
    elif action_type == "UPDATE_REGEX":
        return _update_regex(spec, workspace_path)
    elif action_type == "DELETE_REGEX":
        return _delete_regex(spec, workspace_path)
    else:
        return {"success": False, "message": f"未知的 Regex 动作类型: {action_type}"}


def _add_regex(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """创建新的 Regex YAML 文件"""
    regex_name = spec.get("name", "")
    regex_id = spec.get("regexId") or spec.get("id") or regex_name
    pattern = spec.get("pattern", "")
    match_mode = spec.get("matchMode", "full")
    case_sensitive = spec.get("caseSensitive", False)
    description = spec.get("description")
    target_node_id = spec.get("targetNodeId")
    target_column = spec.get("targetColumn")

    if not regex_name:
        return {"success": False, "message": "Regex 名称不能为空"}
    if not pattern:
        return {"success": False, "message": "Regex 模式不能为空"}

    if match_mode not in VALID_MATCH_MODES:
        match_mode = "full"

    workspace = Path(workspace_path)
    regex_dir = workspace / "regex_nodes"
    regex_dir.mkdir(parents=True, exist_ok=True)

    regex_file = regex_dir / f"{regex_id}.regex.yaml"
    if regex_file.exists():
        return {"success": False, "message": f"Regex 文件已存在: {regex_id}.regex.yaml"}

    # 构建 source_ref
    source_ref = None
    if target_node_id and target_column:
        source_ref = {"table_id": target_node_id, "column_id": target_column}

    try:
        regex_node = RegexNodeFile(
            version=2,
            id=regex_id,
            name=regex_name,
            pattern=pattern,
            match_mode=match_mode,
            case_sensitive=case_sensitive,
            description=description,
            enabled=True,
            source_ref=source_ref,
            source_column_name=target_column,
        )
        save_regex_node(regex_node, regex_file)
    except Exception as e:
        return {"success": False, "message": f"写入 Regex 文件失败: {e}"}

    # 更新 manifest
    _ensure_manifest_regex_ref(workspace_path, regex_id)

    logger.info(f"[RegexHandler] 创建 Regex: {regex_id}")
    return {"success": True, "message": regex_id}


def _update_regex(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """更新现有 Regex"""
    regex_id = spec.get("regexId") or spec.get("id") or spec.get("name", "")

    if not regex_id:
        return {"success": False, "message": "缺少 Regex ID"}

    regex_file = _find_regex_file(workspace_path, regex_id)
    if not regex_file:
        return {"success": False, "message": f"Regex 文件不存在: {regex_id}"}

    try:
        with FileLock(str(regex_file)):
            with open(regex_file, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            if spec.get("pattern"):
                data["pattern"] = spec["pattern"]
            if spec.get("name"):
                data["name"] = spec["name"]
            if spec.get("matchMode"):
                data["match_mode"] = spec["matchMode"]
            if "caseSensitive" in spec:
                data["case_sensitive"] = spec["caseSensitive"]
            if "description" in spec:
                data["description"] = spec["description"]
            if spec.get("targetNodeId") and spec.get("targetColumn"):
                data["source_ref"] = {"table_id": spec["targetNodeId"], "column_id": spec["targetColumn"]}
                data["source_column_name"] = spec["targetColumn"]

            atomic_write_yaml(regex_file, data)

    except Exception as e:
        return {"success": False, "message": f"更新 Regex 失败: {e}"}

    logger.info(f"[RegexHandler] 更新 Regex: {regex_id}")
    return {"success": True, "message": regex_id}


def _delete_regex(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """删除 Regex 文件"""
    regex_id = spec.get("regexId") or spec.get("id") or spec.get("name", "")

    if not regex_id:
        return {"success": False, "message": "缺少 Regex ID"}

    regex_file = _find_regex_file(workspace_path, regex_id)
    if not regex_file:
        return {"success": False, "message": f"Regex 文件不存在: {regex_id}"}

    try:
        regex_file.unlink()
    except OSError as e:
        return {"success": False, "message": f"删除 Regex 文件失败: {e}"}

    _remove_manifest_regex_ref(workspace_path, regex_id)

    logger.info(f"[RegexHandler] 删除 Regex: {regex_id}")
    return {"success": True, "message": regex_id}


def _find_regex_file(workspace_path: str, regex_id: str) -> Path | None:
    """在工作区中查找 regex 文件"""
    # 检查多个可能的目录名
    for dirname in ("regex_nodes", "regex"):
        regex_dir = Path(workspace_path) / dirname
        if not regex_dir.exists():
            continue
        # 按 ID 精确匹配
        for rf in regex_dir.glob("*.yaml"):
            try:
                with open(rf, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if data.get("id") == regex_id or data.get("name") == regex_id:
                    return rf
            except Exception:
                continue
        # 按文件名匹配
        candidate = regex_dir / f"{regex_id}.regex.yaml"
        if candidate.exists():
            return candidate
        candidate = regex_dir / f"{regex_id}.yaml"
        if candidate.exists():
            return candidate

    return None


def _ensure_manifest_regex_ref(workspace_path: str, regex_id: str) -> None:
    """确保 manifest 中包含指定 Regex 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        ensure_regex_ref(manifest, regex_id)
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[RegexHandler] 更新 manifest 引用失败: {e}")


def _remove_manifest_regex_ref(workspace_path: str, regex_id: str) -> None:
    """从 manifest 中移除指定 Regex 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        manifest.regex_nodes = [r for r in manifest.regex_nodes if r.id != regex_id]
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[RegexHandler] 更新 manifest 引用失败: {e}")
