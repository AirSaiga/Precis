"""@fileoverview 单列约束构建器

NotNull / AllowedValues / DateLogic / Range / Charset 共享"单列映射"结构，
区别仅在于从 params 提取的额外字段。本模块用统一的 build_single_column 加上各类型的
params 适配器，消除原 factory.py 中 4 处近乎逐行重复的代码。

Charset 此前无独立分支（走通用路径导致残缺实例），此处补全修复。
"""

from __future__ import annotations

from typing import Any

from .base import BuilderInput, BuilderResult, resolve_single_column
from .registry import register_builder


def _merge_params(inp: BuilderInput, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """合并基础 kwargs 与 params 适配结果。"""
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}  # 错误由调用方处理，此处简化
    if extra:
        kwargs.update(extra)
    return kwargs


@register_builder("NotNull")
def build_not_null(inp: BuilderInput) -> BuilderResult:
    """NotNull: refs {table_id, column_id}，无 params。"""
    return resolve_single_column(inp)


@register_builder("AllowedValues")
def build_allowed_values(inp: BuilderInput) -> BuilderResult:
    """AllowedValues: refs {table_id, column_id}，params {allowed_values}。"""
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    kwargs["allowed_values"] = inp.params.get("allowed_values", [])
    return kwargs, None


@register_builder("DateLogic")
def build_date_logic(inp: BuilderInput) -> BuilderResult:
    """DateLogic: refs {table_id, column_id}，params 全量透传（filter_kwargs_for_class 兜底）。"""
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    # 将 params 中的所有参数添加到 kwargs，filter_kwargs_for_class 会过滤不需要的
    kwargs.update(inp.params)
    return kwargs, None


@register_builder("Range")
def build_range(inp: BuilderInput) -> BuilderResult:
    """Range: refs {table_id, column_id}，params {min→min_value, max→max_value, boundary_mode}。"""
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    params = inp.params
    # min -> min_value, max -> max_value 的字段重命名
    if "min" in params:
        kwargs["min_value"] = params["min"]
    if "max" in params:
        kwargs["max_value"] = params["max"]
    if "boundary_mode" in params:
        kwargs["boundary_mode"] = params["boundary_mode"]
    return kwargs, None


@register_builder("Charset")
def build_charset(inp: BuilderInput) -> BuilderResult:
    """Charset: refs {table_id, column_id}，params {charset_mode}。

    修复：此前 factory.py 无 Charset 独立分支，走通用路径导致无 table/column 的残缺实例。
    """
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    # charset_mode 默认 "ascii"（与 CharsetConstraint.__init__ 默认值一致）
    kwargs["charset_mode"] = inp.params.get("charset_mode", "ascii")
    return kwargs, None
