"""@fileoverview Schema ID 工具模块

功能概述:
- 提供 Schema source 标准化函数，用于唯一性检测
- 旧版路径派生 ID 逻辑已移除，Schema ID 现在由人/AI 显式命名

设计原则:
- Schema ID 不再从路径派生，而是由用户或 AI 显式提供
- 唯一性通过两层保证：ID 不重名 + (source.path, source.sheet) 不重复
- source 标准化逻辑集中在此处，前后端共用
"""

from __future__ import annotations


def normalize_source_key(path: str, sheet: str | None) -> tuple[str, str | None]:
    """标准化 source 的 (path, sheet) 元组，用于唯一性检测和索引

    处理流程：
    1. 路径：反斜杠 → 正斜杠、去 ./ 前缀、pathlib 规范化、转小写
    2. sheet：strip + 转小写；空字符串/None 统一为 None

    参数:
        path: 数据文件路径（相对或绝对）
        sheet: Excel 工作表名（非 Excel 文件传 None）

    返回:
        标准化的 (path, sheet) 元组

    示例:
        >>> normalize_source_key("data\\\\users.xlsx", "Sheet1")
        ('data/users.xlsx', 'sheet1')
        >>> normalize_source_key("./data/users.csv", None)
        ('data/users.csv', None)
        >>> normalize_source_key("data/users.xlsx", "")
        ('data/users.xlsx', None)
    """
    from pathlib import PurePosixPath

    p = str(path or "").replace("\\", "/").strip()
    if p.startswith("./"):
        p = p[2:]
    p = str(PurePosixPath(p))
    if p.startswith("./"):
        p = p[2:]
    p = p.lower()

    s: str | None = (sheet or "").strip().lower()
    s = s or None

    return (p, s)
