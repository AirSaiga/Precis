"""@fileoverview 建议工具模块

功能概述:
- 提供约束类型标准化
- 根据输入提供相似表名、字段名、约束类型的建议
- 根据字段类型建议适用的约束

输入示例:
    suggestion = suggest_similar_table("user", schema)
    normalized = normalize_constraint_type("not_null")

输出示例:
    "是否指: users?"
    "NotNull"
"""

from typing import Any

# 支持的约束类型
VALID_CONSTRAINT_TYPES = {
    "NotNull",
    "Unique",
    "Range",
    "AllowedValues",
    "ForeignKey",
    "Conditional",
    "Scripted",
    "DateLogic",
    # 别名兼容
    "NOT_NULL",
    "UNIQUE",
    "RANGE",
    "ALLOWED_VALUES",
    "FOREIGN_KEY",
    "CONDITIONAL",
    "DATE_LOGIC",
    "REGEX",
}


def normalize_constraint_type(constraint_type: str) -> str:
    """
    @methoddesc 标准化约束类型名

    将各种别名、下划线命名、小写形式统一转换为标准 PascalCase 命名。
    例如："not_null" -> "NotNull", "regex" -> "Scripted"

    参数:
        constraint_type: 原始类型名

    返回:
        标准化后的类型名

    示例:
        >>> normalize_constraint_type("not_null")
        'NotNull'
        >>> normalize_constraint_type("regex")
        'Scripted'
    """
    # 处理下划线命名和小写
    normalized = constraint_type.replace("_", "").lower()

    # 映射到标准名
    type_mapping = {
        "notnull": "NotNull",
        "unique": "Unique",
        "range": "Range",
        "allowedvalues": "AllowedValues",
        "foreignkey": "ForeignKey",
        "conditional": "Conditional",
        "scripted": "Scripted",
        "datelogic": "DateLogic",
        "regex": "Scripted",  # 别名
    }

    return type_mapping.get(normalized, constraint_type)


def suggest_similar_table(table_ref: str, schema: dict[str, Any]) -> str | None:
    """
    @methoddesc 建议相似的表名

    当用户输入的表名不存在时，通过前缀/包含匹配查找相似表名并给出建议。

    参数:
        table_ref: 用户输入的表名或 ID
        schema: 项目结构字典

    返回:
        建议文本字符串，如果没有相似表则返回 None

    示例:
        >>> suggest_similar_table("user", schema)
        '是否指: users?'
    """
    all_names = list(schema["table_name_to_id"].keys()) + list(schema["tables"].keys())

    # 简单的相似度匹配（前缀匹配）
    suggestions = [name for name in all_names if table_ref.lower() in name.lower()]

    if suggestions:
        return f"是否指: {', '.join(suggestions[:3])}?"
    return "请检查表名拼写或使用 'list tables' 查看可用表"


def suggest_similar_column(column_name: str, table_info: dict[str, Any]) -> str | None:
    """
    @methoddesc 建议相似的字段名

    当用户输入的字段名不存在时，通过包含匹配查找相似字段名并给出建议。

    参数:
        column_name: 用户输入的字段名
        table_info: 表信息字典

    返回:
        建议文本字符串，如果没有相似字段则返回 None

    示例:
        >>> suggest_similar_column("emial", table_info)
        '是否指: email?'
    """
    all_columns = [col["name"] for col in table_info["columns"].values()]

    # 简单的相似度匹配
    suggestions = [col for col in all_columns if column_name.lower() in col.lower()]

    if suggestions:
        return f"是否指: {', '.join(suggestions[:3])}?"

    available = ", ".join(list(table_info["columns"].keys())[:5])
    return f"可用字段: {available}..."


def suggest_similar_constraint_type(constraint_type: str) -> str | None:
    """
    @methoddesc 建议相似的约束类型

    当用户输入的约束类型不存在时，通过编辑距离和包含匹配查找相似类型并给出建议。

    参数:
        constraint_type: 用户输入的约束类型

    返回:
        建议文本字符串，如果没有相似类型则返回 None

    示例:
        >>> suggest_similar_constraint_type("NotNul")
        '是否指: NotNull?'
    """
    # 简单的编辑距离或包含匹配
    normalized = constraint_type.lower().replace("_", "")
    suggestions = []

    for valid_type in VALID_CONSTRAINT_TYPES:
        valid_normalized = valid_type.lower().replace("_", "")
        if normalized in valid_normalized or valid_normalized in normalized:
            suggestions.append(valid_type)

    if suggestions:
        return f"是否指: {', '.join(suggestions[:3])}?"
    return "支持的约束类型: NotNull, Unique, Range, AllowedValues, ForeignKey, Conditional, Scripted, DateLogic"


def suggest_constraints_for_type(col_type: str) -> str:
    """
    @methoddesc 根据字段类型建议适用的约束

    根据字段的数据类型返回推荐使用的约束类型列表，用于类型兼容性校验失败时的用户提示。

    参数:
        col_type: 字段类型，如 string、integer、decimal、boolean、date

    返回:
        建议的约束类型字符串

    示例:
        >>> suggest_constraints_for_type("string")
        'NotNull, Unique, AllowedValues, Scripted(Regex)'
        >>> suggest_constraints_for_type("integer")
        'NotNull, Unique, Range, AllowedValues, ForeignKey'
    """
    type_to_constraints = {
        "string": "NotNull, Unique, AllowedValues, Scripted(Regex)",
        "integer": "NotNull, Unique, Range, AllowedValues, ForeignKey",
        "decimal": "NotNull, Unique, Range, AllowedValues, ForeignKey",
        "float": "NotNull, Unique, Range, AllowedValues",
        "boolean": "NotNull, AllowedValues",
        "date": "NotNull, Range, DateLogic",
    }

    return type_to_constraints.get(col_type.lower(), "NotNull, Unique")
