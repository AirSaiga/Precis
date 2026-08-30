"""
@fileoverview /api/latest/version 端点单元测试

版本优先级链（桌面打包场景的真实语义，见 app/api/main.py get_version）:
PRECIS_APP_VERSION 环境变量（Electron 主进程注入 app.getVersion()）→
包元数据（开发环境 pip install -e 提供）→ "0.0.0-dev"
"""

from __future__ import annotations

import importlib.metadata

from fastapi.testclient import TestClient

from app.api.main import app


def _get_version() -> str:
    client = TestClient(app)
    resp = client.get("/api/latest/version")
    assert resp.status_code == 200
    return resp.json()["version"]


def test_env_var_takes_priority(monkeypatch):
    """Electron 注入的 PRECIS_APP_VERSION 必须优先于包元数据"""
    monkeypatch.setenv("PRECIS_APP_VERSION", "9.9.9-drill")
    assert _get_version() == "9.9.9-drill"


def test_falls_back_to_package_metadata(monkeypatch):
    """无环境变量时读取包元数据"""
    monkeypatch.delenv("PRECIS_APP_VERSION", raising=False)
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "3.2.1")
    assert _get_version() == "3.2.1"


def test_falls_back_to_dev_placeholder(monkeypatch):
    """打包环境无包元数据时返回 0.0.0-dev（替代历史错误兜底 "1.0.0"）"""
    monkeypatch.delenv("PRECIS_APP_VERSION", raising=False)

    def _raise(name):
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(importlib.metadata, "version", _raise)
    assert _get_version() == "0.0.0-dev"
