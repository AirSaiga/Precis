"""
@fileoverview FilterRows 转换运行器

功能概述:
- 按条件过滤行，返回满足条件的行子集
- 支持多条件组合（AND/OR 逻辑）
- 支持 eq/ne/gt/gte/lt/lte/contains/startswith/endswith/in/not_in/is_null/is_not_null 操作符

参数:
    conditions: 条件列表 [{column, op, value}]
    logic: 条件组合逻辑 ("and"|"or")

说明:
    - input_column 被忽略（操作整行而非单列）
    - output_columns 被忽略（不产生新列，保留所有原始列）
    - 输出 DataFrame 索引重置为连续 0-based
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class FilterRowsRunner(TransformRunner):
    """@classdesc 行过滤转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        conditions = params.get("conditions", [])
        logic = params.get("logic", "and")

        if not conditions:
            # 无条件时保留所有行
            return df.reset_index(drop=True)

        # 逐个评估条件，生成布尔掩码
        masks = []
        for cond in conditions:
            mask = self._evaluate_condition(df, cond)
            masks.append(mask)

        # 组合条件
        if logic == "or":
            combined = masks[0]
            for m in masks[1:]:
                combined = combined | m
        else:
            combined = masks[0]
            for m in masks[1:]:
                combined = combined & m

        result = df.loc[combined].reset_index(drop=True)
        return result

    def _evaluate_condition(self, df: pd.DataFrame, cond: dict[str, Any]) -> pd.Series:
        """评估单个条件，返回布尔 Series"""
        column = cond.get("column", "")
        op = cond.get("op", "eq")
        value = cond.get("value")

        if column not in df.columns:
            return pd.Series([False] * len(df), index=df.index)

        series = df[column]

        if op == "eq":
            return series.astype(str) == str(value)
        elif op == "ne":
            return series.astype(str) != str(value)
        elif op in ("gt", "gte", "lt", "lte"):
            numeric_series = pd.to_numeric(series, errors="coerce")
            numeric_value = pd.to_numeric(value, errors="coerce")
            if op == "gt":
                return numeric_series > numeric_value
            elif op == "gte":
                return numeric_series >= numeric_value
            elif op == "lt":
                return numeric_series < numeric_value
            else:
                return numeric_series <= numeric_value
        elif op == "contains":
            return series.astype(str).str.contains(str(value), na=False)
        elif op == "startswith":
            return series.astype(str).str.startswith(str(value), na=False)
        elif op == "endswith":
            return series.astype(str).str.endswith(str(value), na=False)
        elif op == "in":
            values = value if isinstance(value, list) else [value]
            str_values = [str(v) for v in values]
            return series.astype(str).isin(str_values)
        elif op == "not_in":
            values = value if isinstance(value, list) else [value]
            str_values = [str(v) for v in values]
            return ~series.astype(str).isin(str_values)
        elif op == "is_null":
            return series.isna() | (series.astype(str).str.strip() == "")
        elif op == "is_not_null":
            return ~(series.isna() | (series.astype(str).str.strip() == ""))
        else:
            return pd.Series([False] * len(df), index=df.index)
