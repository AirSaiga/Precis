"""
@fileoverview 条件注册表模块

功能概述:
- 维护全局 CONDITION_REGISTRY 字典，管理条件判断函数
- 提供 register_condition 装饰器，支持通过字符串名称注册和引用条件函数
- 内置常用条件函数：is_not_empty、is_positive_number 等
- 供 ConditionalConstraint 引用已注册的条件函数

架构设计:
- 装饰器注册模式: 通过 @register_condition("name") 将函数注册到全局字典
- 运行时可覆盖: 重复注册时发出警告并覆盖

输入示例:
    @register_condition("is_adult")
    def is_adult(value):
        return value >= 18

    # 在约束配置中通过 "is_adult" 引用

输出示例:
    CONDITION_REGISTRY = {"is_not_empty": <function>, "is_adult": <function>}
"""

from __future__ import annotations

from collections.abc import Callable

# 1. 标准库导入
from typing import Any

# 2. 第三方库导入
import pandas as pd

# ============================================================================
# 全局条件注册表
# ============================================================================
# CONDITION_REGISTRY 是一个全局字典，用于存储所有已注册的条件判断函数。
# 键为条件名称（字符串），值为对应的判断函数（接收任意参数，返回布尔值）。
# ConditionalConstraint 可以通过字符串名称引用这里注册的条件函数。
CONDITION_REGISTRY: dict[str, Callable[[Any], bool]] = {}


def register_condition(name: str):
    r"""
    @functiondesc 条件函数注册装饰器

    用于将条件判断函数注册到 CONDITION_REGISTRY 中。
    支持通过字符串引用已注册的条件函数，实现配置的灵活性。

    参数:
        name: 条件函数名称，后续可通过此名称引用

    返回:
        装饰器函数，接收原始函数并返回原始函数

    副作用:
        修改全局 CONDITION_REGISTRY 字典

    示例:
        @register_condition("is_adult")
        def is_adult(value):
            return value >= 18

        # 之后可以通过 CONDITION_REGISTRY["is_adult"](20) 调用
    """

    def decorator(func: Callable[[Any], bool]) -> Callable[[Any], bool]:
        # 如果名称已存在，发出警告并覆盖
        if name in CONDITION_REGISTRY:
            print(f"警告: 正在覆盖已注册的条件 '{name}'")
        CONDITION_REGISTRY[name] = func
        return func

    return decorator


@register_condition("is_not_empty")
def _is_not_empty(value: Any) -> bool:
    """
    @functiondesc 判断值是否非空

    判断逻辑: 不是 NaN(通过 pandas.notna 判断) 且不是空字符串

    参数:
        value: 任意类型的值

    返回:
        True 表示值非空，False 表示值为空（None、NaN、空字符串）
    """

    return bool(pd.notna(value)) and value != ""


@register_condition("is_positive_number")
def _is_positive_number(value: Any) -> bool:
    """
    @functiondesc 判断值是否为正数

    尝试将值转换为浮点数并判断是否大于 0。
    转换失败时返回 False（这是保守策略，避免误判）。

    参数:
        value: 任意类型的值

    返回:
        True 表示值是正数，False 表示值不是正数或无法转换为数字
    """

    try:
        return float(value) > 0
    except (ValueError, TypeError):
        return False
