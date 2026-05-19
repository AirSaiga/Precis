"""
@fileoverview Concat 转换运行器

功能概述:
- 将多个列的值拼接为一个新列
- 支持自定义分隔符

参数:
    columns: 要拼接的列名，逗号分隔（如 "first_name,last_name"）
    separator: 分隔符（默认空字符串）
    output_column: 输出列名（可选）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class ConcatRunner(TransformRunner):
    """@classdesc 列拼接转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        columns_str = params.get("columns", "")
        separator = params.get("separator", "")
        output_column = params.get("output_column", None)

        if not columns_str:
            raise ValueError("Concat 需要 columns 参数（要拼接的列名，逗号分隔）")

        # 解析列名列表
        column_list = [col.strip() for col in columns_str.split(",") if col.strip()]

        if not column_list:
            raise ValueError("Concat 需要至少一个列名")

        # 验证所有列都存在
        for col in column_list:
            if col not in df.columns:
                raise ValueError(f"列不存在: {col}")

        # 确定输出列名
        if output_column:
            output_col = output_column
        elif output_columns:
            output_col = output_columns[0]
        else:
            output_col = "concat_result"

        # 执行拼接
        if len(column_list) == 1:
            # 单列情况：直接复制
            df[output_col] = df[column_list[0]].astype(str)
        else:
            # 多列情况：拼接
            df[output_col] = df[column_list[0]].astype(str) + df[column_list[1:]].apply(
                lambda row: separator + row.astype(str), axis=1
            ).sum(axis=1)

        return df
