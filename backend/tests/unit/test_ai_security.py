"""@fileoverview AI 安全加固单元测试（P4 子批4）

覆盖：
- #10 validate_project_path：X-Project-Config-Path 校验，防任意目录读写
- #11 _validate_base_url：Provider base_url 校验，防 SSRF
"""

from __future__ import annotations

import os

import pytest
from fastapi import HTTPException

from app.api.routers.ai.providers import _validate_base_url
from app.api.routers.ai.utils import validate_project_path

# =============================================================================
# #10 validate_project_path
# =============================================================================


class TestValidateProjectPath:
    def test_valid_project_root_passes(self, tmp_path):
        """合法项目根（含 project.precis.yaml）通过。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")
        result = validate_project_path(str(tmp_path))
        assert os.path.isabs(result)
        assert os.path.isdir(result)

    def test_missing_header_rejected(self):
        """空 Header 被拒。"""
        with pytest.raises(HTTPException) as exc:
            validate_project_path(None)
        assert exc.value.status_code == 400
        assert "缺少" in exc.value.detail

    def test_nonexistent_dir_rejected(self, tmp_path):
        """不存在的目录被拒。"""
        with pytest.raises(HTTPException) as exc:
            validate_project_path(str(tmp_path / "nonexistent"))
        assert exc.value.status_code == 400

    def test_dir_without_manifest_rejected(self, tmp_path):
        """存在但无 project.precis.yaml 的目录被拒（非合法项目根）。"""
        with pytest.raises(HTTPException) as exc:
            validate_project_path(str(tmp_path))
        assert exc.value.status_code == 400
        assert "project.precis.yaml" in exc.value.detail


# =============================================================================
# #11 _validate_base_url（SSRF 防护）
# =============================================================================


class TestValidateBaseUrl:
    def test_https_url_passes(self):
        """合法 https URL 通过。"""
        _validate_base_url("https://api.openai.com/v1")  # 不抛异常即通过

    def test_localhost_passes(self):
        """localhost 合法（本地 Ollama）。"""
        _validate_base_url("http://localhost:11434")
        _validate_base_url("http://127.0.0.1:11434")

    def test_none_passes(self):
        """本地 Provider 可无 base_url。"""
        _validate_base_url(None)  # 不抛异常

    def test_non_http_scheme_rejected(self):
        """非 http(s) scheme 被拒（file://、gopher:// 等 SSRF 向量）。"""
        with pytest.raises(HTTPException) as exc:
            _validate_base_url("file:///etc/passwd")
        assert exc.value.status_code == 400
        assert "http" in exc.value.detail

    def test_link_local_address_rejected(self):
        """链路本地地址 169.254.x 被拒（云元数据端点 SSRF）。"""
        with pytest.raises(HTTPException) as exc:
            _validate_base_url("http://169.254.169.254/latest/meta-data/")
        assert exc.value.status_code == 400
        assert "169.254" in exc.value.detail or "链路本地" in exc.value.detail

    def test_gopher_scheme_rejected(self):
        """gopher:// 被拒。"""
        with pytest.raises(HTTPException) as exc:
            _validate_base_url("gopher://attacker.com/x")
        assert exc.value.status_code == 400
