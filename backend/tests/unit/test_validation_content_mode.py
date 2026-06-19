"""测试基于文件上传的校验接口（Content 模式）"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def client():
    """提供 FastAPI TestClient 实例"""
    return TestClient(app)


class TestValidateContent:
    def test_upload_non_empty_csv_returns_success(self, client):
        """上传非空 CSV 文件应返回成功响应"""
        csv_content = b"id,name\n1,Alice\n2,Bob\n"
        response = client.post(
            "/api/latest/validate/content",
            files={"file": ("test.csv", io.BytesIO(csv_content), "text/csv")},
            data={
                "validation_type": "not_null",
                "target_column_name": "id",
                "header_row": 0,
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"]["is_valid"] is True
        assert body["error"] is None

    def test_upload_empty_file_returns_400(self, client):
        """上传空文件应返回 400 文件内容为空"""
        response = client.post(
            "/api/latest/validate/content",
            files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
            data={
                "validation_type": "not_null",
                "target_column_name": "id",
                "header_row": 0,
            },
        )

        assert response.status_code == 400
        assert "为空" in response.json()["detail"]
