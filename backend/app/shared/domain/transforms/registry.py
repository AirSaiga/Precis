"""
@fileoverview Transform 运行器注册表

功能概述:
- 将 TransformFile.type 映射到对应的 TransformRunner 类
- 提供统一的 create_runner(type_name) 工厂函数

使用示例:
    runner = create_runner("StringSplit")
    df = runner.execute(df, "name", {"delimiter": " "}, ["first_name", "last_name"])
"""

from __future__ import annotations

from .base import TransformRunner
from .date_format import DateFormatRunner
from .digits import DigitsRunner
from .lookup import LookupRunner
from .lower_case import LowerCaseRunner
from .map_value import MapValueRunner
from .math_expr import MathExprRunner
from .modulo import ModuloRunner
from .regex_extract import RegexExtractRunner
from .replace import ReplaceRunner
from .string_split import StringSplitRunner
from .strip import StripRunner
from .substring import SubstringRunner
from .upper_case import UpperCaseRunner
from .weighted_sum import WeightedSumRunner

TRANSFORM_REGISTRY: dict[str, type[TransformRunner]] = {
    "StringSplit": StringSplitRunner,
    "RegexExtract": RegexExtractRunner,
    "MathExpr": MathExprRunner,
    "DateFormat": DateFormatRunner,
    "Lookup": LookupRunner,
    "Strip": StripRunner,
    "UpperCase": UpperCaseRunner,
    "LowerCase": LowerCaseRunner,
    "Replace": ReplaceRunner,
    "Substring": SubstringRunner,
    "Digits": DigitsRunner,
    "WeightedSum": WeightedSumRunner,
    "Modulo": ModuloRunner,
    "MapValue": MapValueRunner,
}


def create_runner(type_name: str) -> TransformRunner:
    """@methoddesc 根据类型名称创建 TransformRunner 实例

    参数:
        type_name: Transform 类型名称（如 "StringSplit"）

    返回:
        TransformRunner 实例

    异常:
        ValueError: 类型名称未注册
    """
    runner_class = TRANSFORM_REGISTRY.get(type_name)
    if not runner_class:
        raise ValueError(f"未注册的 Transform 类型: {type_name}，支持类型: {list(TRANSFORM_REGISTRY.keys())}")
    return runner_class()
