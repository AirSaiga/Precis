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
"""@fileoverview 动作级语义摘要 — actionType 中文描述的单一事实源

两条确认链路共用本模块，禁止在任何消费方手抄文案副本：
1. 两阶段确认 pending payload 的 actions 字段（apply_actions._run_two_phase，
   经 summarize_action 生成一行人类可读摘要，GUI/CLI 均可消费）
2. legacy 确认展示（cli/shell/commands/ai/interaction.confirm_actions，
   经 format_confirm_lines 生成多行展示，行为与提取前逐字节一致）

纯函数、零 IO：输入动作 dict，输出描述文本/结构化摘要。
"""

from __future__ import annotations

from typing import Any

# 动作类型 → 中文短描述（如 "添加约束"）。
# 覆盖全部写盘动作（守卫测试保证）+ ADD_TO_CANVAS；VALIDATE_PROJECT 走
# _validate_project_display 的专用文案（按表清单/全量动态生成，静态映射装不下）。
# 新增动作类型时必须同步登记，否则确认清单会退化显示英文类型名。
ACTION_TYPE_DESCRIPTIONS: dict[str, str] = {
    "ADD_TO_CANVAS": "显示到画布（只读）",
    "ADD_CONSTRAINT_NODE": "添加约束",
    "UPDATE_CONSTRAINT_NODE": "更新约束",
    "DELETE_CONSTRAINT_NODE": "删除约束",
    "ADD_SCHEMA": "创建表",
    "UPDATE_SCHEMA": "修改表结构",
    "DELETE_SCHEMA": "删除表",
    "ADD_REGEX": "创建正则校验",
    "UPDATE_REGEX": "更新正则校验",
    "DELETE_REGEX": "删除正则校验",
    "ADD_TRANSFORM": "创建数据转换",
    "UPDATE_TRANSFORM": "更新数据转换",
    "DELETE_TRANSFORM": "删除数据转换",
    "UPDATE_SETTINGS": "修改项目设置",
}


def describe_action_type(action_type: str) -> str:
    """返回动作类型的中文短描述；未登记类型回退英文类型名（与 legacy 行为一致）。"""
    return ACTION_TYPE_DESCRIPTIONS.get(action_type, action_type)


def extract_action_target(action: dict[str, Any]) -> tuple[str | None, str | None]:
    """从动作中提取目标表名和列名（如可提取）。

    约束动作读 constraintSpec 的 tableName/targetNodeId + targetColumn/targetColumnId；
    Schema 动作读 schemaSpec 的 name/schemaId/id；Transform 动作读 transformSpec 的
    输入节点与输入列；Regex 独立节点不绑定表/列，返回 (None, None)。
    """
    action_type = action.get("actionType", "")
    spec: dict[str, Any] = {}
    table: str | None = None
    column: str | None = None

    if action_type in (
        "ADD_CONSTRAINT_NODE",
        "UPDATE_CONSTRAINT_NODE",
        "DELETE_CONSTRAINT_NODE",
    ):
        spec = action.get("constraintSpec", {}) or {}
        table = spec.get("tableName") or spec.get("targetNodeId")
        column = spec.get("targetColumn") or spec.get("targetColumnId")
    elif action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"):
        spec = action.get("schemaSpec", {}) or {}
        table = spec.get("name") or spec.get("schemaId") or spec.get("id")
    elif action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
        spec = action.get("transformSpec", {}) or {}
        table = spec.get("inputFromNode") or spec.get("inputNodeId")
        column = spec.get("inputColumn")
    elif action_type in ("ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"):
        # Regex 节点通常不直接绑定到具体表/列，不做强校验
        return None, None

    # 清洗字符串
    if table and isinstance(table, str):
        table = table.strip()
    if column and isinstance(column, str):
        column = column.strip()
    return table, column


def _format_target(table: str | None, column: str | None) -> str | None:
    """把 (table, column) 组合为单行目标文本："table.column" / "table" / None。"""
    if table and column:
        return f"{table}.{column}"
    return table or column or None


def _validate_project_display(action: dict[str, Any]) -> str:
    """VALIDATE_PROJECT 的展示文案（按校验范围动态生成，legacy 与摘要共用）。"""
    spec = action.get("constraintSpec", {}) or {}
    table_name = spec.get("tableName", spec.get("targetNodeId", "所有表"))
    tables = spec.get("tables") or spec.get("tableIds")

    if tables:
        if len(tables) == 1:
            return f"校验表: {tables[0]}"
        return f"校验 {len(tables)} 张表: {', '.join(tables)}"
    if table_name and table_name != "所有表":
        return f"校验表: {table_name}"
    return "校验所有表"


def summarize_action(action: dict[str, Any]) -> dict[str, Any]:
    """生成动作的一行语义摘要，供两阶段确认 payload 的 actions 字段。

    返回结构::

        {"action_type": "ADD_CONSTRAINT_NODE",
         "description": "添加约束：users.email — NotNull",
         "target": "users.email"}

    description 是一行人类可读摘要（GUI/CLI 直接展示）；target 复用
    extract_action_target 的提取结果（"表.列" / "表" / None）。
    """
    action_type = str(action.get("actionType") or "")
    desc = describe_action_type(action_type)
    table, column = extract_action_target(action)
    target = _format_target(table, column)

    if action_type == "VALIDATE_PROJECT":
        # 只读动作不进确认 payload，此处仅为函数完备（legacy 展示同文案）
        return {"action_type": action_type, "description": _validate_project_display(action), "target": None}

    if action_type in ("ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"):
        spec = action.get("constraintSpec") or {}
        constraint_type = str(spec.get("type") or "Unknown")
        description = f"{desc}：{target} — {constraint_type}" if target else f"{desc} — {constraint_type}"
    elif action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"):
        description = f"{desc}：{target}" if target else desc
    elif action_type in ("ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"):
        spec = action.get("regexSpec") or {}
        name = spec.get("name") or spec.get("regexId")
        description = f"{desc}：{name}" if name else desc
    elif action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
        spec = action.get("transformSpec") or {}
        transform_type = spec.get("type")
        description = f"{desc}：{transform_type}" if transform_type else desc
    elif action_type == "UPDATE_SETTINGS":
        spec = action.get("settingsSpec") or {}
        category = spec.get("category")
        description = f"{desc}：{category}" if category else desc
    elif action_type == "ADD_TO_CANVAS":
        spec = action.get("canvasSpec") or {}
        resource_kind = spec.get("resourceKind", "未知")
        resource_name = spec.get("name", spec.get("resourceId", "未知"))
        description = f"{desc}: {resource_kind} / {resource_name}"
    else:
        description = desc

    return {"action_type": action_type, "description": description, "target": target}


def format_confirm_lines(action: dict[str, Any], index: int) -> list[str]:
    """legacy confirm_actions 的单动作多行展示格式（提取自 CLI interaction.py，行为不变）。

    每行已含两格缩进与编号，消费方逐行 print 即可；VALIDATE_PROJECT 走专用文案。
    """
    action_type = action.get("actionType", "UNKNOWN")

    if action_type == "VALIDATE_PROJECT":
        return [f"  {index}. {_validate_project_display(action)}"]

    action_desc = describe_action_type(action_type)

    if action_type == "ADD_TO_CANVAS":
        spec = action.get("canvasSpec", {})
        resource_kind = spec.get("resourceKind", "未知")
        resource_name = spec.get("name", spec.get("resourceId", "未知"))
        return [f"  {index}. {action_desc}: {resource_kind} / {resource_name}"]
    if action_type in ("ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"):
        spec = action.get("constraintSpec", {})
        constraint_type = spec.get("type", "Unknown")
        table_name = spec.get("tableName", spec.get("targetNodeId", "未知"))
        column_name = spec.get("targetColumn", spec.get("targetColumnId", "未知"))
        return [
            f"  {index}. {action_desc}",
            f"     表: {table_name}, 字段: {column_name}, 类型: {constraint_type}",
        ]
    if action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"):
        spec = action.get("schemaSpec", {})
        name = spec.get("name", spec.get("schemaId", "未知"))
        columns = spec.get("columns", [])
        lines = [f"  {index}. {action_desc}: {name}"]
        if columns:
            col_names = [c.get("name", "?") for c in columns]
            lines.append(f"     列: {', '.join(col_names)}")
        return lines
    if action_type in ("ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"):
        spec = action.get("regexSpec", {})
        name = spec.get("name", spec.get("regexId", "未知"))
        return [f"  {index}. {action_desc}: {name}"]
    if action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
        spec = action.get("transformSpec", {})
        t_type = spec.get("type", "未知")
        return [f"  {index}. {action_desc}: {t_type}"]
    if action_type == "UPDATE_SETTINGS":
        spec = action.get("settingsSpec", {})
        category = spec.get("category", "未知")
        settings = spec.get("settings", {})
        return [
            f"  {index}. {action_desc}: {category}",
            f"     设置: {settings}",
        ]
    return [f"  {index}. {action_desc}"]
