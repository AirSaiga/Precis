"""
@fileoverview LowerCase 转换运行器

功能概述:
- 将字符串转换为小写

参数:
    无
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class LowerCaseRunner(TransformRunner):
    """@classdesc 字符串转小写转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("LowerCase 需要至少一个 output_columns")

        output_col = output_columns[0]
        df[output_col] = df[input_column].astype(str).str.lower()

        return df
