"""
@fileoverview CastType 转换运行器

功能概述:
- 将列值转换为目标数据类型
- 支持 int、float、bool、datetime、string 五种目标类型

参数:
    target_type: 目标类型 ("int"|"float"|"bool"|"datetime"|"string")
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class CastTypeRunner(TransformRunner):
    """@classdesc 类型转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        target_type = params.get("target_type", "string")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("CastType 需要至少一个 output_columns")

        output_col = output_columns[0]
        series = df[input_column].copy()

        if target_type in ("int", "integer"):
            series = pd.to_numeric(series, errors="coerce")
            # 转为可空整数类型，避免 NaN 导致 float 强转
            try:
                series = series.astype("Int64")
            except (TypeError, ValueError):
                pass
        elif target_type == "float":
            series = pd.to_numeric(series, errors="coerce")
        elif target_type == "bool":
            series = series.apply(self._to_bool)
        elif target_type == "datetime":
            series = pd.to_datetime(series, errors="coerce")
        elif target_type == "string":
            series = series.astype(str)
            series = series.where(~pd.isna(df[input_column]), None)
        else:
            raise ValueError(f"不支持的目标类型: {target_type}")

        df[output_col] = series
        return df

    @staticmethod
    def _to_bool(value: Any) -> Any:
        """将单个值转换为布尔值。

        支持常见的布尔值字符串表示。
        无法识别的值返回 None。
        """
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        s = str(value).strip().lower()
        if s in ("true", "1", "yes", "y", "on"):
            return True
        if s in ("false", "0", "no", "n", "off"):
            return False
        return None
