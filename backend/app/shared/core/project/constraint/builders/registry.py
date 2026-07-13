"""@fileoverview 约束构建器注册表

核心入口：build_kwargs(type_name, inp) → BuilderResult
各约束类型通过 register_builder 装饰器注册到 CONSTRAINT_BUILDERS 字典。
未注册的类型返回 (None, None)，由 factory 走通用降级路径。

设计（参考前端 nodeDataBuilder/registry.ts）：
- 注册表是 dict[type_name, BuilderFn]
- 新增约束类型 = 在对应 builder 文件加一个 @register_builder，其余自动派生
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import BuilderFn, BuilderInput, BuilderResult


# 构建器注册表：type_name -> BuilderFn
CONSTRAINT_BUILDERS: dict[str, BuilderFn] = {}


def register_builder(type_name: str):
    """装饰器：注册约束构建器到 CONSTRAINT_BUILDERS。

    用法：
        @register_builder("NotNull")
        def build_not_null(inp: BuilderInput) -> BuilderResult:
            ...
    """

    def decorator(fn: BuilderFn) -> BuilderFn:
        CONSTRAINT_BUILDERS[type_name] = fn
        return fn

    return decorator


def build_kwargs(type_name: str, inp: BuilderInput) -> BuilderResult | None:
    """主入口：根据约束类型查找构建器并执行。

    :return: (kwargs, error) 元组；若类型未注册返回 None（调用方走通用降级）
    """
    builder = CONSTRAINT_BUILDERS.get(type_name)
    if builder is None:
        return None
    return builder(inp)
