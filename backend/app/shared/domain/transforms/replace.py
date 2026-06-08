"""
@fileoverview Replace 转换运行器

功能概述:
- 将字符串中的指定内容替换为新内容
- 支持控制替换次数

参数:
    old: 要被替换的内容（必填）
    new: 替换后的新内容（默认空字符串）
    count: 最大替换次数（默认 -1，替换所有）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class ReplaceRunner(TransformRunner):
    """@classdesc 字符串替换转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 字符串替换转换

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
        old = params.get("old", "")
        new = params.get("new", "")
        count = params.get("count", -1)

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("Replace 需要至少一个 output_columns")

        output_col = output_columns[0]
        series = df[input_column].astype(str)

        if count == -1:
            df[output_col] = series.str.replace(old, new, regex=False)
        else:
            df[output_col] = series.str.replace(old, new, n=count, regex=False)

        return df
