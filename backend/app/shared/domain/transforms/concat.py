"""
@fileoverview Concat 转换运行器

功能概述:
- 将多个列的值拼接为一个新列
- 支持自定义分隔符

参数:
    columns: 要拼接的列名，支持逗号分隔字符串（如 "first_name,last_name"）或列表（如 ["first_name","last_name"]）
    separator: 分隔符（默认空字符串）
    output_column: 输出列名（可选）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner, stringify_preserve_null


class ConcatRunner(TransformRunner):
    """@classdesc 列拼接转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 字符串拼接转换

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
        columns_raw = params.get("columns", "")
        separator = params.get("separator", "")
        output_column = params.get("output_column", None)

        # 解析列名列表：兼容字符串（逗号分隔）与列表两种格式
        # 前端 TagsRenderer 产出的是数组，旧配置/手写 YAML 可能是逗号分隔字符串
        if isinstance(columns_raw, list):
            column_list = [str(col).strip() for col in columns_raw if str(col).strip()]
        else:
            column_list = [col.strip() for col in str(columns_raw).split(",") if col.strip()]

        if not column_list:
            raise ValueError("Concat 需要 columns 参数（要拼接的列名，逗号分隔）")

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
            # 单列情况：直接复制（空值透传为 None，不产生 "nan"/"None" 字面量）
            df[output_col] = stringify_preserve_null(df[column_list[0]])
        else:
            # 多列情况：向量化拼接。任一源单元格为空 → 结果为 None
            # （对齐 SQL CONCAT 的 NULL 语义），避免 astype(str) 拼出 "x-None" 之类的污染值
            null_mask = df[column_list].isna().any(axis=1)
            joined = df[column_list].astype(str).agg(separator.join, axis=1)
            joined = joined.where(~null_mask, None)
            df[output_col] = joined

        return df
