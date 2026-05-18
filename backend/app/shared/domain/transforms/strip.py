"""
@fileoverview Strip 转换运行器

功能概述:
- 去除字符串首尾空白字符
- 支持自定义要去除的字符集合

参数:
    chars: 要去除的字符集合（默认 None，去除所有空白）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class StripRunner(TransformRunner):
    """@classdesc 字符串去除空白转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        chars = params.get("chars", None)

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("Strip 需要至少一个 output_columns")

        output_col = output_columns[0]
        df[output_col] = df[input_column].astype(str).str.strip(chars)

        return df
