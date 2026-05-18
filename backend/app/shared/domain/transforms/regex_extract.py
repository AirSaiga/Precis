"""
@fileoverview RegexExtract 转换运行器

功能概述:
- 使用正则表达式从字符串中提取捕获组
- 输出多个新列（每个捕获组一列）

参数:
    pattern: 正则表达式模式（必须包含捕获组）
    flags: 正则标志（如 "i" 表示忽略大小写）
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from .base import TransformRunner


class RegexExtractRunner(TransformRunner):
    """@classdesc 正则提取转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        pattern = params.get("pattern", "")
        flags_str = params.get("flags", "")

        if not pattern:
            raise ValueError("RegexExtract 需要 pattern 参数")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        flag_values = 0
        if "i" in flags_str:
            flag_values |= re.IGNORECASE

        compiled = re.compile(pattern, flag_values)
        series = df[input_column].astype(str)

        def _extract(text: str) -> list[str | None]:
            m = compiled.search(text)
            if not m:
                return [None] * len(output_columns)
            groups = m.groups()
            result: list[str | None] = []
            for i in range(len(output_columns)):
                if i < len(groups):
                    result.append(groups[i])
                else:
                    result.append(None)
            return result

        extracted = series.apply(_extract)
        for i, col_name in enumerate(output_columns):
            df[col_name] = extracted.apply(lambda x: x[i] if x else None)

        return df
