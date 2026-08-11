"""校验辅助函数（C13 seed —— 每个函数都有一个明显的 bug）。

任务：修复 3 个函数里的 bug，使所有测试通过。

这些是 Precis 后端校验辅助函数里常见的缺陷缩影：
- 逻辑反转（把越界的跳过、合规的留下）
- 循环范围 off-by-one（漏检最后一个元素）
- 缺失 None 守卫（调用方传 None 时崩溃）
"""

from __future__ import annotations

import pandas as pd


def validate_range(values: list[float], min_val: float, max_val: float) -> list[int]:
    """返回超出 [min_val, max_val] 范围的值的索引列表。

    正确行为：闭区间 [min_val, max_val]，边界值（正好等于 min_val 或 max_val）
    视为合规；只有严格小于 min_val 或严格大于 max_val 的值才越界，其索引应被
    收集到返回列表里。

    BUG：逻辑反了 —— 循环里对越界值执行 `continue`（跳过），从不在合规分支里
    append(i)，所以 `out_of_range` 永远是空列表，函数永远返回 `[]`。
    """
    out_of_range: list[int] = []
    for i, v in enumerate(values):
        # BUG: 越界时应该 append(i)，这里却 continue 跳过，导致返回值恒为 []
        if v < min_val or v > max_val:
            continue
    return out_of_range


def find_first_null(series: pd.Series) -> int | None:
    """返回第一个空值（NaN/None）的索引，没有返回 None。

    正确行为：扫描 series 的**所有**元素（含最后一个），返回第一个空值的位置。

    BUG：循环范围 off-by-one —— `range(len(series) - 1)` 漏掉了最后一个元素，
    当只有最后一个元素是空值时，函数会返回 None 而不是它的索引。
    """
    for i in range(len(series) - 1):  # BUG: off-by-one，漏检最后一个元素
        if pd.isna(series.iloc[i]):
            return i
    return None


def count_violations(errors: list[dict], severity: str = "error") -> int:
    """统计 errors 列表中指定 severity 的数量。

    正确行为：返回 errors 中 `severity` 字段等于给定值的条目数；
    当 errors 为 None 时返回 0（调用方可能传 None）。

    BUG：没处理 errors 为 None 的情况，直接 `for err in errors` 会抛 TypeError。
    """
    count = 0
    for err in errors:  # BUG: errors 可能是 None → TypeError
        if err.get("severity") == severity:
            count += 1
    return count
