"""
@fileoverview DateFormat 转换运行器

功能概述:
- 将日期字符串从一种格式转换为另一种格式
- 支持解析失败时的容错处理

参数:
    input_format: 输入日期格式（默认 "%Y-%m-%d"）
    output_format: 输出日期格式（默认 "%Y/%m/%d"）
    errors: 错误处理策略（"coerce" 转为 NaT, "raise" 抛出异常, "ignore" 保留原值）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class DateFormatRunner(TransformRunner):
    """@classdesc 日期格式转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        input_format = params.get("input_format", "%Y-%m-%d")
        output_format = params.get("output_format", "%Y/%m/%d")
        errors = params.get("errors", "coerce")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("DateFormat 需要至少一个 output_columns")

        output_col = output_columns[0]

        parsed = pd.to_datetime(df[input_column], format=input_format, errors=errors)
        formatted = parsed.dt.strftime(output_format)
        formatted = formatted.where(parsed.notna(), None)
        df[output_col] = formatted

        return df
