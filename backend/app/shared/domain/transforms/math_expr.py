"""
@fileoverview MathExpr 转换运行器

功能概述:
- 使用 simpleeval 沙箱计算数学表达式（B-sec5: 替代原 pandas.DataFrame.eval，消除注入面）
- 支持引用现有列作为变量

参数:
    expression: 数学表达式字符串，如 "@col_a + @col_b * 2" 或 "col_a + col_b * 2"
               （支持 @列名 语法，会自动转换为列名引用）
    output_type: 输出类型（int, float, 默认保持原样）

安全说明:
    - B-sec5: 原实现用 pandas.DataFrame.eval，其 @语法可访问局部变量/可调用对象，
      在不同 pandas 版本/引擎下存在逃逸面；表达式来自用户写入的 transforms/*.yaml，
      构成存储型代码注入风险。现改用 simpleeval（与 Scripted 约束同一沙箱），
      仅允许 SAFE_FUNCTIONS 白名单内的纯函数，禁用属性访问与 dunder。
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from app.shared.domain.eval_sandbox import make_sandbox_evaluator

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

        # 支持 @列名 语法：simpleeval 的变量绑定即列名字面量，故去除 @ 前缀。
        eval_expression = re.sub(r"@(\w+)", r"\1", expression)

        # B-sec5: 逐行用 simpleeval 沙箱求值（替代 df.eval 的注入面）。
        # names 注入该行所有列值（col_name -> cell_value），表达式如 "a + b" 直接引用列名。
        results: list[Any] = []
        # to_dict("records") 比 iterrows 快，且每行独立绑定避免跨行状态泄漏。
        for record in df.to_dict("records"):
            try:
                value = make_sandbox_evaluator(names=record).eval(eval_expression)
            except Exception as e:
                raise ValueError(f"数学表达式计算失败: {expression}, 错误: {e}")
            results.append(value)

        result_series = pd.Series(results, index=df.index)

        if output_type == "int":
            df[output_col] = pd.to_numeric(result_series, errors="coerce").astype("Int64")
        elif output_type == "float":
            df[output_col] = pd.to_numeric(result_series, errors="coerce")
        else:
            df[output_col] = result_series

        return df
