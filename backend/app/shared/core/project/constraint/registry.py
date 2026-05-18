"""
@fileoverview 约束类型注册表模块

功能概述:
- 提供约束类型名称到约束类的映射
- 支持约束类型别名（多种命名风格标准化）
- 提供参数过滤功能（根据类构造函数签名过滤参数）
- 提供支持的约束类型列表（供 API/前端发现使用）

架构设计:
- 注册中心模式: 使用字典维护约束类型与实现类的映射关系
- 名称标准化: 支持标准命名、下划线命名、驼峰命名等多种风格
- 参数过滤: 使用 inspect 模块获取类构造函数签名并过滤参数

输入示例:
    class_name = normalize_constraint_type("not_null")
    constraint_cls = CONSTRAINT_REGISTRY[class_name]

输出示例:
    kwargs = filter_kwargs_for_class(constraint_cls, {"table_id": "users", "column_id": "email"})
"""

from __future__ import annotations

# inspect 模块用于获取类构造函数的签名，实现参数过滤
import inspect
from typing import Any

# 导入所有已实现的约束类，注册到映射表中供工厂使用
from app.shared.domain import (
    AllowedValuesConstraint,
    CharsetConstraint,
    CompositeConstraint,
    ConditionalConstraint,
    DateLogicConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    ScriptedConstraint,
    UniqueConstraint,
)

# ============================================================
# 约束类型注册表
# ============================================================
# 键：约束类型标准名称（首字母大写）
# 值：约束实现类（继承自基类 Constraint）
# 用于在 factory.py 中根据类型名称获取对应的约束类

# 唯一约束：支持单列或多列组合唯一
CONSTRAINT_REGISTRY: dict[str, type] = {
    "Unique": UniqueConstraint,
    # 非空约束：列值不能为空
    "NotNull": NotNullConstraint,
    # 允许值约束：列值必须来自预定义集合
    "AllowedValues": AllowedValuesConstraint,
    # 外键约束：参照完整性校验
    "ForeignKey": ForeignKeyConstraints,
    # 区间约束：数值/日期范围校验
    "Range": RangeConstraint,
    # 条件约束：满足 IF 条件时执行 THEN 规则
    "Conditional": ConditionalConstraint,
    # 脚本约束：执行自定义表达式
    "Scripted": ScriptedConstraint,
    # 字符集约束：校验 ASCII 或中文字符
    "Charset": CharsetConstraint,
    # 日期逻辑约束：日期比较和计算
    "DateLogic": DateLogicConstraint,
    # 复合约束：包含多个子约束，按逻辑策略聚合结果
    "Composite": CompositeConstraint,
}


# ============================================================
# 约束类型别名映射表
# ============================================================
# 键：各种命名风格的类型名称
# 值：标准名称（首字母大写）
# 用于支持用户使用不同格式的类型名称

CONSTRAINT_TYPE_ALIASES: dict[str, str] = {
    # 唯一约束别名
    "unique": "Unique",
    # 非空约束别名（多种拼写）
    "not_null": "NotNull",
    "notnull": "NotNull",
    # 允许值约束别名
    "allowed_values": "AllowedValues",
    "allowedvalues": "AllowedValues",
    # 外键约束别名
    "foreign_key": "ForeignKey",
    "foreignkey": "ForeignKey",
    # 区间约束别名
    "range": "Range",
    # 条件约束别名
    "conditional": "Conditional",
    # 脚本约束别名
    "scripted": "Scripted",
    # 日期逻辑约束别名
    "datelogic": "DateLogic",
    "date_logic": "DateLogic",
}


def normalize_constraint_type(type_name: str) -> str:
    """
    @methoddesc 规范化约束类型名称。

    将各种命名风格的类型名称转换为标准名称（首字母大写）。
    查找顺序：
    1. 直接匹配（标准名称）
    2. 精确匹配别名
    3. 小写匹配别名

    :param type_name: 约束类型名称（如 "unique"、"Unique"、"not_null" 等）
    :return: 规范化后的标准名称（如 "Unique"、"NotNull" 等）
    """
    # 步骤1：检查是否是标准名称（已在注册表中）
    if type_name in CONSTRAINT_REGISTRY:
        return type_name

    # 步骤2：去除首尾空格后精确匹配别名
    key = (type_name or "").strip()
    if key in CONSTRAINT_TYPE_ALIASES:
        return CONSTRAINT_TYPE_ALIASES[key]

    # 步骤3：小写匹配（支持混合大小写输入）
    lower = key.lower()
    return CONSTRAINT_TYPE_ALIASES.get(lower, key)


def filter_kwargs_for_class(cls: type, kwargs: dict[str, Any]) -> dict[str, Any]:
    """
    @methoddesc 按类构造函数签名过滤参数。

    使用 inspect 模块获取类的 __init__ 方法签名，
    只保留kwargs中与构造函数参数名匹配的键值对。
    这确保了传入的参数不会因为类不接受而导致错误。

    :param cls: 目标类（通常是约束实现类）
    :param kwargs: 参数字典（可能包含类不接受的键）
    :return: 过滤后的参数字典（只包含类接受的键）

    示例：
        class MyConstraint:
            def __init__(self, table: str, column: str):
                ...

        kwargs = {"table": "users", "column": "email", "extra": "ignored"}
        result = filter_kwargs_for_class(MyConstraint, kwargs)
        # result = {"table": "users", "column": "email"}
        # "extra" 被过滤掉
    """
    # 获取类的构造函数签名
    sig = inspect.signature(cls.__init__)

    # 提取构造函数接受的参数名集合
    allowed = set(sig.parameters.keys())

    # 移除 "self" 参数（不属于构造函数参数）
    allowed.discard("self")

    # 过滤 kwargs，只保留允许的参数
    # 使用字典推导式进行过滤
    return {k: v for k, v in kwargs.items() if k in allowed}


def get_supported_constraint_types() -> dict[str, str]:
    """
    @methoddesc 获取当前支持的约束类型及其说明。

    返回一个字典，键为约束类型名称，值为简要说明。
    供 API 端点和前端使用，用于：
    - 约束类型下拉列表
    - 约束类型文档展示
    - 约束类型发现和验证

    :return: 约束类型与说明的字典

    返回值示例：
        {
            "Unique": "唯一约束：支持单列或多列组合",
            "NotNull": "非空约束：列值不能为空",
            ...
        }
    """
    return {
        # 唯一约束：支持单列或多列组合
        "Unique": "唯一约束：支持单列或多列组合",
        # 非空约束：列值不能为空
        "NotNull": "非空约束：列值不能为空",
        # 允许值约束：列值必须来自集合
        "AllowedValues": "允许值约束：列值必须来自集合",
        # 外键约束：参照完整性校验
        "ForeignKey": "外键约束：参照完整性校验",
        # 条件约束：满足 IF 条件时 THEN 必须满足规则
        "Conditional": "条件约束：满足 IF 条件时 THEN 必须满足规则",
        # 脚本约束：逐行执行表达式（需要 allow_unsafe_eval）
        "Scripted": "脚本约束：逐行执行表达式（需要 allow_unsafe_eval）",
        # 字符集约束：校验 ASCII 或中文字符
        "Charset": "字符集约束：校验ASCII或中文字符",
        # 日期逻辑约束：日期比较和计算
        "DateLogic": "日期逻辑约束：日期比较和计算",
        # 区间约束：数值必须在指定范围内
        "Range": "区间约束：数值必须在指定范围内",
        # 组合约束：多个子约束AND/OR组合
        "Composite": "组合约束：多个子约束AND/OR组合",
    }
