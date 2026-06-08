"""
@fileoverview FillNA 转换运行器

功能概述:
- 填充空值（NaN/None）
- 支持多种填充策略：固定值、前向填充、后向填充、均值、中位数

参数:
    strategy: 填充策略 ("value"|"ffill"|"bfill"|"mean"|"median")
    value: 当 strategy=="value" 时的填充值
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class FillNARunner(TransformRunner):
    """@classdesc 空值填充转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 空值填充转换

        业务用途:
        - TransformRunner 协议的标准入口，由 transform 节点调用
        - 读取 params 中的转换参数，对 input_column 应用转换，输出到 output_columns

        参数:
            df: 源 DataFrame
            input_column: 输入列名
            params: 转换参数字典
            output_columns: 目标输出列名列表

        返回:
            转换后的 DataFrame
        """
        strategy = params.get("strategy", "value")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("FillNA 需要至少一个 output_columns")

        output_col = output_columns[0]
        series = df[input_column].copy()

        if strategy == "value":
            fill_value = params.get("value", "")
            series = series.fillna(fill_value)
        elif strategy == "ffill":
            series = series.ffill()
        elif strategy == "bfill":
            series = series.bfill()
        elif strategy == "mean":
            numeric_series = pd.to_numeric(series, errors="coerce")
            series = numeric_series.fillna(numeric_series.mean())
        elif strategy == "median":
            numeric_series = pd.to_numeric(series, errors="coerce")
            series = numeric_series.fillna(numeric_series.median())
        else:
            raise ValueError(f"不支持的 FillNA 策略: {strategy}")

        df[output_col] = series
        return df
