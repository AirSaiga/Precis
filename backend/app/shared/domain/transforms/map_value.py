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
        mapping = params.get("mapping", [])
        if not mapping:
            raise ValueError("MapValue 需要 mapping 参数")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        output_col = output_columns[0] if output_columns else "mapped"

        def _map_value(value: Any) -> Any:
            try:
                idx = int(float(value))
                if 0 <= idx < len(mapping):
                    return mapping[idx]
                return value
            except (ValueError, TypeError):
                return value

        df[output_col] = df[input_column].apply(_map_value)

        return df
