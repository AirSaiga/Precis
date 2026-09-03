"""
@fileoverview Transform 运行器抽象基类模块

功能概述:
- 定义所有 Transform 运行器的统一接口
- 提供 execute(df, input_column, params) -> pd.DataFrame 契约
- 提供条件求值共享函数 evaluate_condition

架构设计:
- 抽象基类模式: TransformRunner 定义接口，子类实现具体转换逻辑
- 单列输入: 每个 transform 操作单列，输出新列到同一 DataFrame
- evaluate_condition: 条件类 Transform（conditional_assign / filter_rows）共享的条件求值逻辑
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import pandas as pd


def stringify_preserve_null(series: pd.Series) -> pd.Series:
    """转字符串并保留空值：NaN/None → None，其余值 astype(str)。

    各字符串型 runner 的输出列统一用此助手——裸 astype(str) 会把空值变成
    "nan"/"None" 字面量写入输出列，污染下游数据（如拼接出 "Nonez"、
    条件匹配命中 "nan"）。
    """
    result = series.astype(str)
    return result.where(series.notna(), None)


def evaluate_condition(df: pd.DataFrame, cond: dict[str, Any]) -> pd.Series:
    """评估单个条件，返回布尔 Series。

    支持 eq/ne/gt/gte/lt/lte/contains/startswith/endswith/in/not_in/is_null/is_not_null 操作符。
    被 ConditionalAssignRunner 和 FilterRowsRunner 共享。

    空值语义：NaN/None 行对除 is_null/is_not_null 外的所有操作符一律返回 False
    （对齐 SQL 的 NULL 比较语义）——裸 astype(str) 会把空值字符串化成 "nan"，
    导致 eq "nan"、contains "an" 等误命中。

    Args:
        df: 输入 DataFrame
        cond: 条件字典，包含 column, op, value

    Returns:
        布尔 Series；列不存在或操作符未知时返回全 False
    """
    column = cond.get("column", "")
    op = cond.get("op", "eq")
    value = cond.get("value")

    if column not in df.columns:
        return pd.Series([False] * len(df), index=df.index)

    series = df[column]

    if op == "is_null":
        return series.isna() | (series.astype(str).str.strip() == "")
    elif op == "is_not_null":
        return ~(series.isna() | (series.astype(str).str.strip() == ""))

    result: pd.Series
    if op == "eq":
        result = series.astype(str) == str(value)
    elif op == "ne":
        result = series.astype(str) != str(value)
    elif op in ("gt", "gte", "lt", "lte"):
        numeric_series = pd.to_numeric(series, errors="coerce")
        numeric_value = pd.to_numeric(value, errors="coerce")
        if op == "gt":
            result = numeric_series > numeric_value
        elif op == "gte":
            result = numeric_series >= numeric_value
        elif op == "lt":
            result = numeric_series < numeric_value
        else:
            result = numeric_series <= numeric_value
    elif op == "contains":
        # regex=False：contains 按字面量子串匹配。过去默认按正则解释，用户数据含
        # "(未分类)"、"a.b" 等字符时会报 re.error 崩溃或产生错误匹配。
        result = series.astype(str).str.contains(str(value), na=False, regex=False)
    elif op == "startswith":
        result = series.astype(str).str.startswith(str(value), na=False)
    elif op == "endswith":
        result = series.astype(str).str.endswith(str(value), na=False)
    elif op == "in":
        values = value if isinstance(value, list) else [value]
        str_values = [str(v) for v in values]
        result = series.astype(str).isin(str_values)
    elif op == "not_in":
        values = value if isinstance(value, list) else [value]
        str_values = [str(v) for v in values]
        result = ~series.astype(str).isin(str_values)
    else:
        return pd.Series([False] * len(df), index=df.index)

    # 空值行不参与条件匹配（对齐 SQL NULL 语义）
    result = result.copy()
    result[series.isna()] = False
    return result


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
