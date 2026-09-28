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

同时启用 ANSI 虚拟终端处理（VT）：以管理员身份启动的经典 conhost
未默认开启 ENABLE_VIRTUAL_TERMINAL_PROCESSING，直接 print ANSI
转义码（InteractiveMenu 的 [?25l / [32m 等）会原样显示为乱码；
且 rich 检测不到 VT 时会回退 Win32 API 上色，两处症状并存。
"""

from __future__ import annotations

import sys

# ENABLE_VIRTUAL_TERMINAL_PROCESSING：让控制台解析 ANSI 转义序列而非原样显示
_ENABLE_VT_PROCESSING = 0x0004
# STD_OUTPUT_HANDLE / STD_ERROR_HANDLE（GetStdHandle 参数）
_STD_HANDLES = (-11, -12)


def _enable_windows_vt_mode() -> None:
    """在 Windows 控制台 stdout/stderr 句柄上启用 ANSI VT 处理。

    句柄被重定向（管道/文件）时 GetConsoleMode 失败，跳过即可；
    非 Windows 或 ctypes 不可用时静默降级。
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        # 64 位下 HANDLE 是指针宽度，默认 int restype 会截断句柄
        kernel32.GetStdHandle.restype = wintypes.HANDLE
        kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
        for handle_id in _STD_HANDLES:
            handle = kernel32.GetStdHandle(handle_id)
            if not handle:
                continue
            mode = wintypes.DWORD()
            if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                continue  # 非控制台句柄（重定向到文件/管道）
            kernel32.SetConsoleMode(handle, mode.value | _ENABLE_VT_PROCESSING)
    except (OSError, AttributeError, ImportError):
        pass


def setup_utf8_console() -> None:
    """将 stdout/stderr 重配置为 UTF-8 编码（仅 Windows 需要，其他平台无害）。"""
    if sys.platform == "win32":
        _enable_windows_vt_mode()
        for stream in (sys.stdout, sys.stderr):
            if stream and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except (AttributeError, OSError):
                    pass
