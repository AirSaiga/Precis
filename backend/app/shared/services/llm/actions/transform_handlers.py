"""@fileoverview Transform 动作处理器模块

功能概述:
- 处理 AI 生成的 Transform CRUD 动作（ADD_TRANSFORM / UPDATE_TRANSFORM / DELETE_TRANSFORM）
- 通过 core 层 writer 持久化 Transform YAML 文件
- 同步更新 project.precis.yaml 中的 TransformRef

架构设计:
- 复用 core/project/transform/writer.py 的 save_transform()
- 复用 TransformFile Pydantic 模型确保类型安全
- 使用 atomic_write_yaml 保证文件写入安全
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.types import TransformRef
from app.shared.core.project.manifest.writer import save_manifest
from app.shared.core.project.transform.types import TransformFile
from app.shared.core.project.transform.writer import save_transform
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)

# 转换子类型白名单从注册表派生（单一事实源）
from app.shared.services.llm.actions.registry import TRANSFORM_SUB_TYPES as VALID_TRANSFORM_TYPES


def _sanitize_resource_id(resource_id: str) -> str:
    cleaned = os.path.basename(resource_id)
    if "/" in resource_id or "\\" in resource_id or ".." in resource_id:
        raise ValueError(f"非法的资源 ID: {resource_id!r}")
    return cleaned


def process_transform_action(action: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """
    @methoddesc 处理 Transform 动作

    根据 actionType 分发到对应的处理函数。

    参数:
        action: 动作字典，包含 actionType 和 transformSpec
        workspace_path: 项目工作区路径

    返回:
        处理结果字典 {"success": bool, "message": str}
    """
    action_type = action.get("actionType", "")
    spec = action.get("transformSpec", {})

    if action_type == "ADD_TRANSFORM":
        return _add_transform(spec, workspace_path)
    elif action_type == "UPDATE_TRANSFORM":
        return _update_transform(spec, workspace_path)
    elif action_type == "DELETE_TRANSFORM":
        return _delete_transform(spec, workspace_path)
    else:
        return {"success": False, "message": f"未知的 Transform 动作类型: {action_type}"}


def _add_transform(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """创建新的 Transform YAML 文件"""
    transform_type = spec.get("type", "")
    transform_id = spec.get("transformId") or spec.get("id") or _generate_transform_id(transform_type)
    try:
        transform_id = _sanitize_resource_id(transform_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Transform ID: {transform_id}"}
    description = spec.get("description")
    input_from_node = spec.get("inputFromNode")
    input_column = spec.get("inputColumn")
    params = spec.get("params", {})
    output_columns = spec.get("outputColumns", [])

    if not transform_type:
        return {"success": False, "message": "Transform 类型不能为空"}

    if transform_type not in VALID_TRANSFORM_TYPES:
        return {"success": False, "message": f"不支持的 Transform 类型: {transform_type}"}

    workspace = Path(workspace_path)
    transforms_dir = workspace / "transforms"
    transforms_dir.mkdir(parents=True, exist_ok=True)

    transform_file = transforms_dir / f"{transform_id}.transform.yaml"
    if transform_file.exists():
        # 提示 Agent 改用 ADD_TO_CANVAS（同 schema_handlers 的引导逻辑）
        return {
            "success": False,
            "message": (
                f"Transform 文件已存在: {transform_id}.transform.yaml。"
                f"若用户想把已存在的资源显示到画布，请改用 actionType=ADD_TO_CANVAS"
                f"（canvasSpec.resourceKind='transform'），它不会重复创建文件。"
            ),
        }

    try:
        transform = TransformFile(
            version=2,
            id=transform_id,
            type=transform_type,
            enabled=True,
            description=description,
            input_from_node=input_from_node,
            input_column=input_column,
            params=params,
            output_columns=output_columns,
        )
        save_transform(transform, transform_file)
    except Exception as e:
        return {"success": False, "message": f"写入 Transform 文件失败: {e}"}

    # 更新 manifest
    _ensure_manifest_transform_ref(workspace_path, transform_id)

    logger.info(f"[TransformHandler] 创建 Transform: {transform_id}")
    return {"success": True, "message": transform_id}


def _update_transform(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """更新现有 Transform"""
    transform_id = spec.get("transformId") or spec.get("id", "")
    try:
        transform_id = _sanitize_resource_id(transform_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Transform ID: {transform_id}"}

    if not transform_id:
        return {"success": False, "message": "缺少 Transform ID"}

    transform_file = _find_transform_file(workspace_path, transform_id)
    if not transform_file:
        return {"success": False, "message": f"Transform 文件不存在: {transform_id}"}

    try:
        with FileLock(str(transform_file)):
            with open(transform_file, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            if spec.get("type") and spec["type"] in VALID_TRANSFORM_TYPES:
                data["type"] = spec["type"]
            if "description" in spec:
                data["description"] = spec["description"]
            if "params" in spec:
                data["params"] = spec["params"]
            if "inputFromNode" in spec:
                data["input_from_node"] = spec["inputFromNode"]
            if "inputColumn" in spec:
                data["input_column"] = spec["inputColumn"]
            if "outputColumns" in spec:
                data["output_columns"] = spec["outputColumns"]

            atomic_write_yaml(transform_file, data)

    except Exception as e:
        return {"success": False, "message": f"更新 Transform 失败: {e}"}

    logger.info(f"[TransformHandler] 更新 Transform: {transform_id}")
    return {"success": True, "message": transform_id}


def _delete_transform(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """删除 Transform 文件"""
    transform_id = spec.get("transformId") or spec.get("id", "")
    try:
        transform_id = _sanitize_resource_id(transform_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Transform ID: {transform_id}"}

    if not transform_id:
        return {"success": False, "message": "缺少 Transform ID"}

    transform_file = _find_transform_file(workspace_path, transform_id)
    if not transform_file:
        return {"success": False, "message": f"Transform 文件不存在: {transform_id}"}

    try:
        transform_file.unlink()
    except OSError as e:
        return {"success": False, "message": f"删除 Transform 文件失败: {e}"}

    _remove_manifest_transform_ref(workspace_path, transform_id)

    logger.info(f"[TransformHandler] 删除 Transform: {transform_id}")
    return {"success": True, "message": transform_id}


def _find_transform_file(workspace_path: str, transform_id: str) -> Path | None:
    """在工作区中查找 transform 文件"""
    transforms_dir = Path(workspace_path) / "transforms"
    if not transforms_dir.exists():
        return None

    for tf in transforms_dir.glob("*.yaml"):
        try:
            with open(tf, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if data.get("id") == transform_id:
                return tf
        except Exception:
            continue

    candidate = transforms_dir / f"{transform_id}.transform.yaml"
    if candidate.exists():
        return candidate

    return None


def _generate_transform_id(transform_type: str) -> str:
    """生成 Transform ID"""
    import re

    safe = re.sub(r"[^a-z0-9_]", "_", transform_type.lower())
    return f"{safe}_{_short_hash()}"


def _short_hash() -> str:
    """生成短随机哈希"""
    import random

    return f"{random.randint(100, 999)}"


def _ensure_manifest_transform_ref(workspace_path: str, transform_id: str) -> None:
    """确保 manifest 中包含指定 Transform 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        existing = next((t for t in manifest.transforms if t.id == transform_id), None)
        if not existing:
            manifest.transforms.append(TransformRef(id=transform_id, path=f"transforms/{transform_id}.transform.yaml"))
            save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[TransformHandler] 更新 manifest 引用失败: {e}")


def _remove_manifest_transform_ref(workspace_path: str, transform_id: str) -> None:
    """从 manifest 中移除指定 Transform 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        manifest.transforms = [t for t in manifest.transforms if t.id != transform_id]
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[TransformHandler] 更新 manifest 引用失败: {e}")
