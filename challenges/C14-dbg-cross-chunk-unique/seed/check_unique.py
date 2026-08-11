"""跨块唯一性检查（C14 seed —— 有 bug）。

模拟分块加载场景：大文件被切成多个 chunk，每个 chunk 独立校验唯一性。

当前 bug：每个 chunk 单独跑 duplicated()，导致跨块的重复（一个副本在 chunk A，
另一个在 chunk B）检测不到 —— 这正是 Precis chunked loader 的已知缺陷
（见 AGENTS.md "cross-chunk Unique has known defects"）。

任务：修复 check_unique 使其能检测跨块重复。
"""

from __future__ import annotations

import pandas as pd


def check_unique(chunks: list[pd.DataFrame], column: str) -> list[int]:
    """检查指定列在所有 chunk 中的唯一性，返回重复行的全局行号列表。

    全局行号 = 跨 chunk 连续编号（chunk0 的行 0..n，chunk1 接着 n+1..）。

    当前实现（有 bug）：每个 chunk 独立校验，跨块重复漏检。
    """
    duplicates: list[int] = []
    global_row = 0
    for chunk in chunks:
        if column not in chunk.columns:
            continue
        # BUG: 只在单个 chunk 内查重复，跨块的重复看不到
        dup_mask = chunk[column].duplicated(keep=False)
        for local_idx in chunk[dup_mask].index:
            duplicates.append(global_row + int(local_idx))
        global_row += len(chunk)
    return duplicates
