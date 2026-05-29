"""测试预览路径权限模块"""

from __future__ import annotations

from unittest.mock import patch

from app.shared.services.preview.path.permission import check_path_permission, is_path_writable


class TestCheckPathPermission:
    def test_personal_edition_allows_all(self, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: False)
        allowed, reason = check_path_permission("/any/path")
        assert allowed is True
        assert "个人版" in reason

    def test_v1_config_allows_all(self, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        with patch(
            "app.shared.services.preview.path.permission.load_whitelist_config", return_value={"version": "1.0"}
        ):
            allowed, reason = check_path_permission("/any/path")
            assert allowed is True
            assert "v1.0" in reason

    def test_nonexistent_file_allows(self, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        with patch(
            "app.shared.services.preview.path.permission.load_whitelist_config",
            return_value={"version": "2.0", "paths": []},
        ):
            allowed, reason = check_path_permission("/nonexistent/path")
            assert allowed is True
            assert "不存在" in reason

    def test_readonly_policy_allows_all(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "readonly"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f))
            assert allowed is True
            assert "只读" in reason

    def test_admin_policy_allows_admin(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "admin"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f), user_role="admin")
            assert allowed is True
            assert "管理员" in reason

    def test_admin_policy_denies_member(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "admin"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f), user_role="member")
            assert allowed is False
            assert "管理员" in reason

    def test_owner_policy_allows_matching_user(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "owner", "owner_id": "user123"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f), user_id="user123")
            assert allowed is True
            assert "所有者" in reason

    def test_owner_policy_denies_mismatched_user(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "owner", "owner_id": "user123"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f), user_id="user456")
            assert allowed is False
            assert "所有权" in reason

    def test_owner_policy_no_owner_id_denies(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "paths": [{"path": str(tmp_path), "policy": "owner"}],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f), user_id="user123")
            assert allowed is False

    def test_default_policy_readonly(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "default_policy": "readonly",
            "paths": [],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f))
            assert allowed is True
            assert "默认只读" in reason

    def test_default_policy_admin(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: True)
        f = tmp_path / "file.csv"
        f.write_text("data")
        config = {
            "version": "2.0",
            "default_policy": "admin",
            "paths": [],
        }
        with patch("app.shared.services.preview.path.permission.load_whitelist_config", return_value=config):
            allowed, reason = check_path_permission(str(f))
            assert allowed is False
            assert "无权限" in reason


class TestIsPathWritable:
    def test_returns_bool(self, monkeypatch):
        monkeypatch.setattr("app.shared.services.preview.path.permission.is_team_edition", lambda: False)
        assert is_path_writable("/any/path") is True
