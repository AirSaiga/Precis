"""
@fileoverview SortRows 转换运行器

功能概述:
- 对 DataFrame 按指定列和方向排序
- 支持多列排序

参数:
    sort_by: 排序规则列表 [{column, order}]
        - column: 排序列名
        - order: 排序方向 ("asc"|"desc")

说明:
    - input_column 被忽略（操作整行而非单列）
    - output_columns 被忽略（不产生新列，保留所有原始列）
    - 输出 DataFrame 索引重置为连续 0-based
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class SortRowsRunner(TransformRunner):
    """@classdesc 排序转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        sort_by = params.get("sort_by", [])

        if not sort_by:
            # 无排序规则时保持原序
            return df.reset_index(drop=True)

        # 解析排序规则
        columns = []
        ascending = []
        for rule in sort_by:
            col = rule.get("column", "")
            if col not in df.columns:
                raise ValueError(f"排序列不存在: {col}")
            columns.append(col)
            ascending.append(rule.get("order", "asc") == "asc")

        result = df.sort_values(by=columns, ascending=ascending).reset_index(drop=True)
        return result
