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
"""@fileoverview 裸装（无 extras）入口指引测试（H15）

precis-mcp / precis-start 在缺少 [mcp] / [api] extra 时应给出
`pip install 'precis-cli[...]'` 指引并以退出码 1 结束，
而非裸 ModuleNotFoundError traceback（对齐 ai 门控先例 6fa1aed4）。
"""

from __future__ import annotations

import builtins

import pytest


def _block_module(monkeypatch: pytest.MonkeyPatch, prefix: str) -> None:
    """把以 prefix 开头的模块 import 变为 ImportError（模拟裸装缺依赖）。"""
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == prefix or name.startswith(prefix + "."):
            raise ImportError(f"No module named {name!r}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)


def test_mcp_main_without_sdk_prints_install_guidance(monkeypatch, capsys):
    """precis-mcp 缺 mcp SDK → 指引安装 precis-cli[mcp]，退出码 1。"""
    _block_module(monkeypatch, "mcp")

    from app.mcp_server import main

    rc = main()

    assert rc == 1
    err = capsys.readouterr().err
    assert "precis-cli[mcp]" in err
    assert "pip install" in err


def test_start_main_without_uvicorn_prints_install_guidance(monkeypatch, capsys, tmp_path):
    """precis-start 缺 uvicorn → 指引安装 precis-cli[api]，退出码 1 且无端口副作用。"""
    import sys

    _block_module(monkeypatch, "uvicorn")
    monkeypatch.setattr(sys, "argv", ["precis-start", "--no-browser", "--work-dir", str(tmp_path)])

    from app.cli.start import main

    rc = main()

    assert rc == 1
    err = capsys.readouterr().err
    assert "precis-cli[api]" in err
    assert "pip install" in err
