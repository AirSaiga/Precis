"""
@fileoverview Modulo 转换运行器

功能概述:
- 对数值列取模运算

参数:
    divisor: 除数（模数），默认 1

输入输出:
    输入: 266
    输出: 2 (266 % 11)
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class ModuloRunner(TransformRunner):
    """@classdesc 取模转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 取模转换

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
        divisor = params.get("divisor", 1)
        if divisor == 0:
            raise ValueError("Modulo 的 divisor 不能为 0")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "modulo_result"

        df[output_col] = pd.to_numeric(df[input_column], errors="coerce") % divisor
        df[output_col] = df[output_col].astype("Int64")

        return df
