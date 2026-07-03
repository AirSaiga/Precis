"""@fileoverview AI 动作注册表 — 单一事实源

本模块是所有 AI 动作类型（actionType）的唯一权威定义处。
其他模块（解析、校验、执行、前端指令生成、提示词）一律从此派生，
禁止重复硬编码动作类型集合，以消灭"同步遗漏"类 bug（如计数写错、
enum 漏条目、spec 字段映射不一致）。

三类内容在此收敛：
1. 动作类型（15种）及其 spec 字段、分类、读写性
2. 派生集合：ALL_ACTION_TYPES / BY_CATEGORY / READ_ONLY_TYPES / SPEC_FIELD_FOR 等
3. 子类型白名单：约束类型、转换子类型、数据类型、设置分类（原散落 2-4 处）

设计原则：
- 注册表只描述"是什么"（声明性），不描述"怎么做"（执行逻辑仍在各 handler）。
- 派生属性用普通函数/常量，导入即用，零运行时开销。
- 新增一个动作 = 在 ACTIONS 加一行 + 配套 validator/handler，其余全自动派生。
"""

from __future__ import annotations

from dataclasses import dataclass

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
CONSTRAINT_REQUIRED_PARAMS: dict[str, list[str]] = {
    "Range": ["min", "max"],
    "AllowedValues": ["allowedValues"],
    "ForeignKey": ["toTableId", "toColumnId"],
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

# Schema 列数据类型白名单
DATA_TYPES: frozenset[str] = frozenset({"string", "integer", "decimal", "boolean", "datetime", "date", "time", "float"})

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

# 只读动作集合（不写盘）
READ_ONLY_ACTION_TYPES: frozenset[str] = frozenset(a.type for a in ACTIONS.values() if a.read_only)

# 写盘动作集合（READ_ONLY 的补集）
WRITE_ACTION_TYPES: frozenset[str] = frozenset(a.type for a in ACTIONS.values() if not a.read_only)

# actionType → spec 字段映射（None 表示无 spec 字段要求）
SPEC_FIELD_FOR: dict[str, str | None] = {a.type: a.spec_field for a in ACTIONS.values()}


def get_action_def(action_type: str) -> ActionTypeDef | None:
    """查询动作定义，不存在返回 None。"""
    return ACTIONS.get(action_type)


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


def build_action_type_list_text() -> str:
    """生成 actionType 可选值清单（按 category 分组），供系统提示词使用。

    新增动作后自动出现在此清单，无需手动同步提示词文本。
    """
    lines: list[str] = []
    for category, types in BY_CATEGORY.items():
        label = _CATEGORY_LABELS.get(category, category)
        types_sorted = " / ".join(sorted(types))
        suffix = ""
        # ADD_TO_CANVAS 特殊标注"不写盘"
        if category == "canvas":
            suffix = "（把已存在的配置显示到画布，不写盘）"
        lines.append(f"- {label}: {types_sorted}{suffix}")
    return "\n".join(lines)


def build_spec_field_mapping_text() -> str:
    """生成 actionType → spec 字段映射清单，供系统提示词使用。

    从 SPEC_FIELD_FOR 派生，新增动作后自动更新。
    """
    # spec 字段的中文说明（用于提示词）
    _spec_notes: dict[str, str] = {
        "constraintSpec": "含 type, tableName, targetColumn, isInline, params 等",
        "schemaSpec": "含 name, columns",
        "regexSpec": "含 name, pattern, matchMode",
        "transformSpec": "含 type, inputColumn, params, outputColumns",
        "settingsSpec": "含 category, settings",
        "canvasSpec": "含 resourceKind: schema/regex/constraint/transform, resourceId 或 resourceName",
    }
    lines: list[str] = []
    for category, types in BY_CATEGORY.items():
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
