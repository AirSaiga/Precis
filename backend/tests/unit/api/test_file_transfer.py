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
from __future__ import annotations

import os
import tempfile

from fastapi.testclient import TestClient

from app.api.main import app


def test_upload_file():
    client = TestClient(app)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", encoding="utf-8", delete=False) as f:
        f.write("name,age\nAlice,30\nBob,25")
        fname = f.name
    try:
        with open(fname, "rb") as f:
            response = client.post("/api/latest/files/upload", files={"file": ("test.csv", f, "text/csv")})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["original_name"] == "test.csv"
        assert data["size"] > 0
        assert os.path.isfile(data["temp_path"])
        # clean up
        os.unlink(data["temp_path"])
    finally:
        os.unlink(fname)


def test_version():
    client = TestClient(app)
    response = client.get("/api/latest/version")
    assert response.status_code == 200
    assert "version" in response.json()
