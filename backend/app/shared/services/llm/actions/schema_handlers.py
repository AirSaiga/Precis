# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
from app.shared.core.project.schema_ref_check import find_schema_references, format_reference_report
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml, read_entity_id
from app.shared.services.schema_inference import infer_schema

logger = logging.getLogger(__name__)

# 数据类型白名单从注册表派生（单一事实源）
from app.shared.services.llm.actions.registry import DATA_TYPES as VALID_DATA_TYPES


def _infer_columns_from_source(source: dict[str, Any], workspace_path: str) -> tuple[list[dict[str, Any]] | None, str]:
    """从 source.path 指向的数据文件推断列定义。

    LLM 建 schema 常只给表名 + 文件路径（省略 columns），落盘空壳会让后续
    约束动作全部挂在"字段不存在"预验证上。此兜底复用 schema_inference 的
    头部采样推断，让"发现文件 → 建表 → 挂约束"的初始化工作流闭环。

    :param source: schema 的 source 配置（含相对项目根的 path）
    :param workspace_path: 项目根路径
    :return: (columns, message)。成功时 columns 非空、message 描述推断结果；
        失败时 columns 为 None、message 携带给 LLM 的修正指引。
    """
    rel = str(source.get("path") or "")
    if not rel:
        return None, "source.path 为空，无法从数据文件推断列"
    # 纵深防御：调用方已前置穿越校验，此处再独立拒绝绝对路径/..（防新增调用点漏检）
    if os.path.isabs(rel) or ".." in rel:
        return None, f"source.path 不允许绝对路径或目录穿越: {rel}"
    data_file = Path(workspace_path) / rel
    if not data_file.is_file():
        return None, f"source.path 指向的数据文件不存在: {rel}（请用相对项目根的路径，可用 list_data_files 工具确认）"
    try:
        draft = infer_schema(data_file, table_id="_infer", table_name="_infer", source_path=rel)
    except Exception as e:
        return None, f"从数据文件推断列失败（{rel}）: {e}"
    cols = draft.get("columns") or []
    if not cols:
        return None, f"数据文件无表头或无数据行，无法推断列: {rel}"
    return cols, f"columns 已从数据文件自动推断（{len(cols)} 列，源自 {rel}）"


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

    # source.path 安全校验前置——必须先于列推断（推断要按此路径读文件，
    # 绝对路径/穿越若晚于此检查会先被推断逻辑当合法路径碰到）
    if isinstance(source, dict):
        source_path = str(source.get("path") or "")
        if source_path and (".." in source_path or os.path.isabs(source_path)):
            return {"success": False, "message": f"source.path 不允许绝对路径或目录穿越: {source_path}"}

    # 列为空但给了 source.path：从数据文件推断兜底。LLM 常只给表名+路径，
    # 空壳 schema 会让后续约束动作全部挂在"字段不存在"预验证上；文件读不了
    # 则直接失败并把修正指引回灌给 LLM（静默建空壳等于把坑留给下一轮）
    inferred_note = ""
    if not columns and isinstance(source, dict) and source.get("path"):
        inferred, note = _infer_columns_from_source(source, workspace_path)
        if inferred is None:
            return {"success": False, "message": note}
        columns = inferred
        inferred_note = f"；{note}"

    workspace = Path(workspace_path)
    schemas_dir = workspace / "schemas"
    schemas_dir.mkdir(parents=True, exist_ok=True)

    # 检查是否已存在同名 Schema
    schema_file = schemas_dir / f"{schema_id}.schema.yaml"
    if schema_file.exists():
        # 提示 Agent 改用 ADD_TO_CANVAS：用户的意图很可能是"把已存在的资源显示到画布"
        # 而非"创建新文件"。把建议写进 message 让 LLM 自我修正。
        return {
            "success": False,
            "message": (
                f"Schema 文件已存在: {schema_id}.schema.yaml。"
                f"若用户想把已存在的资源显示到画布，请改用 actionType=ADD_TO_CANVAS"
                f"（canvasSpec.resourceKind='schema'），它不会重复创建文件。"
            ),
        }

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
        schema_data["source"] = source
    try:
        with FileLock(str(schema_file)):
            atomic_write_yaml(schema_file, schema_data)
    except Exception as e:
        return {"success": False, "message": f"写入 Schema 文件失败: {e}"}

    # 更新 manifest —— 失败时回滚已写入的 schema 文件，避免产生孤儿文件
    try:
        _ensure_manifest_schema_ref(workspace_path, schema_id)
    except Exception as e:
        logger.error(f"[SchemaHandler] 登记到 manifest 失败，回滚 schema 文件: {e}")
        try:
            schema_file.unlink(missing_ok=True)
        except OSError as rollback_err:
            logger.error(f"[SchemaHandler] 回滚 schema 文件失败: {rollback_err}")
        return {"success": False, "message": f"更新 manifest 引用失败: {e}"}

    logger.info(f"[SchemaHandler] 创建 Schema: {schema_id}")
    return {"success": True, "message": f"{schema_id}{inferred_note}"}


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

            # source 安全校验前置（原在末尾）：列推断要按 source.path 读文件，
            # 穿越/绝对路径必须先于此被拒绝
            if isinstance(source, dict):
                source_path = str(source.get("path") or "")
                if source_path and (".." in source_path or os.path.isabs(source_path)):
                    return {"success": False, "message": "source.path 不允许绝对路径或目录穿越"}

            # 空壳 schema 修复：未传 columns 但现有列为空且 source 有效（传入的
            # 或文件里已有的）→ 从数据文件推断回填。推断失败不阻断本次更新
            # （UPDATE 可能只想改 source；空壳维持原状由其他链路报告）
            effective_source = source if isinstance(source, dict) else schema_data.get("source")
            if (
                columns is None
                and not schema_data.get("columns")
                and isinstance(effective_source, dict)
                and effective_source.get("path")
            ):
                inferred, note = _infer_columns_from_source(effective_source, workspace_path)
                if inferred is not None:
                    schema_data["columns"] = inferred
                    logger.info(f"[SchemaHandler] UPDATE_SCHEMA 回填空壳列: {note}")

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

            # 更新数据源（安全校验已前置）
            if source is not None:
                schema_data["source"] = source

            # §2.10: UPDATE 显式整体替换语义——preserve_format 默认 True 的递归合并
            # "只增不删"，被删掉的列/字段会残留在文件里
            atomic_write_yaml(schema_file, schema_data, preserve_format=False)

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

    # §2.6: 删除前引用检查——与 REST DELETE /schemas/{id} 的 409 守卫同一套逻辑
    # （公共函数 find_schema_references 单一事实源）。AI 不能成为绕开引用守卫的后门：
    # 有引用时约束全部悬空，之后校验报"表不存在"而画布节点还在。
    refs = find_schema_references(workspace_path, schema_id)
    ref_report = format_reference_report(refs)
    if ref_report:
        return {
            "success": False,
            "message": (
                f"Schema '{schema_id}' 仍被 {ref_report} 引用，请先删除这些引用再删除表"
                "（可先逐一删除引用它的约束/正则/转换）"
            ),
        }

    # 删除前捕获文件真实 id：删除后磁盘无据可查，变更集指令需用它定位画布节点
    # （LLM 可能只给 name，画布节点 id 是文件 id，两者可能不同）
    resolved_id = read_entity_id(schema_file, default=schema_id)

    try:
        schema_file.unlink()
    except OSError as e:
        return {"success": False, "message": f"删除 Schema 文件失败: {e}"}

    # 从 manifest 移除引用 —— 失败时尝试恢复文件以保持一致，避免 dangling 引用
    try:
        _remove_manifest_schema_ref(workspace_path, schema_id)
    except Exception as e:
        logger.error(f"[SchemaHandler] 从 manifest 移除引用失败: {e}")
        return {"success": False, "message": f"更新 manifest 引用失败，文件已删除但 manifest 残留: {e}"}

    logger.info(f"[SchemaHandler] 删除 Schema: {schema_id}")
    return {"success": True, "message": schema_id, "resolved_id": resolved_id}


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
    """确保 manifest 中包含指定 Schema 引用。

    失败时抛出异常而非吞掉 —— 避免 schema 文件已写盘但 manifest 未登记，
    从而产生孤儿文件（会触发后续 inspect 的 id 冲突 blocker）。
    """
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    manifest = load_manifest(manifest_path)
    ensure_schema_ref(manifest, schema_id)
    save_manifest(manifest, manifest_path)


def _remove_manifest_schema_ref(workspace_path: str, schema_id: str) -> None:
    """从 manifest 中移除指定 Schema 引用。

    失败时抛出异常而非吞掉 —— 避免 schema 文件已删除但 manifest 仍残留引用，
    从而产生 dangling 引用。
    """
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    manifest = load_manifest(manifest_path)
    manifest.schemas = [s for s in manifest.schemas if s.id != schema_id]
    save_manifest(manifest, manifest_path)
