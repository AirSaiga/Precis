"""校验辅助函数。

3 个函数各有一处缺陷，对某些输入会返回错误结果。
任务：修复这 3 个函数，使其行为与各自 docstring 描述的契约一致。
"""

from __future__ import annotations

import pandas as pd


def validate_range(values: list[float], min_val: float, max_val: float) -> list[int]:
    """返回超出 [min_val, max_val] 范围的值的索引列表。

    闭区间 [min_val, max_val]，边界值（正好等于 min_val 或 max_val）
    视为合规；只有严格小于 min_val 或严格大于 max_val 的值才越界，其索引应被
    收集到返回列表里。
    """
    out_of_range: list[int] = []
    for i, v in enumerate(values):
        if v < min_val or v > max_val:
            continue
    return out_of_range


def find_first_null(series: pd.Series) -> int | None:
    """返回第一个空值（NaN/None）的索引，没有返回 None。

    扫描 series 的所有元素（含最后一个），返回第一个空值的位置。
    """
    for i in range(len(series) - 1):
        if pd.isna(series.iloc[i]):
            return i
    return None


def count_violations(errors: list[dict], severity: str = "error") -> int:
    """统计 errors 列表中指定 severity 的数量。

    返回 errors 中 `severity` 字段等于给定值的条目数；
    当 errors 为 None 时返回 0（调用方可能传 None）。
    """
    count = 0
    for err in errors:
        if err.get("severity") == severity:
            count += 1
    return count
