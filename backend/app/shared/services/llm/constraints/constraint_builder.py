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
@fileoverview 约束结构构建模块

功能概述:
- 根据约束类型构建约束的 refs（引用区）结构
- 根据约束类型构建约束的 params（参数区）结构
- 处理类型标准化和名称到 ID 的 Fallback 解析
- 构建 schema 内联约束项（update_yaml_config 与 process_inline_batch 共用）
"""

from __future__ import annotations

import logging
from typing import Any

from app.shared.services.llm.schema_resolver import _resolve_id_from_name

logger = logging.getLogger(__name__)

# 约束类型别名映射（大写 → PascalCase 标准名）。
# 单一事实源是 actions/registry.py 的 CONSTRAINT_TYPE_ALIASES；此处保持同步副本。
# 历史问题：旧副本缺 CHARSET/COMPOSITE，已补齐。直接 import registry 会形成循环导入
# （actions/__init__ → action_handlers → constraint_builder → actions 包），故维持副本。
# 新增约束类型时，两处都必须同步更新。
CONSTRAINT_TYPE_MAP = {
    "NOT_NULL": "NotNull",
    "UNIQUE": "Unique",
    "ALLOWED_VALUES": "AllowedValues",
    "RANGE": "Range",
    "REGEX": "Scripted",
    "FOREIGN_KEY": "ForeignKey",
    "CONDITIONAL": "Conditional",
    "DATE_LOGIC": "DateLogic",
    "CHARSET": "Charset",
    "COMPOSITE": "Composite",
}

# 参数枚举白名单——与运行时（domain/constraints/*）保持一致。
# 写盘侧 fail-fast：非法枚举值直接抛 ValueError 转为动作失败，绝不静默落盘成
# 语义错误的约束（如 charset_mode 拼错被当 ascii 处理会系统性误报）。
_CHARSET_MODES = frozenset({"ascii", "chinese", "chinese_mixed"})
_BOUNDARY_MODES = frozenset({"inclusive", "exclusive"})
_COMPOSITE_LOGIC = frozenset({"all", "any", "none"})
# Conditional then_condition DSL 操作符（domain/constraints/conditional.py _parse_condition）
_THEN_OPERATORS = frozenset({"not_null", "greater_than", "less_than", "in", "eq", "neq"})


def _pick(params: dict[str, Any], camel: str, snake: str) -> Any:
    """从 AI params 中取值：camelCase 优先，snake_case 兼容，均缺省返回 None。

    用显式 None 判断而非 `or`，避免 min=0、value=False 等假值被误判为缺省。
    """
    if camel in params and params[camel] is not None:
        return params[camel]
    return params.get(snake)


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

    if workspace_path and table_name:
        fallback_table_id, fallback_column_id = _resolve_id_from_name(
            workspace_path, table_name, column_name or column_id
        )
        if fallback_table_id:
            table_id = fallback_table_id
            if fallback_column_id:
                column_id = fallback_column_id

    if std_type == "NotNull":
        return {"table_id": table_id, "column_id": column_id}
    elif std_type == "Unique":
        # 多列联合唯一：AI 可在 constraintSpec.targetColumns（列名/ID 数组）给出多列；
        # 单列走原路径。column_ids 缺省时兜底 [column_id] 保持向后兼容。
        multi = _resolve_multi_columns(constraint_spec, table_name, workspace_path)
        if multi:
            return {"table_id": table_id, "column_ids": multi}
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
            # 优先用上方 fallback 已解析出的 column_id（名称→ID），
            # 其次 AI 显式给的 targetColumnId，最后退回列名
            "then_column_id": column_id or constraint_spec.get("targetColumnId") or column_name,
            "if_conditions": formatted_conditions,
            "if_logic": params.get("ifLogic", "and"),
        }
    else:
        return {"table_id": table_id, "column_id": column_id}


def _resolve_multi_columns(constraint_spec: dict[str, Any], table_name: str, workspace_path: str) -> list[str]:
    """解析多列联合唯一的列引用列表（Unique 专用）。

    逐列做与单列相同的名称→ID fallback 解析；无 workspace 上下文时原样返回。
    返回空列表表示未提供多列（调用方回退单列路径）。
    """
    raw = constraint_spec.get("targetColumnIds") or constraint_spec.get("targetColumns") or []
    if not isinstance(raw, list) or not raw:
        return []
    resolved: list[str] = []
    for item in raw:
        cid = str(item)
        if workspace_path and table_name:
            _, fallback_cid = _resolve_id_from_name(workspace_path, table_name, cid)
            if fallback_cid:
                cid = fallback_cid
        resolved.append(cid)
    return resolved


def _build_constraint_params(
    constraint_type: str,
    constraint_spec: dict[str, Any],
    table_name: str = "",
    column_name: str = "",
    workspace_path: str = "",
    parent_id: str = "",
) -> dict[str, Any]:
    """
    @methoddesc 构建约束的 params 字段

    业务用途:
    - 将 AI 输出的 camelCase 字段（allowedValues, min/max, logicMode, charsetMode 等）
      映射为 YAML 标准的 snake_case 字段（camelCase 优先、snake_case 兼容）
    - Scripted 约束支持从 pattern 自动生成 expression
    - Conditional 的 thenCondition DSL、Composite 的 subConstraints 子约束展开
    - 参数缺失/非法枚举一律抛 ValueError（上层转为动作失败，绝不静默落盘残缺约束）

    参数:
        constraint_type: 原始约束类型
        constraint_spec: AI 输出的 spec 字典
        table_name: 目标表名（Composite 子约束解析 refs 时需要）
        column_name: 目标列名（同上）
        workspace_path: 工作区路径（Composite 子约束名称→ID fallback 解析）
        parent_id: 父约束 ID（Composite 生成子约束文件 ID 的前缀）

    返回:
        params 字典
    """
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)
    params = constraint_spec.get("params", {})

    if std_type == "AllowedValues":
        return {"allowed_values": params.get("allowedValues", params.get("allowed_values", []))}
    elif std_type == "Range":
        result: dict[str, Any] = {"min": params.get("min"), "max": params.get("max")}
        boundary = _pick(params, "boundaryMode", "boundary_mode")
        if boundary is not None:
            if boundary not in _BOUNDARY_MODES:
                raise ValueError(f"Range 约束 boundaryMode 非法: {boundary!r}（可选 inclusive/exclusive）")
            result["boundary_mode"] = boundary
        return result
    elif std_type == "Scripted":
        pattern = params.get("pattern")
        expression = params.get("expression")
        if pattern and not expression:
            # 非 str pattern（如 LLM 误给数字/布尔）在写盘侧 fail-fast，不留到逐行执行才爆
            if not isinstance(pattern, str):
                raise ValueError(f"Scripted 约束 pattern 必须为字符串，实际为 {type(pattern).__name__}: {pattern!r}")
            # pattern 视为正则，经沙箱白名单函数 re_match（fullmatch 全串匹配，与独立
            # regex 约束同口径）生成表达式。repr 生成自带引号/反斜杠转义的字符串字面量，
            # pattern 含单/双引号均无法逃逸出字面量（注入安全，compile 可验证）。
            # 不做 re.escape、不用 re.match：re.escape 会把 ^\d+$ 等元字符当字面量子串，
            # 而 "re.match(...)" 在 Scripted 沙箱内 re 未定义（只注册了 re_match），
            # 逐行报 SCRIPTED_EXECUTION_ERROR——历史缺陷，回归见 test_ai_write_contract
            expression = f"re_match({pattern!r}, str(value))"
        if not expression:
            # 空表达式不再兜底为 "True"（恒真约束会静默失效还报成功），
            # 抛出让上层按失败上报且不落盘。三个调用方（update_yaml_config 内联/独立分支、
            # process_inline_batch）均有 except Exception 兜底，会把异常转为该动作的失败结果。
            raise ValueError(
                "Scripted 约束缺少有效参数: 需要 params.expression 或 params.pattern 之一（恒真表达式已被禁止）"
            )
        return {"expression": expression}
    elif std_type == "DateLogic":
        result = {
            "logic_mode": params.get("logicMode", params.get("logic_mode", "compare")),
            "compare_op": params.get("compareOp", params.get("compare_op", "gt")),
        }
        # 参考值/计算参数：仅写入 AI 实际提供的键（避免空串污染 YAML）
        for camel, snake in (
            ("referenceDate", "reference_date"),
            ("referenceColumn", "reference_column"),
            ("referenceDateEnd", "reference_date_end"),
            ("referenceColumnEnd", "reference_column_end"),
            ("calculationType", "calculation_type"),
            ("targetValue", "target_value"),
            ("targetColumn", "target_column"),
        ):
            value = _pick(params, camel, snake)
            if value is not None and value != "":
                result[snake] = value
        # calculation 模式参数完整性 fail-fast（运行时缺参会构建失败，写盘前拦截更早更明确）
        if result["logic_mode"] == "calculation":
            calc = result.get("calculation_type")
            if calc not in ("age", "days_diff"):
                raise ValueError("DateLogic calculation 模式需要 params.calculationType（age/days_diff）")
            if calc == "days_diff" and not result.get("target_column"):
                raise ValueError("DateLogic days_diff 需要 params.targetColumn（天数差比较的目标列）")
            if result.get("target_value") is None:
                raise ValueError("DateLogic calculation 模式需要 params.targetValue（比较目标值）")
        return result
    elif std_type == "Conditional":
        # then_condition 是运行时唯一消费的 THEN 侧参数（domain ConditionalConstraint 构造器）。
        # 历史缺陷：此处曾写 then_value（全后端无消费方），导致运行时 then_condition=None
        # 构造抛 TypeError、约束被 factory 丢弃——AI 建的 Conditional 全部静默失效。
        then = _pick(params, "thenCondition", "then_condition")
        if then is None:
            raise ValueError(
                "Conditional 约束缺少有效参数: 需要 params.thenCondition"
                "（DSL 对象 {operator, value/values, refColumn} 或已注册条件函数名字符串；旧字段 thenValue 已废弃）"
            )
        if isinstance(then, str):
            return {"then_condition": then}
        if isinstance(then, dict):
            return {"then_condition": _normalize_then_condition(then)}
        raise ValueError(f"thenCondition 类型不支持: {type(then).__name__}（需 dict 或 str）")
    elif std_type == "Charset":
        # charset_mode 必须显式提供：默认 ascii 会让"中文约束"建出 ascii 约束（系统性误报）
        mode = _pick(params, "charsetMode", "charset_mode")
        if mode is None:
            raise ValueError("Charset 约束缺少有效参数: 需要 params.charsetMode（ascii/chinese/chinese_mixed）")
        if mode not in _CHARSET_MODES:
            raise ValueError(f"Charset 约束 charsetMode 非法: {mode!r}（可选 ascii/chinese/chinese_mixed）")
        return {"charset_mode": mode}
    elif std_type == "Composite":
        return _build_composite_params(constraint_spec, table_name, column_name, workspace_path, parent_id)
    else:
        return {}


def _normalize_then_condition(then: dict[str, Any]) -> dict[str, Any]:
    """规范化 then_condition DSL：camelCase 键转 snake_case、剔除 None 值、枚举校验。

    兼容 AI 直接给 snake_case 键（operator/value/values/ref_column 原样通过）。
    """
    operator = then.get("operator")
    if operator not in _THEN_OPERATORS:
        raise ValueError(f"thenCondition.operator 不支持: {operator!r}（可选 {'/'.join(sorted(_THEN_OPERATORS))}）")
    normalized: dict[str, Any] = {"operator": operator}
    for key in ("value", "values"):
        if then.get(key) is not None:
            normalized[key] = then[key]
    ref_column = _pick(then, "refColumn", "ref_column")
    if ref_column:
        normalized["ref_column"] = ref_column
    if operator == "in":
        values = normalized.get("values", normalized.get("value"))
        if not isinstance(values, list):
            raise ValueError("thenCondition 'in' 操作符需要 values 列表（或 value 为列表）")
    return normalized


def _build_composite_params(
    constraint_spec: dict[str, Any],
    table_name: str,
    column_name: str,
    workspace_path: str,
    parent_id: str,
) -> dict[str, Any]:
    """构建 Composite 的 params：把 AI 的 subConstraints 简化列表展开为完整子约束文件。

    运行时 build_composite 要求 params.sub_constraints 是 ConstraintFile 形态的
    完整 dict 列表（version/id/type/enabled/refs/params）。空子约束在引擎侧恒真
    （no-op 假通过），因此缺 subConstraints 直接抛错拒绝落盘。
    """
    params = constraint_spec.get("params", {})
    subs_raw = params.get("subConstraints") or params.get("sub_constraints") or []
    if not isinstance(subs_raw, list) or not subs_raw:
        raise ValueError(
            "Composite 约束缺少有效参数: 需要 params.subConstraints"
            "（非空子约束列表，每项 {type, targetColumn, params}；空复合约束恒真无意义）"
        )
    logic = params.get("logic", "all")
    if logic not in _COMPOSITE_LOGIC:
        raise ValueError(f"Composite 约束 logic 非法: {logic!r}（可选 all/any/none）")

    prefix = parent_id or "composite"
    sub_files: list[dict[str, Any]] = []
    for idx, sub in enumerate(subs_raw, start=1):
        if not isinstance(sub, dict):
            raise ValueError(f"subConstraints[{idx - 1}] 必须是对象（实际 {type(sub).__name__}）")
        raw_type = sub.get("type") or ""
        sub_type = CONSTRAINT_TYPE_MAP.get(raw_type, raw_type)
        if sub_type == "Composite":
            raise ValueError("不允许嵌套 Composite 子约束（引擎限制）")
        if sub_type not in CONSTRAINT_TYPE_MAP.values():
            raise ValueError(f"Composite 子约束类型不支持: {raw_type!r}")
        sub_column = sub.get("targetColumn") or sub.get("column") or column_name
        # 子约束 spec：复用 refs/params 构建器的完整映射（FK 的 toTableId、
        # Conditional 的 ifConditions 等经 sub.params 透传，与顶层语义一致）
        sub_spec: dict[str, Any] = {
            "targetNodeId": constraint_spec.get("targetNodeId"),
            # 列名兜底：无 workspace 上下文时 _build_constraint_refs 只读 targetColumnId
            "targetColumnId": sub.get("targetColumnId") or (sub_column or None),
            "params": sub.get("params", {}) or {},
        }
        sub_columns = sub.get("targetColumns") or sub.get("columns")
        if sub_columns:
            sub_spec["targetColumns"] = sub_columns
        sub_files.append(
            {
                "version": 2,
                "id": f"{prefix}_sub_{idx}",
                "type": sub_type,
                "enabled": True,
                "refs": _build_constraint_refs(sub_type, table_name, sub_column, sub_spec, workspace_path),
                "params": _build_constraint_params(
                    sub_type, sub_spec, table_name, sub_column, workspace_path, f"{prefix}_sub_{idx}"
                ),
            }
        )
    return {"logic": logic, "sub_constraints": sub_files}


def _build_inline_constraint_item(
    std_type: str,
    constraint_spec: dict[str, Any],
    column_id: str,
    schema_columns: list[dict[str, Any]],
    table_name: str,
    target_column: str,
    workspace_path: str,
    constraint_id: str,
    description: str | None = None,
) -> dict[str, Any]:
    """构建 schema 内联约束项（ConstraintItem 形态），update_yaml_config 与 process_inline_batch 共用。

    与独立约束文件的关键差异：
    - Conditional 的 if_logic/if_conditions/then_column_id 写入 params（加载期由
      embedded_constraints 提取到 refs），then_condition 留在 params
    - ForeignKey 的目标表/列写入顶层 from_column/to_table/to_column 字段
    - 多列 Unique 写入 columns 列表（与 column 互斥）
    """
    item: dict[str, Any] = {"id": constraint_id, "column": column_id, "type": std_type, "enabled": True}
    if description:
        item["description"] = description

    params = _build_constraint_params(
        std_type, constraint_spec, table_name, target_column, workspace_path, constraint_id
    )

    if std_type == "Conditional":
        # 内联形态无 refs：把引用信息放进 params，交给 embedded_constraints 加载期提取
        cond_refs = _build_constraint_refs("Conditional", table_name, target_column, constraint_spec, workspace_path)
        params["if_logic"] = cond_refs.get("if_logic", "and")
        params["if_conditions"] = cond_refs.get("if_conditions", [])
        params["then_column_id"] = column_id or cond_refs.get("then_column_id")
    elif std_type == "ForeignKey":
        fk_params = constraint_spec.get("params", {})
        item["from_column"] = column_id
        item["to_table"] = fk_params.get("toTableId", "")
        item["to_column"] = fk_params.get("toColumnId", "")
    elif std_type == "Unique":
        raw_columns = constraint_spec.get("targetColumnIds") or constraint_spec.get("targetColumns") or []
        if isinstance(raw_columns, list) and len(raw_columns) > 1:
            # 按名称/ID 在 schema 列表中解析（与外层 column_id 解析同口径）
            resolved: list[str] = []
            for raw in raw_columns:
                match = next(
                    (str(c.get("id")) for c in schema_columns if c.get("id") == raw or c.get("name") == raw),
                    str(raw),
                )
                resolved.append(match)
            item.pop("column")
            item["columns"] = resolved

    if params:
        item["params"] = params
    return item
