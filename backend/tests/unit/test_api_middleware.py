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
"""测试 API 中间件"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from starlette.testclient import TestClient

from app.api.middleware.exception_handler import ExceptionHandlerMiddleware
from app.api.middleware.request_logging import RequestLoggingMiddleware


class TestRequestLoggingMiddleware:
    def test_logs_info_for_200(self, caplog):
        app = FastAPI()
        app.add_middleware(RequestLoggingMiddleware)

        @app.get("/ok")
        def ok():
            return {"status": "ok"}

        with caplog.at_level(logging.INFO):
            client = TestClient(app)
            response = client.get("/ok")

        assert response.status_code == 200
        assert "GET /ok 200" in caplog.text

    def test_logs_warning_for_404(self, caplog):
        app = FastAPI()
        app.add_middleware(RequestLoggingMiddleware)

        with caplog.at_level(logging.WARNING):
            client = TestClient(app)
            response = client.get("/not-found")

        assert response.status_code == 404
        assert "GET /not-found 404" in caplog.text

    def test_logs_error_for_500(self, caplog):
        app = FastAPI()
        app.add_middleware(ExceptionHandlerMiddleware)
        app.add_middleware(RequestLoggingMiddleware)

        @app.get("/error")
        def error():
            raise RuntimeError("boom")

        with caplog.at_level(logging.ERROR):
            client = TestClient(app, raise_server_exceptions=False)
            response = client.get("/error")

        assert response.status_code == 500
        assert "GET /error 500" in caplog.text


class TestExceptionHandlerMiddleware:
    def test_passes_through_normal_request(self):
        app = FastAPI()
        app.add_middleware(ExceptionHandlerMiddleware)

        @app.get("/ok")
        def ok():
            return {"status": "ok"}

        client = TestClient(app)
        response = client.get("/ok")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_re_raises_http_exception(self):
        app = FastAPI()
        app.add_middleware(ExceptionHandlerMiddleware)

        @app.get("/bad")
        def bad():
            raise HTTPException(status_code=422, detail="validation error")

        client = TestClient(app)
        response = client.get("/bad")
        assert response.status_code == 422
        assert "validation error" in response.text

    def test_catches_generic_exception(self):
        app = FastAPI()
        app.add_middleware(ExceptionHandlerMiddleware)

        @app.get("/error")
        def error():
            raise RuntimeError("something went wrong")

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/error")
        assert response.status_code == 500
        data = response.json()
        assert data["error"] == "Internal Server Error"
        assert "服务器内部错误" in data["detail"]

    def test_logs_traceback_on_exception(self, caplog):
        app = FastAPI()
        app.add_middleware(ExceptionHandlerMiddleware)

        @app.get("/error")
        def error():
            raise ValueError("test error")

        with caplog.at_level(logging.ERROR):
            client = TestClient(app, raise_server_exceptions=False)
            client.get("/error")

        assert "Unhandled exception" in caplog.text
        assert "ValueError: test error" in caplog.text
