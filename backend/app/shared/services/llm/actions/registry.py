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
"""@fileoverview AI 动作注册表 — 单一事实源

本模块是所有 AI 动作类型（actionType）的唯一权威定义处。
其他模块（解析、校验、执行、前端指令生成、提示词）一律从此派生，
禁止重复硬编码动作类型集合，以消灭"同步遗漏"类 bug（如计数写错、
enum 漏条目、spec 字段映射不一致）。

四类内容在此收敛：
1. 动作类型（15种）及其 spec 字段、分类、读写性
2. 派生集合：ALL_ACTION_TYPES / BY_CATEGORY / READ_ONLY_TYPES / SPEC_FIELD_FOR 等
3. 子类型白名单：约束类型、转换子类型、数据类型、设置分类（原散落 2-4 处）
4. 约束参数文档（CONSTRAINT_PARAM_SCHEMAS）：chat 提示词与 MCP describe_constraints
   共用的参数名/值域单一事实源（原三处手抄副本收编于此）

设计原则：
- 注册表只描述"是什么"（声明性），不描述"怎么做"（执行逻辑仍在各 handler）。
- 派生属性用普通函数/常量，导入即用，零运行时开销。
- 新增一个动作 = 在 ACTIONS 加一行 + 配套 validator/handler，其余全自动派生。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# =============================================================================
# 子类型白名单（规范来源）——原散落于 action_validator / response_parser /
# suggestion_utils / transform_handlers / _schema_validator / settings_handlers 等
# =============================================================================

# 约束类型（PascalCase 正名）——与前端 CONSTRAINT_TYPE_MAP 的 value 侧一致
# 注意：仅含"标准名"，大写别名（NOT_NULL 等）由 ALIAS_CONSTRAINT_TYPES 单独管理
CONSTRAINT_TYPES: frozenset[str] = frozenset(
    {
        "NotNull",
        "Unique",
        "Range",
        "AllowedValues",
        "ForeignKey",
        "Conditional",
        "Scripted",
        "DateLogic",
        "Charset",
        "Composite",
    }
)

# 约束类型大写别名（LLM 可能输出）→ 标准名。
# 这是唯一的别名映射表，取代散落各处的重复副本。
# Scripted 的别名 REGEX 保留（历史兼容：旧约束用 REGEX 表示正则脚本约束）。
CONSTRAINT_TYPE_ALIASES: dict[str, str] = {
    "NOT_NULL": "NotNull",
    "UNIQUE": "Unique",
    "RANGE": "Range",
    "ALLOWED_VALUES": "AllowedValues",
    "FOREIGN_KEY": "ForeignKey",
    "CONDITIONAL": "Conditional",
    "DATE_LOGIC": "DateLogic",
    "CHARSET": "Charset",
    "COMPOSITE": "Composite",
    "REGEX": "Scripted",
}

# 约束类型全集（标准名 + 别名），供校验白名单使用
ALL_CONSTRAINT_TYPES: frozenset[str] = CONSTRAINT_TYPES | frozenset(CONSTRAINT_TYPE_ALIASES.keys())

# 需要特定参数的约束类型（供参数完整性校验）
# 注意：Range 的 min/max 实际允许"至少一个"（见 _constraint_validator 特殊处理），
# 此处仅声明"需要关注的参数键"，具体宽松度由 validator 决定。
# Charset 必填 charsetMode：缺省时写盘侧不再静默默认 ascii（中文约束误判为 ascii 约束）；
# Composite 必填 subConstraints：空子约束在引擎侧恒真（no-op 假通过）。
CONSTRAINT_REQUIRED_PARAMS: dict[str, list[str]] = {
    "Range": ["min", "max"],
    "AllowedValues": ["allowedValues"],
    "ForeignKey": ["toTableId", "toColumnId"],
    "Charset": ["charsetMode"],
    "Composite": ["subConstraints"],
}


# =============================================================================
# 约束参数文档（单一事实源）——chat 系统提示词（camelCase / AI 动作层）与 MCP
# describe_constraints（snake_case / V2 文件层）共用，消灭三处手抄副本的同步漂移。
# 参数名与值域以校验器（domain/constraints/*）和写盘侧（llm/constraints/constraint_builder.py）
# 的实际消费为准；与 CONSTRAINT_REQUIRED_PARAMS 互补——那边是校验用的必填键清单，
# 这边是完整人话文档，守卫测试保证两边键名不矛盾。
# =============================================================================


@dataclass(frozen=True)
class ConstraintParamDoc:
    """单个约束参数的声明性描述（AI 动作层与 V2 文件层双侧口径）。

    Attributes:
        camel: AI 动作层参数键（constraintSpec.params 内，camelCase）。空串表示仅存在于
            V2 文件层（如 Scripted 的 name），chat 提示词渲染时跳过。
        snake: V2 YAML 文件层参数键（constraint 文件 params 区，snake_case）。空串表示该键
            不落在文件 params 区（写入 refs 或写盘时被转换），MCP 结构化输出跳过。
        vtype: 值类型描述（LLM 可读，如 "float/int"、"str"、"List[Any]"）。
        values: 枚举值域，(值, 中文说明) 二元组序列；空表示非枚举。
        default: 缺省值（渲染为 "默认 X"；空串表示无缺省）。
        note: 补充说明（必填性/模式归属/语义提示）。
        group: 参数分组标签；非空时渲染为 "  - " 缩进子行（如 DateLogic 的两种模式）。
    """

    camel: str
    snake: str = ""
    vtype: str = ""
    values: tuple[tuple[str, str], ...] = ()
    default: str = ""
    note: str = ""
    group: str = ""


@dataclass(frozen=True)
class ConstraintTypeDoc:
    """单个约束类型的参数文档。

    Attributes:
        type: PascalCase 标准名（必须与 CONSTRAINT_TYPES 全等，守卫测试保证）。
        summary: 一句话中文摘要（进提示词 "- **Type**: summary。" 头部）。
        refs: V2 文件层 refs 结构描述（MCP describe_constraints 的 refs 字段）。
        params: 参数清单（键序即渲染序）。
        spec_note: constraintSpec 层（非 params 区）特殊字段说明（如 Unique 的 targetColumns）。
        sub_notes: 嵌套结构补充行（渲染为缩进 "  - " 子行，如 Conditional 的 ifConditions 结构）。
    """

    type: str
    summary: str
    refs: str
    params: tuple[ConstraintParamDoc, ...] = ()
    spec_note: str = ""
    sub_notes: tuple[str, ...] = ()


# 键序即文档渲染序（沿用 chat 提示词既有顺序）
CONSTRAINT_PARAM_SCHEMAS: dict[str, ConstraintTypeDoc] = {
    "NotNull": ConstraintTypeDoc(
        type="NotNull",
        summary="非空约束",
        refs="table_id + column_id",
    ),
    "Unique": ConstraintTypeDoc(
        type="Unique",
        summary="唯一约束",
        refs="table_id + column_ids（列表）",
        spec_note='单列无需参数；多列联合唯一用 constraintSpec.targetColumns（列名/ID 数组，如 ["order_id", "line_no"]）。',
    ),
    "AllowedValues": ConstraintTypeDoc(
        type="AllowedValues",
        summary="允许值约束",
        refs="table_id + column_id",
        params=(ConstraintParamDoc(camel="allowedValues", snake="allowed_values", vtype="List[Any]", note="非空列表"),),
    ),
    "Range": ConstraintTypeDoc(
        type="Range",
        summary="范围约束",
        refs="table_id + column_id",
        params=(
            ConstraintParamDoc(camel="min", snake="min", vtype="float/int", note="与 max 至少提供一个"),
            ConstraintParamDoc(camel="max", snake="max", vtype="float/int"),
            ConstraintParamDoc(
                camel="boundaryMode",
                snake="boundary_mode",
                values=(("inclusive", "闭区间"), ("exclusive", "开区间")),
                default="inclusive",
            ),
        ),
    ),
    "Scripted": ConstraintTypeDoc(
        type="Scripted",
        summary="脚本/正则约束",
        refs="table_id + column_id",
        params=(
            # name 仅存在于 V2 文件层（camel 空 → chat 文档不渲染），运行时缺省用约束文件 id
            ConstraintParamDoc(camel="", snake="name", vtype="str", note="规则名，缺省用约束文件 id"),
            ConstraintParamDoc(
                camel="expression",
                snake="expression",
                vtype="str",
                note="与 pattern 二选一；simpleeval 布尔表达式，变量 value=当前列值、row=当前行数据，"
                "函数 re_match(p, s) 等白名单；执行需开启项目设置的允许脚本",
            ),
            ConstraintParamDoc(
                camel="pattern",
                vtype="str",
                note="与 expression 二选一；正则（fullmatch 全串匹配语义），写盘时转为沙箱函数调用 re_match(pattern, str(value))",
            ),
        ),
    ),
    "ForeignKey": ConstraintTypeDoc(
        type="ForeignKey",
        summary="外键约束",
        refs="from_table_id + from_column_id + to_table_id + to_column_id",
        params=(
            # toTableId/toColumnId 写盘时落 refs（snake 空 → MCP params 不渲染，refs 字段已描述）
            ConstraintParamDoc(camel="toTableId", vtype="str", note="被引用的目标表"),
            ConstraintParamDoc(camel="toColumnId", vtype="str", note="被引用的目标列"),
        ),
    ),
    "Conditional": ConstraintTypeDoc(
        type="Conditional",
        summary="条件约束",
        refs="table_id + then_column_id + if_conditions[{if_column_id, operator, value}] + if_logic",
        params=(
            ConstraintParamDoc(
                camel="ifConditions", vtype="List[Object]", note="IF 触发条件列表，写盘落 refs.if_conditions"
            ),
            ConstraintParamDoc(
                camel="ifLogic",
                values=(("and", "全部满足"), ("or", "任一满足")),
                default="and",
                note="多条件组合逻辑，写盘落 refs.if_logic",
            ),
            ConstraintParamDoc(camel="thenCondition", snake="then_condition", vtype="Object 或 str", note="必填"),
        ),
        sub_notes=(
            '`ifConditions` 结构：`[{"ifColumnId": "列名", "operator": "eq/neq/in/not_null/greater_than/less_than", '
            '"value": 比较值, "values": 列表(in 时可选)}]`',
            '`thenCondition` 两种形态：DSL 对象 `{"operator": "not_null/greater_than/less_than/in/eq/neq", '
            '"value": 比较值, "values": 列表(in 时), "refColumn": "同表参考列(可选，与该列比较)"}`；'
            '或字符串（已注册条件函数名，如 "is_not_empty"）。旧字段 thenValue 已废弃，不要再使用',
        ),
    ),
    "DateLogic": ConstraintTypeDoc(
        type="DateLogic",
        summary="日期逻辑约束",
        refs="table_id + column_id",
        params=(
            ConstraintParamDoc(
                camel="logicMode",
                snake="logic_mode",
                values=(("compare", "比较"), ("calculation", "计算")),
                default="compare",
            ),
            ConstraintParamDoc(
                camel="compareOp",
                snake="compare_op",
                values=(("gt", ""), ("gte", ""), ("lt", ""), ("lte", ""), ("eq", ""), ("range", "日期区间")),
                default="gt",
                note="为 range 时必须同时提供终点：referenceDateEnd 或 referenceColumnEnd",
                group="compare 模式",
            ),
            ConstraintParamDoc(
                camel="referenceDate",
                snake="reference_date",
                vtype="str",
                note='固定日期 "YYYY-MM-DD"，与 referenceColumn 二选一',
                group="compare 模式",
            ),
            ConstraintParamDoc(
                camel="referenceColumn",
                snake="reference_column",
                vtype="str",
                note="同表参考列，与 referenceDate 二选一",
                group="compare 模式",
            ),
            ConstraintParamDoc(
                camel="referenceDateEnd",
                snake="reference_date_end",
                vtype="str",
                note="仅 compareOp=range：区间终点固定日期，与起点同形态",
                group="compare 模式",
            ),
            ConstraintParamDoc(
                camel="referenceColumnEnd",
                snake="reference_column_end",
                vtype="str",
                note="仅 compareOp=range：区间终点参考列，与起点同形态",
                group="compare 模式",
            ),
            ConstraintParamDoc(
                camel="calculationType",
                snake="calculation_type",
                values=(("age", "年龄"), ("days_diff", "与目标列的天数差")),
                note="必填",
                group="calculation 模式",
            ),
            ConstraintParamDoc(
                camel="targetValue",
                snake="target_value",
                vtype="数值",
                note="必填；缺省比较口径 age=gte（满 N 岁即过）、days_diff=eq（差值恰等）",
                group="calculation 模式",
            ),
            ConstraintParamDoc(
                camel="targetColumn",
                snake="target_column",
                vtype="str",
                note="仅 calculationType=days_diff：天数差比较的目标列",
                group="calculation 模式",
            ),
        ),
    ),
    "Charset": ConstraintTypeDoc(
        type="Charset",
        summary="字符集约束",
        refs="table_id + column_id",
        params=(
            ConstraintParamDoc(
                camel="charsetMode",
                snake="charset_mode",
                values=(("ascii", "纯 ASCII"), ("chinese", "纯中文"), ("chinese_mixed", "中文+字母数字常见标点")),
                note="AI 动作必填——缺省会创建失败；V2 文件层缺省 ascii",
            ),
        ),
    ),
    "Composite": ConstraintTypeDoc(
        type="Composite",
        summary='复合约束（把多条子约束按逻辑聚合为一条，如"非空且唯一"）',
        refs="table_id",
        params=(
            ConstraintParamDoc(
                camel="logic",
                snake="logic",
                values=(("all", "全部通过"), ("any", "至少一个通过"), ("none", "全部失败才通过")),
                default="all",
            ),
            ConstraintParamDoc(
                camel="subConstraints",
                snake="sub_constraints",
                vtype="List",
                note='必填，每项 {"type": 约束类型, "targetColumn": "列名", "params": {该子约束的参数}}；'
                "不允许嵌套 Composite",
            ),
        ),
    ),
}

# 转换子类型白名单（22种）——原 response_parser(21条) 与 transform_handlers(22条) 不一致，
# 以 transform_handlers 的 22 条为准（response_parser 缺 FillNA，实际是有效类型）。
TRANSFORM_SUB_TYPES: frozenset[str] = frozenset(
    {
        "StringSplit",
        "RegexExtract",
        "MathExpr",
        "DateFormat",
        "Lookup",
        "Strip",
        "UpperCase",
        "LowerCase",
        "Replace",
        "FillNA",
        "FilterRows",
        "DropDuplicates",
        "CastType",
        "Concat",
        "Substring",
        "Aggregate",
        "ConditionalAssign",
        "SortRows",
        "Digits",
        "WeightedSum",
        "Modulo",
        "MapValue",
    }
)

# Schema 列数据类型白名单——与运行时 TYPE_REGISTRY（domain/schema/builder.py）支持的
# 6 种列类型严格一致。datetime/time 运行时不支持：按旧白名单写盘成功后，校验引擎加载
# schema 时 build_type_from_config 对未知类型直接 raise，导致每次校验都失败。
DATA_TYPES: frozenset[str] = frozenset({"string", "integer", "float", "decimal", "boolean", "date"})

# 设置分类白名单
SETTINGS_CATEGORIES: frozenset[str] = frozenset({"validation", "fileProcessing", "scriptSecurity"})

# ADD_TO_CANVAS 支持的资源类型
CANVAS_RESOURCE_KINDS: frozenset[str] = frozenset({"schema", "regex", "constraint", "transform"})


# =============================================================================
# 动作类型定义
# =============================================================================


@dataclass(frozen=True)
class ActionTypeDef:
    """单个动作类型的声明性定义。

    Attributes:
        type: actionType 字符串，如 "ADD_SCHEMA"
        spec_field: 对应的 spec 字段名，如 "schemaSpec"（None 表示无 spec，如 VALIDATE_PROJECT）
        category: 动作家族，用于分类桶：constraint/schema/regex/transform/settings/canvas/validate
        read_only: True=不写盘（纯读），False=写盘动作
    """

    type: str
    spec_field: str | None
    category: str
    read_only: bool


# 动作类型唯一注册表——新增动作只需在此加一行，其余派生属性自动更新
ACTIONS: dict[str, ActionTypeDef] = {
    # 约束 CRUD（写盘）
    "ADD_CONSTRAINT_NODE": ActionTypeDef("ADD_CONSTRAINT_NODE", "constraintSpec", "constraint", False),
    "UPDATE_CONSTRAINT_NODE": ActionTypeDef("UPDATE_CONSTRAINT_NODE", "constraintSpec", "constraint", False),
    "DELETE_CONSTRAINT_NODE": ActionTypeDef("DELETE_CONSTRAINT_NODE", "constraintSpec", "constraint", False),
    # Schema CRUD（写盘）
    "ADD_SCHEMA": ActionTypeDef("ADD_SCHEMA", "schemaSpec", "schema", False),
    "UPDATE_SCHEMA": ActionTypeDef("UPDATE_SCHEMA", "schemaSpec", "schema", False),
    "DELETE_SCHEMA": ActionTypeDef("DELETE_SCHEMA", "schemaSpec", "schema", False),
    # Regex CRUD（写盘）
    "ADD_REGEX": ActionTypeDef("ADD_REGEX", "regexSpec", "regex", False),
    "UPDATE_REGEX": ActionTypeDef("UPDATE_REGEX", "regexSpec", "regex", False),
    "DELETE_REGEX": ActionTypeDef("DELETE_REGEX", "regexSpec", "regex", False),
    # Transform CRUD（写盘）
    "ADD_TRANSFORM": ActionTypeDef("ADD_TRANSFORM", "transformSpec", "transform", False),
    "UPDATE_TRANSFORM": ActionTypeDef("UPDATE_TRANSFORM", "transformSpec", "transform", False),
    "DELETE_TRANSFORM": ActionTypeDef("DELETE_TRANSFORM", "transformSpec", "transform", False),
    # 设置（写盘）
    "UPDATE_SETTINGS": ActionTypeDef("UPDATE_SETTINGS", "settingsSpec", "settings", False),
    # 校验（只读）
    "VALIDATE_PROJECT": ActionTypeDef("VALIDATE_PROJECT", "constraintSpec", "validate", True),
    # 显示到画布（只读，不写盘）
    "ADD_TO_CANVAS": ActionTypeDef("ADD_TO_CANVAS", "canvasSpec", "canvas", True),
}


# =============================================================================
# 派生属性（自动生成，禁止手动维护）
# =============================================================================

# 全部动作类型列表（顺序稳定，供 LLM enum 与提示词清单）
ALL_ACTION_TYPES: list[str] = [a.type for a in ACTIONS.values()]

# LLM 工具 schema 的 enum 数组
ACTION_ENUM: list[str] = ALL_ACTION_TYPES

# 动作总数（消灭硬编码 "15种"）
ACTION_COUNT: int = len(ACTIONS)

# 按 category 分组的动作集合（先收集到普通 set，再冻结为 frozenset）
_category_buckets: dict[str, set[str]] = {}
for _a in ACTIONS.values():
    _category_buckets.setdefault(_a.category, set()).add(_a.type)
BY_CATEGORY: dict[str, frozenset[str]] = {k: frozenset(v) for k, v in _category_buckets.items()}

# 家族集合的便捷别名（最常引用的几个）
CONSTRAINT_ACTION_TYPES: frozenset[str] = BY_CATEGORY["constraint"]
SCHEMA_ACTION_TYPES: frozenset[str] = BY_CATEGORY["schema"]
REGEX_ACTION_TYPES: frozenset[str] = BY_CATEGORY["regex"]
TRANSFORM_ACTION_TYPES: frozenset[str] = BY_CATEGORY["transform"]
# canvas 类动作（category="canvas"，当前仅 ADD_TO_CANVAS）。无画布客户端（CLI）经
# canvas_enabled 开关按此集合裁剪动作面，不在各消费方硬编码动作名清单
CANVAS_ACTION_TYPES: frozenset[str] = BY_CATEGORY["canvas"]

# 只读动作集合（不写盘）
READ_ONLY_ACTION_TYPES: frozenset[str] = frozenset(a.type for a in ACTIONS.values() if a.read_only)

# 写盘动作集合（READ_ONLY 的补集）
WRITE_ACTION_TYPES: frozenset[str] = frozenset(a.type for a in ACTIONS.values() if not a.read_only)

# actionType → spec 字段映射（None 表示无 spec 字段要求）
SPEC_FIELD_FOR: dict[str, str | None] = {a.type: a.spec_field for a in ACTIONS.values()}


def get_action_def(action_type: str) -> ActionTypeDef | None:
    """查询动作定义，不存在返回 None。"""
    return ACTIONS.get(action_type)


def filter_action_types(exclude_categories: frozenset[str] | set[str] | None = None) -> list[str]:
    """按 category 过滤动作类型清单（保持注册表顺序），供 LLM 工具 schema enum 等消费方裁剪动作面。

    分类信息从注册表派生（单一事实源），调用方只声明要排除的 category（如
    无画布环境排除 {"canvas"}），不硬编码动作名清单；缺省 None 时返回全量。
    """
    if not exclude_categories:
        return list(ALL_ACTION_TYPES)
    return [a.type for a in ACTIONS.values() if a.category not in exclude_categories]


def is_read_only(action_type: str) -> bool:
    """判断动作是否只读（不写盘）。未知动作视为写（保守）。"""
    d = ACTIONS.get(action_type)
    return d.read_only if d else False


def is_known_action(action_type: str) -> bool:
    """判断是否为已注册的动作类型。"""
    return action_type in ACTIONS


# =============================================================================
# 提示词文本派生（从注册表生成 LLM 可见的动作清单，消灭手写源文本漂移）
# =============================================================================

# category 的中文标签（用于提示词动作清单的分组标题）
_CATEGORY_LABELS: dict[str, str] = {
    "constraint": "约束",
    "schema": "Schema",
    "regex": "正则",
    "transform": "转换",
    "settings": "设置",
    "validate": "校验",
    "canvas": "显示到画布",
}


def build_action_type_list_text(exclude_categories: frozenset[str] | set[str] | None = None) -> str:
    """生成 actionType 可选值清单（按 category 分组），供系统提示词使用。

    新增动作后自动出现在此清单，无需手动同步提示词文本。
    exclude_categories：需排除的 category 集合（如无画布环境排除 {"canvas"}），
    从注册表分类派生、调用方不硬编码动作名；缺省 None 时全量输出（默认行为不变）。
    """
    lines: list[str] = []
    for category, types in BY_CATEGORY.items():
        if exclude_categories and category in exclude_categories:
            continue
        label = _CATEGORY_LABELS.get(category, category)
        types_sorted = " / ".join(sorted(types))
        suffix = ""
        # ADD_TO_CANVAS 特殊标注"不写盘"
        if category == "canvas":
            suffix = "（把已存在的配置显示到画布，不写盘）"
        lines.append(f"- {label}: {types_sorted}{suffix}")
    return "\n".join(lines)


def build_data_type_list_text() -> str:
    """生成 Schema 列数据类型清单（逗号分隔），供系统提示词使用。

    从 DATA_TYPES 派生，新增类型后自动出现在此清单，无需手动同步提示词文本。
    """
    return ", ".join(sorted(DATA_TYPES))


def build_spec_field_mapping_text(exclude_categories: frozenset[str] | set[str] | None = None) -> str:
    """生成 actionType → spec 字段映射清单，供系统提示词使用。

    从 SPEC_FIELD_FOR 派生，新增动作后自动更新。
    exclude_categories：需排除的 category 集合（如无画布环境排除 {"canvas"}），
    缺省 None 时全量输出（默认行为不变）。
    """
    # spec 字段的中文说明（用于提示词）
    _spec_notes: dict[str, str] = {
        "constraintSpec": "含 type, tableName, targetColumn, isInline, params 等；constraintId 可选，缺省系统自动生成唯一 ID",
        "schemaSpec": "含 name, columns, source",
        "regexSpec": "含 name, pattern, matchMode",
        "transformSpec": "含 type, inputColumn, params, outputColumns",
        "settingsSpec": "含 category, settings",
        "canvasSpec": "含 resourceKind: schema/regex/constraint/transform, resourceId 或 resourceName",
    }
    lines: list[str] = []
    for category, types in BY_CATEGORY.items():
        if exclude_categories and category in exclude_categories:
            continue
        label = _CATEGORY_LABELS.get(category, category)
        # 取该 category 第一个动作的 spec 字段（同 category 共享 spec 字段）
        sample_type = sorted(types)[0]
        spec_field = SPEC_FIELD_FOR.get(sample_type)
        if spec_field is None:
            continue
        note = _spec_notes.get(spec_field, "")
        # 特殊：校验动作用 constraintSpec 但 tableName 可选
        if category == "validate":
            note = "含 tableName，可选"
        lines.append(f"- {label}动作 → {spec_field} ({note})" if note else f"- {label}动作 → {spec_field}")
    return "\n".join(lines)


def _render_param_doc_fragment(param: ConstraintParamDoc, key: str) -> str:
    """渲染单个参数片段：`key` (类型) ("值" 说明 / …，默认 X)（补充说明）。"""
    fragment = f"`{key}`"
    if param.vtype:
        fragment += f" ({param.vtype})"
    if param.values:
        rendered = " / ".join(f'"{value}"{f" {gloss}" if gloss else ""}' for value, gloss in param.values)
        fragment += f" ({rendered}"
        if param.default:
            fragment += f"，默认 {param.default}"
        fragment += ")"
    if param.note:
        fragment += f"（{param.note}）"
    return fragment


def build_constraint_param_docs_text() -> str:
    """生成约束类型与参数说明清单（chat 系统提示词用，camelCase / AI 动作层口径）。

    从 CONSTRAINT_PARAM_SCHEMAS 派生，新增约束类型漏写参数文档时守卫测试即红，
    无需手动同步提示词文本。带 group 的参数（如 DateLogic 的两种模式）渲染为
    "  - " 缩进子行；仅 V2 文件层的参数（camel 为空）不渲染。
    """
    lines: list[str] = []
    for doc in CONSTRAINT_PARAM_SCHEMAS.values():
        main_fragments = [_render_param_doc_fragment(p, p.camel) for p in doc.params if p.group == "" and p.camel]
        grouped: dict[str, list[str]] = {}
        for p in doc.params:
            if p.group and p.camel:
                grouped.setdefault(p.group, []).append(_render_param_doc_fragment(p, p.camel))
        head = f"- **{doc.type}**: {doc.summary}。"
        if main_fragments:
            head += f"参数：{'，'.join(main_fragments)}。"
        elif doc.spec_note:
            head += doc.spec_note
        else:
            head += "参数：无。"
        lines.append(head)
        for label, fragments in grouped.items():
            lines.append(f"  - {label}：{'，'.join(fragments)}")
        for note in doc.sub_notes:
            lines.append(f"  - {note}")
    return "\n".join(lines)


def build_constraint_param_docs_structured() -> list[dict[str, Any]]:
    """生成约束参数的结构化描述（MCP describe_constraints 等 V2 文件层消费方用）。

    每个类型：{"type", "refs", "params": [{"key", "type", "values", "default", "description"}]}。
    只输出落在 V2 文件 params 区的 snake_case 键——写入 refs 的键由 refs 字段描述
    （如 ForeignKey 的 to_table_id），AI 动作层专有键（如 Scripted 的 pattern）跳过。
    """
    types: list[dict[str, Any]] = []
    for doc in CONSTRAINT_PARAM_SCHEMAS.values():
        params: list[dict[str, Any]] = []
        for p in doc.params:
            if not p.snake:
                continue
            entry: dict[str, Any] = {"key": p.snake}
            if p.vtype:
                entry["type"] = p.vtype
            if p.values:
                entry["values"] = [{"value": v, "desc": g} for v, g in p.values]
            if p.default:
                entry["default"] = p.default
            if p.note:
                entry["description"] = p.note
            params.append(entry)
        types.append({"type": doc.type, "refs": doc.refs, "params": params})
    return types


# =============================================================================
# Codegen 导出（供 frontend/scripts/codegen.mjs 通过 subprocess 读取）
# =============================================================================


def export_for_codegen() -> dict[str, object]:
    """将动作类型单一事实源序列化为 JSON-friendly dict，供前端 codegen 生成 TS 类型。

    设计要点:
    - frozenset 统一转 sorted list，保证顺序稳定（生成的 TS 文件可 diff）
    - 仅导出 codegen 所需字段（type/spec_field/category/read_only + 派生集合）
    - 纯函数、零 IO、零副作用，可在 subprocess 中安全 import 调用

    返回结构（JSON 兼容）::

        {
            "actions": [ {type, spec_field, category, read_only}, ... ],  # 按 ACTIONS 插入序
            "all_action_types": [...],
            "by_category": { "constraint": [...], ... },
            "read_only_action_types": [...],
            "write_action_types": [...],
            "constraint_types": [...],            # 约束类型标准名（PascalCase，sorted）
            "constraint_type_aliases": {...},     # 大写别名 → 标准名
        }

    constraint_types/constraint_type_aliases 供前端 codegen 生成约束类型映射，
    使前端 AI 指令处理器与后端提示词/写盘路径消费同一份约束类型清单，
    消灭"新增约束类型时前端 map/提示词漏同步"类漂移。
    """
    return {
        # 按 ACTIONS 插入序保留（dict 保序），便于生成稳定 TS
        "actions": [
            {
                "type": a.type,
                "spec_field": a.spec_field,
                "category": a.category,
                "read_only": a.read_only,
            }
            for a in ACTIONS.values()
        ],
        "all_action_types": list(ALL_ACTION_TYPES),
        "by_category": {k: sorted(v) for k, v in BY_CATEGORY.items()},
        "read_only_action_types": sorted(READ_ONLY_ACTION_TYPES),
        "write_action_types": sorted(WRITE_ACTION_TYPES),
        "constraint_types": sorted(CONSTRAINT_TYPES),
        "constraint_type_aliases": dict(sorted(CONSTRAINT_TYPE_ALIASES.items())),
    }
