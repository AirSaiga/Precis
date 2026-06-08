"""
@fileoverview 约束结构构建模块

功能概述:
- 根据约束类型构建约束的 refs（引用区）结构
- 根据约束类型构建约束的 params（参数区）结构
- 处理类型标准化和名称到 ID 的 Fallback 解析
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.shared.services.llm.schema_resolver import _resolve_id_from_name

logger = logging.getLogger(__name__)

CONSTRAINT_TYPE_MAP = {
    "NOT_NULL": "NotNull",
    "UNIQUE": "Unique",
    "ALLOWED_VALUES": "AllowedValues",
    "RANGE": "Range",
    "REGEX": "Scripted",
    "FOREIGN_KEY": "ForeignKey",
    "CONDITIONAL": "Conditional",
    "DATE_LOGIC": "DateLogic",
}


def _build_constraint_refs(
    constraint_type: str, table_name: str, column_name: str, constraint_spec: dict[str, Any], workspace_path: str = ""
) -> dict[str, Any]:
    """
    @methoddesc 构建约束的 refs 字段

    业务用途:
    - 根据约束类型（NotNull/Unique/ForeignKey/...）组装符合 YAML 规范的 refs 字典
    - 必要时根据工作区路径将名称回退解析为 table_id / column_id

    参数:
        constraint_type: AI 给出的原始约束类型（可能大小写不规范）
        table_name: 表名（用于名称回退）
        column_name: 列名（用于名称回退）
        constraint_spec: AI 输出的 spec 字典
        workspace_path: 工作区路径，启用名称回退

    返回:
        refs 字典，结构因约束类型而异
    """
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)
    table_id = constraint_spec.get("targetNodeId")
    column_id = constraint_spec.get("targetColumnId")

    if workspace_path and (not table_id or not table_id.startswith("sc_")):
        fallback_table_id, fallback_column_id = _resolve_id_from_name(
            workspace_path, table_name or table_id, column_name or column_id
        )
        if fallback_table_id:
            table_id = fallback_table_id
            if fallback_column_id:
                column_id = fallback_column_id

    if std_type == "NotNull":
        return {"table_id": table_id, "column_id": column_id}
    elif std_type == "Unique":
        return {"table_id": table_id, "column_ids": [column_id]}
    elif std_type == "ForeignKey":
        params = constraint_spec.get("params", {})
        return {
            "from_table_id": table_id,
            "from_column_id": column_id,
            "to_table_id": params.get("toTableId", ""),
            "to_column_id": params.get("toColumnId", ""),
        }
    elif std_type == "Conditional":
        params = constraint_spec.get("params", {})
        then_column_id = constraint_spec.get("targetColumnId", column_name)
        if_conditions = params.get("ifConditions", [])
        formatted_conditions = []
        for cond in if_conditions:
            formatted_conditions.append(
                {
                    "if_column_id": cond.get("ifColumnId", ""),
                    "operator": cond.get("operator", "eq"),
                    "value": cond.get("value"),
                    "values": cond.get("values"),
                }
            )
        return {
            "table_id": table_id,
            "then_column_id": then_column_id,
            "if_conditions": formatted_conditions,
            "if_logic": params.get("ifLogic", "and"),
        }
    else:
        return {"table_id": table_id, "column_id": column_id}


def _build_constraint_params(constraint_type: str, constraint_spec: dict[str, Any]) -> dict[str, Any]:
    """
    @methoddesc 构建约束的 params 字段

    业务用途:
    - 将 AI 输出的 camelCase 字段（allowedValues, min/max, logicMode 等）映射为 YAML 标准的 snake_case 字段
    - Scripted 约束支持从 pattern 自动生成 expression

    参数:
        constraint_type: 原始约束类型
        constraint_spec: AI 输出的 spec 字典

    返回:
        params 字典
    """
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)
    params = constraint_spec.get("params", {})

    if std_type == "AllowedValues":
        return {"allowed_values": params.get("allowedValues", [])}
    elif std_type == "Range":
        return {"min": params.get("min"), "max": params.get("max")}
    elif std_type == "Scripted":
        pattern = params.get("pattern")
        expression = params.get("expression")
        if pattern and not expression:
            safe_pattern = re.escape(pattern)
            expression = f"re.match(r'{safe_pattern}', str(value)) is not None"
        return {"expression": expression or "True"}
    elif std_type == "DateLogic":
        return {
            "logic_mode": params.get("logicMode", "compare"),
            "compare_op": params.get("compareOp", "gt"),
            "reference_date": params.get("referenceDate", ""),
        }
    elif std_type == "Conditional":
        return {"then_value": params.get("thenValue")}
    else:
        return {}
