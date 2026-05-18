"""
@fileoverview Digits 转换运行器

功能概述:
- 将字符串的每个字符拆分为逗号分隔的数字字符串
- 保持行数不变，输出单列字符串（如 "1,1,0,1,0,1"）

参数:
    无

输入输出:
    输入: "11010119900307889"（字符串）
    输出: "1,1,0,1,0,1,1,9,9,0,0,3,0,7,8,8,9"（逗号分隔）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class DigitsRunner(TransformRunner):
    """@classdesc 逐位分解转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "digits"

        # 将每个字符用逗号连接，保持行数不变
        df[output_col] = df[input_column].astype(str).apply(lambda x: ",".join(list(x)))

        return df
