"""@fileoverview 正则工具共享函数

功能概述:
- parse_regex_flags: 统一解析正则标志字符串和大小写配置
- 供 domain/constraints/regex.py、api/routers/core/regex.py、dag/executor.py 复用
"""

from __future__ import annotations

import re


def parse_regex_flags(flags_str: str = "", case_sensitive: bool = True) -> int:
    """
    @methoddesc 解析正则标志字符串和大小写配置为 re 编译标志

    参数:
        flags_str: 标志字符串，可包含 "i"（忽略大小写）、"m"（多行）、"s"（点匹配换行）
        case_sensitive: 是否区分大小写，False 等同于追加 IGNORECASE

    返回:
        re 编译标志的位掩码
    """
    re_flags = 0
    if flags_str:
        flags_set = set(flags_str.lower())
        if "i" in flags_set:
            re_flags |= re.IGNORECASE
        if "m" in flags_set:
            re_flags |= re.MULTILINE
        if "s" in flags_set:
            re_flags |= re.DOTALL
    if not case_sensitive:
        re_flags |= re.IGNORECASE
    return re_flags
