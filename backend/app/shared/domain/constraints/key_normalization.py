# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 约束键值数值归一化（domain 纯逻辑，FK 与 AllowedValues 共用）

口径（2026-09-18 拍板 §1.10/§1.11）：
- 尾随零双侧对称去除：123.10 ≡ 123.1（字符串/float/Decimal 同一语义）
- Decimal 整数值规整为整数字符串：Decimal("1.0") ≡ 1
- 去尾随零用字符串操作而非 float 中转，避免 17 位以上键值丢精度
"""

from __future__ import annotations

import re
from decimal import Decimal

# 十进制形式（含小数点）的字符串；科学计数/非数值不匹配，原样返回
_DECIMAL_STR_RE = re.compile(r"(-?\d+)\.(\d+)")


def strip_trailing_decimal_zeros(s: str) -> str:
    """十进制字符串去尾随零（"123.10"→"123.1"、"123.00"→"123"），非十进制形式原样返回。

    不做 strip/大小写处理——调用方自行决定前后空白语义。
    """
    m = _DECIMAL_STR_RE.fullmatch(s)
    if not m:
        return s
    frac = m.group(2).rstrip("0")
    if not frac:
        return m.group(1)
    return f"{m.group(1)}.{frac}"


def integral_number_to_str(v: float | Decimal) -> str | None:
    """可整化的 float/Decimal 规整为整数字符串；不可整化返回 None。

    判据与 FK 归一（foreign_key.py）一致：v == v.to_integral_value() / float.is_integer()。
    """
    if isinstance(v, Decimal):
        return str(int(v)) if v == v.to_integral_value() else None
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else None
    return None
