"""
@fileoverview StringSplit 转换运行器

功能概述:
- 按分隔符或固定位置切割字符串
- 输出多个新列

参数:
    delimiter: 分隔符字符串（默认 " "）
    maxsplit: 最大分割次数（默认 -1，不限制）
    expand: 是否展开为多列（默认 True）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class StringSplitRunner(TransformRunner):
    """@classdesc 字符串切割转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        delimiter = params.get("delimiter", " ")
        maxsplit = params.get("maxsplit", -1)

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        series = df[input_column].astype(str)

        if maxsplit == -1:
            split_df = series.str.split(delimiter, expand=True)
        else:
            split_df = series.str.split(delimiter, n=maxsplit, expand=True)

        for i, col_name in enumerate(output_columns):
            if i < split_df.shape[1]:
                df[col_name] = split_df[i]
            else:
                df[col_name] = None

        return df
