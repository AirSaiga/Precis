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
"""
@fileoverview /api/latest/version 端点单元测试

版本优先级链（桌面打包场景的真实语义，见 app/api/main.py get_version）:
PRECIS_APP_VERSION 环境变量（Electron 主进程注入 app.getVersion()）→
仓库 pyproject.toml（源码/Editable 态，见 app_version）→
包元数据（PyPI 安装态提供）→ "0.0.0-dev"

包元数据及以下层级的用例须先 _mask_repo_pyproject：真实仓库检出中
app_version 会从运行位置上溯读到 backend/pyproject.toml，短路后续层级。
"""

from __future__ import annotations

import importlib.metadata
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.main import app
from app.shared.core import app_version


def _get_version() -> str:
    client = TestClient(app)
    resp = client.get("/api/latest/version")
    assert resp.status_code == 200
    return resp.json()["version"]


def _mask_repo_pyproject(monkeypatch, tmp_path: Path) -> None:
    """把 app_version.__file__ 指到无 pyproject.toml 的伪布局，屏蔽源码态读取。

    模拟 PyPI 安装态（site-packages 旁边没有 pyproject.toml），
    使包元数据 / dev 兜底层可被独立验证。
    """
    module_file = tmp_path / "app" / "shared" / "core" / "app_version.py"
    module_file.parent.mkdir(parents=True)
    module_file.write_text("", encoding="utf-8")
    monkeypatch.setattr(app_version, "__file__", str(module_file))


def test_env_var_takes_priority(monkeypatch):
    """Electron 注入的 PRECIS_APP_VERSION 必须优先于一切本地来源"""
    monkeypatch.setenv("PRECIS_APP_VERSION", "9.9.9-drill")
    assert _get_version() == "9.9.9-drill"


def test_falls_back_to_package_metadata(monkeypatch, tmp_path):
    """无环境变量且非源码态时读取包元数据"""
    monkeypatch.delenv("PRECIS_APP_VERSION", raising=False)
    _mask_repo_pyproject(monkeypatch, tmp_path)
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "3.2.1")
    assert _get_version() == "3.2.1"


def test_falls_back_to_dev_placeholder(monkeypatch, tmp_path):
    """打包环境无包元数据时返回 0.0.0-dev（替代历史错误兜底 "1.0.0"）"""
    monkeypatch.delenv("PRECIS_APP_VERSION", raising=False)
    _mask_repo_pyproject(monkeypatch, tmp_path)

    def _raise(name):
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(importlib.metadata, "version", _raise)
    assert _get_version() == "0.0.0-dev"
