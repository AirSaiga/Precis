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
"""@fileoverview setup_utf8_console / Windows VT 模式启用的单元测试"""

from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from app.shared.core import encoding


class _FakeDword:
    """模拟 wintypes.DWORD：承载 GetConsoleMode 读出的控制台模式值。"""

    def __init__(self, value: int = 0) -> None:
        self.value = value


class _FakeWintypes:
    DWORD = _FakeDword
    HANDLE = None


def _make_fake_ctypes(*, console_modes: dict[int, int], handles: dict[int, int | None]):
    """构造假 ctypes 模块：记录 SetConsoleMode 调用，可模拟非控制台句柄。

    Args:
        console_modes: 句柄 -> 当前控制台模式（GetConsoleMode 读出值）
        handles: STD 句柄 id -> 句柄值（None 表示句柄无效）
    """
    set_calls: list[tuple[int, int]] = []

    def get_std_handle(handle_id: int):
        return handles.get(handle_id)

    def get_console_mode(handle, mode_ref) -> int:
        if handle not in console_modes:
            return 0  # 非控制台句柄（重定向）
        mode_ref.value = console_modes[handle]
        return 1

    def set_console_mode(handle, mode: int) -> int:
        set_calls.append((handle, mode))
        return 1

    kernel32 = SimpleNamespace(
        GetStdHandle=get_std_handle,
        GetConsoleMode=get_console_mode,
        SetConsoleMode=set_console_mode,
    )
    fake_ctypes = SimpleNamespace(
        windll=SimpleNamespace(kernel32=kernel32),
        wintypes=_FakeWintypes,  # from ctypes import wintypes 走属性查找
        byref=lambda obj: obj,
    )
    return fake_ctypes, set_calls


def test_enable_vt_noop_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    encoding._enable_windows_vt_mode()  # 不应抛错、不应访问 ctypes.windll


def test_enable_vt_sets_flag_on_console_handles(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_ctypes, set_calls = _make_fake_ctypes(
        console_modes={101: 0x1, 102: 0x1},
        handles={-11: 101, -12: 102},
    )
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)
    monkeypatch.setitem(sys.modules, "ctypes.wintypes", _FakeWintypes)

    encoding._enable_windows_vt_mode()

    assert set_calls == [(101, 0x1 | 0x4), (102, 0x1 | 0x4)]


def test_enable_vt_skips_redirected_handles(monkeypatch: pytest.MonkeyPatch) -> None:
    # stderr 被重定向（不在 console_modes 中）且 stdout 句柄无效
    fake_ctypes, set_calls = _make_fake_ctypes(
        console_modes={},
        handles={-11: None, -12: 102},
    )
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)
    monkeypatch.setitem(sys.modules, "ctypes.wintypes", _FakeWintypes)

    encoding._enable_windows_vt_mode()

    assert set_calls == []


def test_enable_vt_tolerates_kernel32_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(handle_id: int):
        raise OSError("win32 error")

    fake_ctypes, _ = _make_fake_ctypes(console_modes={}, handles={})
    fake_ctypes.windll.kernel32.GetStdHandle = boom
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)
    monkeypatch.setitem(sys.modules, "ctypes.wintypes", _FakeWintypes)

    encoding._enable_windows_vt_mode()  # 静默降级，不抛错
