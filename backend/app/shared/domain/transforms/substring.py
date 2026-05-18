"""
@fileoverview Substring 转换运行器

功能概述:
- 从字符串中提取子串
- 支持 start（起始位置）、end（结束位置）、length（长度）三种参数组合

参数:
    start: 起始位置（从0开始，负数表示从末尾倒数）
    end: 结束位置（可选，不包含）
    length: 截取长度（可选，优先级高于 end）

输入输出:
    输入: "11010119900307889X"
    参数: {"start": 0, "length": 17}
    输出: "11010119900307889"
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class SubstringRunner(TransformRunner):
    """@classdesc 子串提取转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        start = params.get("start", 0)
        end = params.get("end")
        length = params.get("length")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "substring"

        def _substring(value: str) -> str:
            s = str(value)
            _start = start if start is not None else 0

            if length is not None:
                return s[_start : _start + length]
            elif end is not None:
                return s[_start:end]
            else:
                return s[_start:]

        df[output_col] = df[input_column].astype(str).apply(_substring)

        return df
