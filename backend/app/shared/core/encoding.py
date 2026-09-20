# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 控制台 UTF-8 输出编码助手（CLI 与 scripts 共用）

Windows 中文终端默认编码为 GBK (cp936)，直接 print 中文/符号
（✓ ✗ ⚠ 等）会抛 UnicodeEncodeError。在入口处调用本函数将
stdout/stderr 重配为 UTF-8（errors=replace 兜底）。
"""

from __future__ import annotations

import sys


def setup_utf8_console() -> None:
    """将 stdout/stderr 重配置为 UTF-8 编码（仅 Windows 需要，其他平台无害）。"""
    if sys.platform == "win32":
        for stream in (sys.stdout, sys.stderr):
            if stream and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except (AttributeError, OSError):
                    pass
