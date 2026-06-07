from __future__ import annotations

import os
import re


def normalize_to_posix(path: str) -> str:
    """将路径统一为 POSIX 格式（正斜杠、无连续斜杠、无末尾斜杠）。

    不转换大小写（文件系统操作可能需要保留原始大小写）。
    """
    if not path:
        return ""
    result = path.replace("\\", "/")
    result = re.sub(r"/+", "/", result)
    result = result.rstrip("/")
    return result


def paths_equal(a: str, b: str, *, ignore_case: bool = True) -> bool:
    """标准化后比较两个路径是否等价。

    默认忽略大小写（适用于 Windows 等不区分大小写的文件系统）。
    """
    na = normalize_to_posix(a)
    nb = normalize_to_posix(b)
    if ignore_case:
        return na.lower() == nb.lower()
    return na == nb


def make_relative(base: str, target: str) -> str:
    """计算 target 相对于 base 的相对路径，返回 POSIX 格式。

    如果无法计算相对路径（例如不同驱动器），返回 target 的 POSIX 格式。
    """
    rel = os.path.relpath(target, base)
    return normalize_to_posix(rel)
