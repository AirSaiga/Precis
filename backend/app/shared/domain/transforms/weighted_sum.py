"""
@fileoverview WeightedSum 转换运行器

功能概述:
- 对输入值按权重数组求和
- 支持两种输入格式：
  1. 纯数字字符串（如 "110101"），逐字符转数字后加权
  2. 逗号分隔数字（如 "1,1,0,1,0,1"），split 后加权

参数:
    weights: 权重数组（如 [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]）

输入输出:
    输入: "11010119900307889" 或 "1,1,0,1,0,1,1,9,9,0,0,3,0,7,8,8,9"
    输出: 266（加权和）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class WeightedSumRunner(TransformRunner):
    """@classdesc 加权求和转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 加权求和转换

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
        weights = params.get("weights", [])
        if not weights:
            raise ValueError("WeightedSum 需要 weights 参数")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "weighted_sum"

        def _weighted_sum(value: str) -> int:
            # 逗号分隔或纯字符串都支持
            if "," in str(value):
                digits = [d.strip() for d in str(value).split(",")]
            else:
                digits = list(str(value))

            total = 0
            for i, d in enumerate(digits):
                if i >= len(weights):
                    break
                try:
                    total += int(d) * weights[i]
                except (ValueError, TypeError):
                    continue
            return total

        df[output_col] = df[input_column].astype(str).apply(_weighted_sum)

        return df
