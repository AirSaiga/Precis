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
        """
        @methoddesc 执行 转小写转换

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
        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("LowerCase 需要至少一个 output_columns")

        output_col = output_columns[0]
        df[output_col] = df[input_column].astype(str).str.lower()

        return df
