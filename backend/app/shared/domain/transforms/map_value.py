"""
@fileoverview MapValue 转换运行器

功能概述:
- 以上游值作为索引，查表映射到对应元素
- 索引越界或无法解析时保留原值

参数:
    mapping: 映射数组（如 ["1","0","X","9","8","7","6","5","4","3","2"]）

输入输出:
    输入: 2
    输出: "X"（mapping[2]）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class MapValueRunner(TransformRunner):
    """@classdesc 查表映射转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 值映射转换

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
        mapping = params.get("mapping", [])
        if not mapping:
            raise ValueError("MapValue 需要 mapping 参数")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "mapped"

        mapping_arr = list(mapping)
        numeric_idx = pd.to_numeric(df[input_column], errors="coerce")
        in_range = numeric_idx.notna() & (numeric_idx >= 0) & (numeric_idx < len(mapping_arr))
        idx_int = numeric_idx.where(in_range)
        mapped = idx_int.apply(
            lambda x: mapping_arr[int(x)] if pd.notna(x) and 0 <= int(x) < len(mapping_arr) else None
        )
        df[output_col] = mapped.where(in_range, df[input_column])

        return df
