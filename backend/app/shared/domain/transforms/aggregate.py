"""
@fileoverview Aggregate 转换运行器

功能概述:
- 对 DataFrame 进行聚合操作
- 支持分组聚合（group_by）和整表聚合
- 支持 count/sum/avg/min/max 聚合函数

参数:
    aggregations: 聚合配置列表 [{column, func}]
        - column: 聚合目标列名
        - func: 聚合函数 ("count"|"sum"|"avg"|"min"|"max")
    group_by: 分组列名（逗号分隔字符串），留空则整表聚合

说明:
    - input_column 被忽略（操作整表而非单列）
    - output_columns 定义聚合结果的列名（按 aggregations 顺序对应）
      如果 output_columns 未提供或不足，则自动生成 "func_column" 格式列名
    - 输出 DataFrame 索引重置为连续 0-based
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner

# pandas agg 函数名映射
_FUNC_MAP = {
    "count": "count",
    "sum": "sum",
    "avg": "mean",
    "min": "min",
    "max": "max",
}


class AggregateRunner(TransformRunner):
    """@classdesc 聚合转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行聚合转换

        业务用途:
        - 从 params.aggregations 读取 [{column, func}, ...] 配置
        - 若指定 group_by 则按其分组聚合；否则整表聚合
        - 输出列名优先取 output_columns[i]，缺省按 func_column 自动生成

        参数:
            df: 源 DataFrame
            input_column: 输入列名（聚合场景忽略）
            params: 包含 aggregations / group_by 的参数字典
            output_columns: 用户指定的输出列名列表

        返回:
            聚合后的 DataFrame

        异常:
            ValueError: aggregations 为空或列名不存在
        """
        aggregations = params.get("aggregations", [])
        group_by_str = params.get("group_by", "")

        if not aggregations:
            raise ValueError("Aggregate 需要至少一个 aggregation 配置")

        # 解析 group_by：逗号分隔字符串 → 列名列表
        group_by = None
        if group_by_str and isinstance(group_by_str, str):
            group_by = [col.strip() for col in group_by_str.split(",") if col.strip()]
            group_by = [col for col in group_by if col in df.columns]
            if not group_by:
                group_by = None

        # 构建 agg 字典：{输出列名: (源列名, pandas函数名)}
        agg_dict: dict[str, tuple[str, str]] = {}
        col_names: list[str] = []

        for i, agg in enumerate(aggregations):
            col = agg.get("column", "")
            func = agg.get("func", "count")

            if col not in df.columns:
                raise ValueError(f"聚合列不存在: {col}")

            pandas_func = _FUNC_MAP.get(func, "count")

            # 确定输出列名：优先使用 output_columns，否则自动生成
            if output_columns and i < len(output_columns):
                out_name = output_columns[i]
            else:
                out_name = f"{func}_{col}"

            agg_dict[out_name] = pd.NamedAgg(column=col, aggfunc=pandas_func)
            col_names.append(out_name)

        # 执行聚合
        if group_by:
            result = df.groupby(group_by, dropna=False).agg(**agg_dict).reset_index()
        else:
            # 整表聚合：groupby(None) 产生单行结果
            result = df.agg(**agg_dict).to_frame().T

        # 确保列顺序：group_by 列 + 聚合结果列
        result = result.reset_index(drop=True)
        return result
