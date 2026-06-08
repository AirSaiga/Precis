"""
@fileoverview MathExpr 转换运行器

功能概述:
- 使用 pandas eval 计算数学表达式
- 支持引用现有列作为变量

参数:
    expression: 数学表达式字符串，如 "@col_a + @col_b * 2" 或 "col_a + col_b * 2"
               （支持 @列名 语法，会自动转换为列名引用）
    output_type: 输出类型（int, float, 默认保持原样）

安全说明:
    - 使用 pandas.DataFrame.eval 进行安全计算
    - 不支持任意 Python 代码执行
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from .base import TransformRunner


class MathExprRunner(TransformRunner):
    """@classdesc 数学表达式转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 数学表达式转换

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
        expression = params.get("expression", "")
        output_type = params.get("output_type", None)

        if not expression:
            raise ValueError("MathExpr 需要 expression 参数")

        if not output_columns:
            raise ValueError("MathExpr 需要至少一个 output_columns")

        output_col = output_columns[0]

        # 支持 @列名 语法，转换为 pandas eval 所需的列名引用
        # 将 @column_name 替换为 column_name
        eval_expression = re.sub(r"@(\w+)", r"\1", expression)

        try:
            result = df.eval(eval_expression)
        except Exception as e:
            raise ValueError(f"数学表达式计算失败: {expression}, 错误: {e}")

        if output_type == "int":
            df[output_col] = pd.to_numeric(result, errors="coerce").astype("Int64")
        elif output_type == "float":
            df[output_col] = pd.to_numeric(result, errors="coerce")
        else:
            df[output_col] = result

        return df
