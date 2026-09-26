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
"""
@fileoverview 内联约束批量处理模块

功能概述:
- 批量处理同一 schema 的多个内联约束
- 核心优化：只读取和写入 schema 文件一次，避免多次 IO
- 所有约束先在内存中处理，最后统一原子性写入

输入示例:
    results = process_inline_batch(actions, "/workspace")

输出示例:
    [
        {"action": action, "success": True, "message": "inline:notnull_1f0c8e52-...", "frontendInstructions": {...}},
        ...
    ]
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.constraints.constraint_builder import (
    CONSTRAINT_TYPE_MAP,
    _build_inline_constraint_item,
)
from app.shared.services.llm.constraints.constraint_lookup import default_constraint_id, sanitize_constraint_id
from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)


def _collect_target_schema_id(action: dict[str, Any]) -> str | None:
    """
    @methoddesc 从 action 中提取目标 schema ID（用于批量处理时分组）

    参数:
        action: 动作字典

    返回:
        schema ID 字符串，如果无法识别则返回 None
    """
    spec = action.get("constraintSpec", {})
    # 优先使用 tableName，其次是 targetNodeId
    value = spec.get("tableName") or spec.get("targetNodeId")
    return value if isinstance(value, str) else None


def _is_inline_action(action: dict[str, Any]) -> bool:
    """
    @methoddesc 判断动作是否为内联约束操作

    内联约束直接存储在 schema 文件中，而非独立的 .constraint.yaml 文件。

    参数:
        action: 动作字典

    返回:
        True 表示内联约束，False 表示独立约束
    """
    spec = action.get("constraintSpec", {})
    return bool(spec.get("isInline", False))


def process_inline_batch(actions: list[dict[str, Any]], workspace_path: str) -> list[dict[str, Any]]:
    """
    @methoddesc 批量处理同一 schema 的多个内联约束

    核心优化：只读取和写入 schema 文件一次，避免多个独立约束操作导致多次 IO。
    所有约束先在内存中处理，最后统一原子性写入。

    参数:
        actions: 同一 schema 的内联约束操作列表
        workspace_path: 项目工作区路径

    返回:
        每个 action 的处理结果列表

    示例:
        >>> results = process_inline_batch([
        ...     {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"isInline": True, ...}},
        ...     {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"isInline": True, ...}},
        ... ], "/workspace")
    """
    if not actions:
        return []

    # 从第一个 action 中提取 schema 标识（假设同一批的 schema 相同）
    first_action = actions[0]
    spec = first_action.get("constraintSpec", {})
    target_node_id = spec.get("targetNodeId", "")
    table_name = spec.get("tableName", "")
    target_table_id = target_node_id or table_name

    results = []

    try:
        schemas_dir = Path(workspace_path) / "schemas"
        schema_file = None

        # 在 schemas 目录中查找匹配的 schema 文件
        for sf in schemas_dir.glob("*.yaml"):
            with open(sf, encoding="utf-8") as f:
                sd = yaml.safe_load(f) or {}
            if sd.get("id") == target_table_id or sd.get("name") == table_name:
                schema_file = sf
                break

        if not schema_file:
            # schema 文件不存在，所有操作标记为失败
            for action in actions:
                results.append(
                    {
                        "action": action,
                        "success": False,
                        "message": f"未找到 schema 文件: {target_table_id}",
                        "frontendInstructions": None,
                    }
                )
            return results

        # 使用文件锁保护，一次性处理所有约束
        with FileLock(str(schema_file)):
            # 重新读取文件（确保获取最新内容）
            with open(schema_file, encoding="utf-8") as f:
                schema_data = yaml.safe_load(f) or {}

            columns = schema_data.get("columns", [])
            if "constraints" not in schema_data:
                schema_data["constraints"] = []

            # 逐个处理约束（全部在内存中修改，不立即写入）
            has_delete = False
            for action in actions:
                try:
                    spec = action.get("constraintSpec", {})
                    action_type = action.get("actionType", "")
                    constraint_type = spec.get("type", "")
                    target_column = spec.get("targetColumn", "")
                    target_column_id = spec.get("targetColumnId", "")
                    target_columns = spec.get("targetColumnIds") or spec.get("targetColumns") or []

                    # 将约束类型别名标准化
                    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)

                    # 查找目标列的 ID（优先使用传入的 ID，否则按名称查找）
                    column_id = target_column_id
                    if not column_id:
                        for col in columns:
                            if col.get("name") == target_column:
                                column_id = col.get("id")
                                break

                    # 多列联合唯一：单列引用可缺省（targetColumns 携带全部列引用）
                    is_multi_unique = (
                        std_type == "Unique" and isinstance(target_columns, list) and len(target_columns) > 1
                    )
                    if not column_id and not is_multi_unique:
                        results.append(
                            {
                                "action": action,
                                "success": False,
                                "message": f"未找到列 ID: {target_column}",
                                "frontendInstructions": None,
                            }
                        )
                        continue

                    # 约束 ID：显式 constraintId 尊重（文件名安全清洗），缺省自动生成
                    # （类型前缀 + UUID v4）；LLM 给出非法 ID 时该动作失败
                    try:
                        explicit_constraint_id = sanitize_constraint_id(spec.get("constraintId"))
                    except ValueError as e:
                        results.append(
                            {
                                "action": action,
                                "success": False,
                                "message": str(e),
                                "frontendInstructions": None,
                            }
                        )
                        continue
                    constraint_id = explicit_constraint_id or default_constraint_id(std_type)

                    # DELETE 动作：从内存中的 constraints 移除「同列 + 同类型」项，绝不新增。
                    # 旧实现不区分 actionType，删除动作会被当作添加处理（只增不删还报成功）。
                    if action_type == "DELETE_CONSTRAINT_NODE":
                        has_delete = True
                        if is_multi_unique:
                            resolved_cols = [
                                next(
                                    (str(c.get("id")) for c in columns if c.get("id") == raw or c.get("name") == raw),
                                    str(raw),
                                )
                                for raw in target_columns
                            ]
                            remaining = [
                                c
                                for c in schema_data["constraints"]
                                if not (c.get("columns") == resolved_cols and c.get("type") == std_type)
                            ]
                        else:
                            remaining = [
                                c
                                for c in schema_data["constraints"]
                                if not (c.get("column") == column_id and c.get("type") == std_type)
                            ]
                        if len(remaining) == len(schema_data["constraints"]):
                            results.append(
                                {
                                    "action": action,
                                    "success": False,
                                    "message": f"未找到内联约束: {std_type} on {table_name}.{target_column}",
                                    "frontendInstructions": None,
                                }
                            )
                            continue
                        # 回传被删内联项自身的 id（不再派生）
                        removed_id = next(
                            (
                                str(c.get("id"))
                                for c in schema_data["constraints"]
                                if c not in remaining and c.get("id")
                            ),
                            constraint_id,
                        )
                        schema_data["constraints"] = remaining
                        logger.info(f"[批量处理] 删除内联约束: {removed_id}")
                        results.append(
                            {
                                "action": action,
                                "success": True,
                                "message": f"inline:{removed_id}",
                                "frontendInstructions": generate_frontend_instructions(action, workspace_path),
                            }
                        )
                        continue

                    # 构建内联约束结构（共用构建器：与 update_yaml_config 内联分支同一实现，
                    # Conditional 引用入 params、FK 目标入顶层字段、多列 Unique 用 columns）
                    constraint_description = spec.get("description") or f"{constraint_id}"
                    inline_constraint = _build_inline_constraint_item(
                        std_type,
                        spec,
                        column_id or "",
                        columns,
                        table_name,
                        target_column,
                        workspace_path,
                        constraint_id,
                        description=constraint_description,
                    )

                    # 检查是否已存在相同列（或列组合）和类型的约束
                    existing_idx = None
                    for idx, existing in enumerate(schema_data["constraints"]):
                        same_target = (
                            existing.get("columns") == inline_constraint.get("columns")
                            if "columns" in inline_constraint
                            else existing.get("column") == inline_constraint.get("column")
                        )
                        if same_target and existing.get("type") == std_type:
                            existing_idx = idx
                            break

                    if existing_idx is not None:
                        # 更新现有约束：保留既有项的 id（内嵌约束全局 id 含 item id，
                        # UUID 化后每次更新换 id 会造成无谓的引用漂移）
                        prev_id = schema_data["constraints"][existing_idx].get("id")
                        if prev_id:
                            inline_constraint["id"] = prev_id
                            constraint_id = str(prev_id)
                        schema_data["constraints"][existing_idx] = inline_constraint
                        logger.info(f"[批量处理] 更新内联约束: {constraint_id}")
                    else:
                        # 添加新约束
                        schema_data["constraints"].append(inline_constraint)
                        logger.info(f"[批量处理] 添加内联约束: {constraint_id}")

                    results.append(
                        {
                            "action": action,
                            "success": True,
                            "message": f"inline:{constraint_id}",
                            "frontendInstructions": generate_frontend_instructions(action, workspace_path),
                        }
                    )

                except Exception as e:
                    logger.error(f"[批量处理] 处理约束失败: {e}")
                    results.append(
                        {"action": action, "success": False, "message": str(e), "frontendInstructions": None}
                    )

            # 只要有成功的操作，就一次性写入所有修改
            if any(r["success"] for r in results):
                # 含删除动作时必须全量替换写入：atomic_write_yaml 的 preserve_format
                # 路径按 id 合并列表（只更新/追加、不删除），会把已删除的约束"复活"
                atomic_write_yaml(schema_file, schema_data, preserve_format=not has_delete)
                logger.info(f"[批量处理] 成功保存 {len([r for r in results if r['success']])} 个约束到 schema")

    except Exception as e:
        logger.error(f"[批量处理] 批量处理失败: {e}")
        # 为尚未记录结果的操作标记为失败
        for i, action in enumerate(actions):
            if len(results) < i + 1:
                results.append(
                    {"action": action, "success": False, "message": f"批量处理失败: {e}", "frontendInstructions": None}
                )

    return results
