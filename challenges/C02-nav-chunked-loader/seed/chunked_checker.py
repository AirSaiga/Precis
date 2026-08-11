"""分块唯一性检查器（C02 seed —— 用于理解跨块缺陷）。

模拟分块加载后的校验：每个 chunk 独立检查，跨块重复漏检。
这是 AGENTS.md / executor.py:856 文档化的 "Unique 假阴性" 缺陷。

本文件用于导航理解任务 —— 你需要读懂它，并回答 task.md 里的问题，
然后修复 find_cross_chunk_duplicates 使其正确检测跨块重复。
"""

from __future__ import annotations

import pandas as pd


def find_duplicates_in_chunk(chunk: pd.DataFrame, column: str) -> list[int]:
    """在单个 chunk 内查找重复行的本地行号。"""
    if column not in chunk.columns:
        return []
    mask = chunk[column].duplicated(keep=False)
    return [int(i) for i in chunk[mask].index]


def find_cross_chunk_duplicates(
    chunks: list[pd.DataFrame], column: str
) -> list[tuple[int, int]]:
    """查找跨块重复：返回 (chunk_index, local_row_index) 列表。

    当前实现（有 bug —— 跨块重复检测不到）：
    只在每个 chunk 内独立查重复，跨块的重复（一个值在 chunk A 出现、
    又在 chunk B 出现）完全看不到。

    这是 AGENTS.md 文档化的 chunked loader 已知缺陷。
    """
    results: list[tuple[int, int]] = []
    for chunk_idx, chunk in enumerate(chunks):
        for local_row in find_duplicates_in_chunk(chunk, column):
            results.append((chunk_idx, local_row))
    return results
