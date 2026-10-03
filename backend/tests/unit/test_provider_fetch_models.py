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
@fileoverview POST /providers/fetch-models 端点单元测试

验证从端点拉取模型列表能力：fake 类型正常返回、SSRF 拦截、scheme 校验、非法 type。
使用 TestClient 打真实 HTTP（不遍历 app.routes，规避 FastAPI 0.138+ 陷阱）。
"""

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.shared.services.llm.providers.fake import FAKE_MODEL_ID


@pytest.fixture
def client():
    return TestClient(app)


class TestFetchModels:
    def test_fake_type_returns_deterministic_models(self, client: TestClient) -> None:
        """fake 类型：返回 FakeProvider 的确定性模型列表，无需真实网络"""
        resp = client.post(
            "/api/latest/ai/providers/fetch-models",
            json={"type": "fake", "base_url": "http://localhost:8000/v1"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"models": [FAKE_MODEL_ID]}

    def test_link_local_address_rejected(self, client: TestClient) -> None:
        """SSRF 防护：169.254.x 链路本地地址（云元数据端点）返回 400"""
        resp = client.post(
            "/api/latest/ai/providers/fetch-models",
            json={"type": "openai", "base_url": "http://169.254.169.254/v1"},
        )
        assert resp.status_code == 400
        assert "169.254" in resp.json()["detail"]

    def test_non_http_scheme_rejected(self, client: TestClient) -> None:
        """scheme 校验：非 http(s)（如 ftp://）返回 400"""
        resp = client.post(
            "/api/latest/ai/providers/fetch-models",
            json={"type": "openai", "base_url": "ftp://x.example.com"},
        )
        assert resp.status_code == 400

    def test_invalid_type_rejected(self, client: TestClient) -> None:
        """type 校验：非法 Provider 类型返回 400"""
        resp = client.post(
            "/api/latest/ai/providers/fetch-models",
            json={"type": "not-a-type", "base_url": "https://api.example.com/v1"},
        )
        assert resp.status_code == 400
