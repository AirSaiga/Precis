"""
@fileoverview TokenOriginAuthMiddleware 单元测试（打包模式一次性 token 放行）

覆盖场景:
- 有效 token 的 null Origin 预检被直接放行（200 + 回显 Origin 的放行头）
- 无 token / 错误 token 的 null Origin 预检沿用既有拒绝行为（CORSMiddleware 400）
- 有效 token 的实际请求响应补写回显 Origin 的 ACAO 头；无 token 时不补写
- 常规本机源（127.0.0.1/localhost）不受影响：仍由 CORSMiddleware 应答，
  且 token 中间件不产生重复 ACAO 头
- 未配置 PRECIS_API_TOKEN（Web/开发模式）时中间件完全直通，行为与改造前一致

测试装配说明:
- 按	main.py 的实际顺序构建最小应用（CORS 在内层、token 中间件在其外层），
  并复用真实的 DynamicPortCORSMiddleware，确保"沿用现有拒绝行为"断言可信
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.main import DynamicPortCORSMiddleware
from app.api.middleware.token_auth import TokenOriginAuthMiddleware

# 模拟 pythonProcess.ts 注入的 32 字节 hex token
TOKEN = "a" * 64
WRONG_TOKEN = "b" * 64

# 与 main.py 保持一致的显式允许 Origin 列表
ORIGINS = [
    "http://127.0.0.1:8000",
    "app://.",
    "electron://.",
]


def _build_app() -> FastAPI:
    """按 main.py 的中间件装配顺序构建最小应用（后添加的 token 中间件先执行）。"""
    app = FastAPI()
    app.add_middleware(
        DynamicPortCORSMiddleware,
        allow_origins=ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(TokenOriginAuthMiddleware)

    @app.get("/api/latest/ping")
    def ping():
        return {"ok": True}

    return app


@pytest.fixture
def client(monkeypatch):
    """配置了 PRECIS_API_TOKEN 的测试客户端（token 逐请求读取，monkeypatch 生效）。"""
    monkeypatch.setenv("PRECIS_API_TOKEN", TOKEN)
    return TestClient(_build_app())


def _preflight_headers(origin: str, *, requested: str = "", token: str | None = None) -> dict[str, str]:
    """构造浏览器预检请求头；token=None 表示不携带 X-Precis-Auth 头。"""
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
    }
    if requested:
        headers["Access-Control-Request-Headers"] = requested
    if token is not None:
        headers["X-Precis-Auth"] = token
    return headers


class TestPreflight:
    """预检（OPTIONS）请求的放行与拒绝"""

    def test_null_origin_with_valid_token_allowed(self, client):
        """有效 token 的 null Origin 预检应被代答放行（200 + 回显 Origin + 放行头）。"""
        resp = client.options(
            "/api/latest/ping",
            headers=_preflight_headers(
                "null",
                requested="X-Precis-Auth, X-Project-Config-Path, Content-Type",
                token=TOKEN,
            ),
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "null"
        allow_headers = resp.headers.get("access-control-allow-headers", "")
        assert "X-Precis-Auth" in allow_headers
        assert "X-Project-Config-Path" in allow_headers
        assert "Content-Type" in allow_headers
        assert resp.headers.get("access-control-allow-methods") == "GET, POST, PUT, DELETE, OPTIONS"
        assert resp.headers.get("access-control-allow-credentials") == "true"

    def test_null_origin_without_token_rejected(self, client):
        """无 token 的 null Origin 预检应沿用既有拒绝行为（不被放行）。"""
        resp = client.options(
            "/api/latest/ping",
            headers=_preflight_headers("null", requested="X-Project-Config-Path, Content-Type", token=None),
        )
        # CORSMiddleware 对不在允许列表的 Origin 预检返回 400，且不回写任何放行头
        assert resp.status_code == 400
        assert resp.headers.get("access-control-allow-origin") is None

    def test_null_origin_with_wrong_token_rejected(self, client):
        """token 不匹配的 null Origin 预检应被拒绝（与无 token 同等对待）。"""
        resp = client.options(
            "/api/latest/ping",
            headers=_preflight_headers("null", requested="X-Precis-Auth", token=WRONG_TOKEN),
        )
        assert resp.status_code == 400
        assert resp.headers.get("access-control-allow-origin") is None

    def test_preflight_without_auth_declaration_not_intercepted(self, client):
        """预检未声明携带 X-Precis-Auth 时不代答，交由 CORSMiddleware 拒绝。"""
        resp = client.options(
            "/api/latest/ping",
            headers=_preflight_headers("null", requested="Content-Type", token=TOKEN),
        )
        assert resp.status_code == 400
        assert resp.headers.get("access-control-allow-origin") is None

    def test_localhost_origin_preflight_still_handled_by_cors(self, client):
        """常规本机源的预检不受影响，仍由 CORSMiddleware 应答（回显本机源）。"""
        origin = "http://127.0.0.1:5173"
        resp = client.options(
            "/api/latest/ping",
            headers=_preflight_headers(origin, requested="X-Precis-Auth, X-Project-Config-Path", token=TOKEN),
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == origin


class TestActualRequest:
    """实际（非预检）请求的响应头补写"""

    def test_null_origin_with_valid_token_gets_acao_echo(self, client):
        """有效 token 的 null Origin 实际请求应补写回显 Origin 的 ACAO 头（无重复头）。"""
        resp = client.get("/api/latest/ping", headers={"Origin": "null", "X-Precis-Auth": TOKEN})
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert resp.headers.get_list("access-control-allow-origin") == ["null"]
        assert resp.headers.get_list("access-control-allow-credentials") == ["true"]

    def test_null_origin_without_token_has_no_acao(self, client):
        """无 token 的 null Origin 实际请求不应获得 ACAO 头（浏览器将拦截读取）。"""
        resp = client.get("/api/latest/ping", headers={"Origin": "null"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") is None

    def test_null_origin_with_wrong_token_has_no_acao(self, client):
        """token 不匹配的 null Origin 实际请求不补写放行头。"""
        resp = client.get("/api/latest/ping", headers={"Origin": "null", "X-Precis-Auth": WRONG_TOKEN})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") is None

    def test_no_origin_header_gets_no_cors_headers(self, client):
        """无 Origin 头的请求（如 Electron 主进程健康探测）不补写任何 CORS 头。"""
        resp = client.get("/api/latest/ping", headers={"X-Precis-Auth": TOKEN})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") is None

    def test_localhost_origin_single_acao_no_duplicate(self, client):
        """本机源请求由 CORSMiddleware 放行，token 中间件不得产生重复 ACAO 头。"""
        origin = "http://127.0.0.1:5173"
        resp = client.get("/api/latest/ping", headers={"Origin": origin, "X-Precis-Auth": TOKEN})
        assert resp.status_code == 200
        assert resp.headers.get_list("access-control-allow-origin") == [origin]

    def test_allowlisted_protocol_origin_single_acao_no_duplicate(self, client):
        """app://. 等允许列表 Origin 已有 ACAO 头，token 中间件不得追加重复头。"""
        resp = client.get("/api/latest/ping", headers={"Origin": "app://.", "X-Precis-Auth": TOKEN})
        assert resp.status_code == 200
        assert resp.headers.get_list("access-control-allow-origin") == ["app://."]


class TestTokenNotConfigured:
    """未配置 PRECIS_API_TOKEN（Web/开发模式）：中间件完全直通"""

    @pytest.fixture
    def web_client(self, monkeypatch):
        monkeypatch.delenv("PRECIS_API_TOKEN", raising=False)
        return TestClient(_build_app())

    def test_null_origin_actual_request_rejected_as_before(self, web_client):
        """null Origin 实际请求不被放行（与改造前默认行为一致）。"""
        resp = web_client.get("/api/latest/ping", headers={"Origin": "null"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") is None

    def test_null_origin_preflight_rejected_as_before(self, web_client):
        """null Origin 预检不被放行（沿用既有拒绝行为）。"""
        resp = web_client.options(
            "/api/latest/ping",
            headers=_preflight_headers("null", requested="X-Project-Config-Path"),
        )
        assert resp.status_code == 400
        assert resp.headers.get("access-control-allow-origin") is None

    def test_localhost_origin_cors_unaffected(self, web_client):
        """本机源 CORS 行为不变（动态端口正则放行）。"""
        origin = "http://localhost:5173"
        resp = web_client.get("/api/latest/ping", headers={"Origin": origin})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == origin
