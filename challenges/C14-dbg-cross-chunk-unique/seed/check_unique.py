"""跨块唯一性检查。

模拟分块加载场景：大文件被切成多个 chunk 依次加载。
check_unique(chunks, column) 校验某列在整个数据集中的唯一性，
返回所有重复行的全局行号（跨 chunk 连续编号，0-based）。

任务：修复 check_unique，使其能正确检出全部重复行。
"""

from __future__ import annotations

import pandas as pd


def check_unique(chunks: list[pd.DataFrame], column: str) -> list[int]:
    """检查指定列在所有 chunk 中的唯一性，返回重复行的全局行号列表。

    全局行号 = 跨 chunk 连续编号（chunk0 的行 0..n，chunk1 接着 n+1..）。
    """
    duplicates: list[int] = []
    global_row = 0
    for chunk in chunks:
        if column not in chunk.columns:
            continue
        dup_mask = chunk[column].duplicated(keep=False)
        for local_idx in chunk[dup_mask].index:
            duplicates.append(global_row + int(local_idx))
        global_row += len(chunk)
    return duplicates
