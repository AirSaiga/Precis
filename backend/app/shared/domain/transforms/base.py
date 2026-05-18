"""
@fileoverview Transform 运行器抽象基类模块

功能概述:
- 定义所有 Transform 运行器的统一接口
- 提供 execute(df, input_column, params) -> pd.DataFrame 契约

架构设计:
- 抽象基类模式: TransformRunner 定义接口，子类实现具体转换逻辑
- 单列输入: 每个 transform 操作单列，输出新列到同一 DataFrame
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import pandas as pd


class TransformRunner(ABC):
    """@classdesc Transform 运行器抽象基类

    所有具体转换类型必须继承此类并实现 execute 方法。

    使用示例:
        class StringSplitRunner(TransformRunner):
            def execute(self, df, input_column, params):
                delimiter = params.get("delimiter", " ")
                df["output"] = df[input_column].str.split(delimiter).str[0]
                return df
    """

    @abstractmethod
    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """@methoddesc 执行数据转换

        参数:
            df: 输入 DataFrame
            input_column: 输入列名
            params: 转换参数
            output_columns: 输出列名列表

        返回:
            转换后的 DataFrame（可能包含新列）
        """
        ...
