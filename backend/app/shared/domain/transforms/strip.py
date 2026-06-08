"""
@fileoverview Strip 转换运行器

功能概述:
- 去除字符串首尾空白字符
- 支持自定义要去除的字符集合

参数:
    chars: 要去除的字符集合（默认 None，去除所有空白）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class StripRunner(TransformRunner):
    """@classdesc 字符串去除空白转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 去除空白转换

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
        chars = params.get("chars", None)

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("Strip 需要至少一个 output_columns")

        output_col = output_columns[0]
        df[output_col] = df[input_column].astype(str).str.strip(chars)

        return df
