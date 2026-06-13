"""@fileoverview Schema 动作处理器模块

功能概述:
- 处理 AI 生成的 Schema CRUD 动作（ADD_SCHEMA / UPDATE_SCHEMA / DELETE_SCHEMA）
- 通过 core 层 writer 持久化 Schema YAML 文件
- 同步更新 project.precis.yaml 中的 SchemaRef

架构设计:
- 复用 core/project/schema/writer.py 的 save_schema()
- 复用 core/project/manifest/writer.py 的 ensure_schema_ref() / save_manifest()
- 使用 atomic_write_yaml 保证文件写入安全
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.writer import ensure_schema_ref, save_manifest
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)

VALID_DATA_TYPES = {"string", "integer", "decimal", "boolean", "datetime", "date", "time", "float"}


def _sanitize_resource_id(resource_id: str) -> str:
    cleaned = os.path.basename(resource_id)
    if "/" in resource_id or "\\" in resource_id or ".." in resource_id:
        raise ValueError(f"非法的资源 ID: {resource_id!r}")
    return cleaned


def process_schema_action(action: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """
    @methoddesc 处理 Schema 动作

    根据 actionType 分发到对应的处理函数：
    - ADD_SCHEMA: 创建新的 Schema YAML 文件
    - UPDATE_SCHEMA: 修改现有 Schema 的列定义或数据源
    - DELETE_SCHEMA: 删除 Schema YAML 文件并移除 manifest 引用

    参数:
        action: 动作字典，包含 actionType 和 schemaSpec
        workspace_path: 项目工作区路径

    返回:
        处理结果字典 {"success": bool, "message": str}
    """
    action_type = action.get("actionType", "")
    spec = action.get("schemaSpec", {})

    if action_type == "ADD_SCHEMA":
        return _add_schema(spec, workspace_path)
    elif action_type == "UPDATE_SCHEMA":
        return _update_schema(spec, workspace_path)
    elif action_type == "DELETE_SCHEMA":
        return _delete_schema(spec, workspace_path)
    else:
        return {"success": False, "message": f"未知的 Schema 动作类型: {action_type}"}


def _add_schema(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """创建新的 Schema YAML 文件"""
    schema_name = spec.get("name", "")
    schema_id = spec.get("schemaId") or spec.get("id") or schema_name
    try:
        schema_id = _sanitize_resource_id(schema_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Schema ID: {schema_id}"}
    columns = spec.get("columns", [])
    source = spec.get("source")

    if not schema_name:
        return {"success": False, "message": "Schema 名称不能为空"}

    workspace = Path(workspace_path)
    schemas_dir = workspace / "schemas"
    schemas_dir.mkdir(parents=True, exist_ok=True)

    # 检查是否已存在同名 Schema
    schema_file = schemas_dir / f"{schema_id}.schema.yaml"
    if schema_file.exists():
        return {"success": False, "message": f"Schema 文件已存在: {schema_id}.schema.yaml"}

    # 构建列定义
    column_defs = []
    for i, col in enumerate(columns):
        col_name = col.get("name", f"col_{i}")
        col_type = col.get("type", "string")
        if col_type not in VALID_DATA_TYPES:
            col_type = "string"
        column_defs.append(
            {
                "id": col_name,
                "name": col_name,
                "type": col_type,
            }
        )

    # 构建 schema 数据
    schema_data: dict[str, Any] = {
        "version": 2,
        "id": schema_id,
        "name": schema_name,
        "columns": column_defs,
    }

    if source:
        source_path = source.get("path", "")
        if source_path and (".." in source_path or os.path.isabs(source_path)):
            return {"success": False, "message": f"source.path 不允许绝对路径或目录穿越: {source_path}"}
        schema_data["source"] = source
    try:
        with FileLock(str(schema_file)):
            atomic_write_yaml(schema_file, schema_data)
    except Exception as e:
        return {"success": False, "message": f"写入 Schema 文件失败: {e}"}

    # 更新 manifest
    _ensure_manifest_schema_ref(workspace_path, schema_id)

    logger.info(f"[SchemaHandler] 创建 Schema: {schema_id}")
    return {"success": True, "message": schema_id}


def _update_schema(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """更新现有 Schema"""
    schema_id = spec.get("schemaId") or spec.get("id") or spec.get("name", "")
    try:
        schema_id = _sanitize_resource_id(schema_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Schema ID: {schema_id}"}
    columns = spec.get("columns")
    source = spec.get("source")

    if not schema_id:
        return {"success": False, "message": "缺少 Schema ID"}

    schema_file = _find_schema_file(workspace_path, schema_id)
    if not schema_file:
        return {"success": False, "message": f"Schema 文件不存在: {schema_id}"}

    try:
        with FileLock(str(schema_file)):
            with open(schema_file, encoding="utf-8") as f:
                schema_data = yaml.safe_load(f) or {}

            # 更新列定义
            if columns is not None:
                existing_cols = {c.get("name"): c for c in schema_data.get("columns", [])}
                updated_cols = []
                for col in columns:
                    col_name = col.get("name", "")
                    col_type = col.get("type", "string")
                    if col_type not in VALID_DATA_TYPES:
                        col_type = "string"
                    if col_name in existing_cols:
                        # 更新已有列
                        existing = existing_cols[col_name]
                        existing["type"] = col_type
                        updated_cols.append(existing)
                    else:
                        # 新增列
                        updated_cols.append(
                            {
                                "id": col_name,
                                "name": col_name,
                                "type": col_type,
                            }
                        )
                # 保留未在更新列表中的列
                updated_names = {c.get("name") for c in updated_cols}
                for col in schema_data.get("columns", []):
                    if col.get("name") not in updated_names:
                        updated_cols.append(col)
                schema_data["columns"] = updated_cols

            # 更新数据源
            if source is not None:
                source_path = source.get("path", "")
                if source_path and (".." in source_path or os.path.isabs(source_path)):
                    return {"success": False, "message": "source.path 不允许绝对路径或目录穿越"}
                schema_data["source"] = source

            atomic_write_yaml(schema_file, schema_data)

    except Exception as e:
        return {"success": False, "message": f"更新 Schema 失败: {e}"}

    logger.info(f"[SchemaHandler] 更新 Schema: {schema_id}")
    return {"success": True, "message": schema_id}


def _delete_schema(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """删除 Schema 文件"""
    schema_id = spec.get("schemaId") or spec.get("id") or spec.get("name", "")
    try:
        schema_id = _sanitize_resource_id(schema_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Schema ID: {schema_id}"}

    if not schema_id:
        return {"success": False, "message": "缺少 Schema ID"}

    schema_file = _find_schema_file(workspace_path, schema_id)
    if not schema_file:
        return {"success": False, "message": f"Schema 文件不存在: {schema_id}"}

    try:
        schema_file.unlink()
    except OSError as e:
        return {"success": False, "message": f"删除 Schema 文件失败: {e}"}

    # 从 manifest 移除引用
    _remove_manifest_schema_ref(workspace_path, schema_id)

    logger.info(f"[SchemaHandler] 删除 Schema: {schema_id}")
    return {"success": True, "message": schema_id}


def _find_schema_file(workspace_path: str, schema_id: str) -> Path | None:
    """在工作区中查找 schema 文件"""
    schemas_dir = Path(workspace_path) / "schemas"
    if not schemas_dir.exists():
        return None

    # 先按 ID 精确匹配
    for sf in schemas_dir.glob("*.yaml"):
        try:
            with open(sf, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if data.get("id") == schema_id or data.get("name") == schema_id:
                return sf
        except Exception:
            continue

    # 再按文件名匹配
    candidate = schemas_dir / f"{schema_id}.schema.yaml"
    if candidate.exists():
        return candidate
    candidate = schemas_dir / f"{schema_id}.yaml"
    if candidate.exists():
        return candidate

    return None


def _ensure_manifest_schema_ref(workspace_path: str, schema_id: str) -> None:
    """确保 manifest 中包含指定 Schema 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        ensure_schema_ref(manifest, schema_id)
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[SchemaHandler] 更新 manifest 引用失败: {e}")


def _remove_manifest_schema_ref(workspace_path: str, schema_id: str) -> None:
    """从 manifest 中移除指定 Schema 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        manifest.schemas = [s for s in manifest.schemas if s.id != schema_id]
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[SchemaHandler] 更新 manifest 引用失败: {e}")
