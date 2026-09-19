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
"""@fileoverview 正则 flags 字符串解析（domain 纯逻辑，单一事实源）

被 core/services/domain 多处消费（regex_extract、regex/reader、validation/extractors、
dag/executor、constraints/regex），防各处自行实现漂移出子串匹配等缺陷。
"""

from __future__ import annotations

import re

# flags 短格式字符到 re 标志位的映射
_FLAG_SHORT_MAP = {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL}
# flags 长格式名称到 re 标志位的映射
_FLAG_LONG_MAP = {"ignorecase": re.IGNORECASE, "multiline": re.MULTILINE, "dotall": re.DOTALL}


def parse_regex_flags(flags_str: str | None) -> int:
    """把 flags 配置字符串解析为 re 模块标志位。

    按 逗号/空白 切分后整词匹配（大小写不敏感），支持三种格式：
    - 短格式："i" -> IGNORECASE
    - 组合短格式："im" -> IGNORECASE | MULTILINE（逐字符展开）
    - 长格式："ignorecase" -> IGNORECASE

    不得用子串匹配：`"i" in "multiline"` 为真会导致长格式误开 IGNORECASE；
    未知 token 整体忽略，不逐字符猜测。case_sensitive 的补充语义由调用方自行叠加。
    """
    flags = 0
    tokens = [tok for tok in re.split(r"[,\s]+", str(flags_str or "").strip()) if tok]
    for tok in tokens:
        lowered = tok.lower()
        if lowered in _FLAG_LONG_MAP:
            flags |= _FLAG_LONG_MAP[lowered]
        elif all(ch in _FLAG_SHORT_MAP for ch in lowered):
            # 组合短格式（如 "im"）逐字符展开；全部字符都是合法缩写才生效
            for ch in lowered:
                flags |= _FLAG_SHORT_MAP[ch]
    return flags
