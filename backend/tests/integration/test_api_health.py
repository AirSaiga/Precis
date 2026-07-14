"""
@fileoverview API 基础健康检查与根端点集成测试

更高层级的 API 集成测试（manifest 完整 CRUD、validation 完整流程等）
请参见 test_api_routes.py 与 test_load_project_integration.py。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.main import app


class TestApiHealth:
    """API 健康检查基础测试"""

    def test_root_endpoint_responds(self):
        """根端点应能响应 200，提供欢迎信息。"""
        client = TestClient(app)
        resp = client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "message" in body
        assert "/docs" in body["message"]

    def test_openapi_schema_includes_v2_routes(self):
        """OpenAPI 规范应暴露 V2 项目的关键路由。"""
        client = TestClient(app)
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        spec = resp.json()
        paths = spec.get("paths", {})
        # 至少应注册这些关键 V2 路由
        expected = [
            "/api/latest/project/manifest",
            "/api/latest/project/view",
            "/api/latest/project/workspaces",
            "/api/latest/connection-rules",
            "/api/latest/workspace/config",
        ]
        for path in expected:
            assert path in paths, f"Missing V2 route in OpenAPI: {path}"

    def test_cors_headers_present_for_localhost(self):
        """127.0.0.1 动态端口应被 CORS 允许。"""
        client = TestClient(app)
        # 模拟来自 127.0.0.1 的请求
        resp = client.get("/", headers={"Origin": "http://127.0.0.1:12345"})
        # CORS 头应存在
        assert resp.headers.get("access-control-allow-origin") in (
            "http://127.0.0.1:12345",
            "*",
        )

    def test_cors_headers_present_for_electron_protocols(self):
        """Electron 自定义协议及 null Origin 应被 CORS 允许。"""
        client = TestClient(app)
        for origin in ("app://.", "electron://.", "null"):
            resp = client.get("/", headers={"Origin": origin})
            assert resp.headers.get("access-control-allow-origin") == origin
