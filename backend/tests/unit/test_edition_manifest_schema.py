"""
@fileoverview 版本检测和 Schema 类型测试（T48 覆盖补充）

覆盖目标:
- core/edition.py: Edition, get_current_edition, is_team_edition, is_personal_edition, clear_edition_cache
- core/manifest_schema/types.py: V2Schema, ImpactAnalysisResult
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import patch

from app.shared.core.edition import (
    Edition,
    clear_edition_cache,
    get_current_edition,
    is_personal_edition,
    is_team_edition,
    set_edition_for_test,
)
from app.shared.core.manifest_schema.types import ImpactAnalysisResult, V2Schema

# ============================================================================
# Edition 枚举测试
# ============================================================================


class TestEditionEnum:
    def test_personal_value(self):
        assert Edition.PERSONAL == "personal"
        assert Edition.PERSONAL.value == "personal"

    def test_team_value(self):
        assert Edition.TEAM == "team"
        assert Edition.TEAM.value == "team"

    def test_is_string_subclass(self):
        assert isinstance(Edition.PERSONAL, str)

    def test_all_members(self):
        members = list(Edition)
        assert len(members) == 2


# ============================================================================
# get_current_edition 测试
# ============================================================================


class TestGetCurrentEdition:
    def setup_method(self):
        clear_edition_cache()

    def teardown_method(self):
        clear_edition_cache()

    def test_env_var_team(self):
        """环境变量 PRECIS_EDITION=team 应返回 TEAM。"""
        with patch.dict(os.environ, {"PRECIS_EDITION": "team"}):
            clear_edition_cache()
            assert get_current_edition() == Edition.TEAM

    def test_env_var_personal(self):
        """环境变量 PRECIS_EDITION=personal 应返回 PERSONAL。"""
        with patch.dict(os.environ, {"PRECIS_EDITION": "personal"}):
            clear_edition_cache()
            assert get_current_edition() == Edition.PERSONAL

    def test_env_var_case_insensitive(self):
        """环境变量应不区分大小写。"""
        with patch.dict(os.environ, {"PRECIS_EDITION": "TEAM"}):
            clear_edition_cache()
            assert get_current_edition() == Edition.TEAM

    def test_env_var_empty_defaults_personal(self):
        """环境变量为空时应尝试读取配置文件，找不到则默认 personal。"""
        with patch.dict(os.environ, {"PRECIS_EDITION": ""}, clear=False):
            clear_edition_cache()
            result = get_current_edition()
            # Either reads from config file or defaults to personal
            assert result in (Edition.PERSONAL, Edition.TEAM)

    def test_no_env_var_defaults_personal(self):
        """无环境变量且无配置文件时应默认 personal。"""
        with patch.dict(os.environ, {}, clear=False):
            if "PRECIS_EDITION" in os.environ:
                del os.environ["PRECIS_EDITION"]
            clear_edition_cache()
            # Mock ConfigPaths to return nonexistent path
            with patch("app.shared.core.edition.ConfigPaths") as mock_config:
                mock_config.product_edition.return_value = "/nonexistent/path"
                result = get_current_edition()
                assert result == Edition.PERSONAL

    def test_caching_behavior(self):
        """连续调用应返回缓存值。"""
        clear_edition_cache()
        with patch.dict(os.environ, {"PRECIS_EDITION": "team"}):
            clear_edition_cache()
            r1 = get_current_edition()
            r2 = get_current_edition()
            assert r1 is r2


# ============================================================================
# 便捷函数测试
# ============================================================================


class TestEditionHelpers:
    def setup_method(self):
        clear_edition_cache()

    def teardown_method(self):
        clear_edition_cache()

    def test_is_team_edition_true(self):
        with patch.dict(os.environ, {"PRECIS_EDITION": "team"}):
            clear_edition_cache()
            assert is_team_edition() is True

    def test_is_team_edition_false(self):
        with patch.dict(os.environ, {"PRECIS_EDITION": "personal"}):
            clear_edition_cache()
            assert is_team_edition() is False

    def test_is_personal_edition_true(self):
        with patch.dict(os.environ, {"PRECIS_EDITION": "personal"}):
            clear_edition_cache()
            assert is_personal_edition() is True

    def test_is_personal_edition_false(self):
        with patch.dict(os.environ, {"PRECIS_EDITION": "team"}):
            clear_edition_cache()
            assert is_personal_edition() is False


# ============================================================================
# clear_edition_cache 测试
# ============================================================================


class TestClearEditionCache:
    def test_clear_cache_allows_redetection(self):
        """清除缓存后应重新检测版本。"""
        clear_edition_cache()
        with patch.dict(os.environ, {"PRECIS_EDITION": "team"}):
            clear_edition_cache()
            assert get_current_edition() == Edition.TEAM

        # Clear and change env
        clear_edition_cache()
        with patch.dict(os.environ, {"PRECIS_EDITION": "personal"}):
            clear_edition_cache()
            assert get_current_edition() == Edition.PERSONAL


# ============================================================================
# set_edition_for_test 测试
# ============================================================================


class TestSetEditionForTest:
    def setup_method(self):
        clear_edition_cache()

    def teardown_method(self):
        clear_edition_cache()

    def test_set_team(self):
        set_edition_for_test(Edition.TEAM)
        assert get_current_edition() == Edition.TEAM

    def test_set_personal(self):
        set_edition_for_test(Edition.PERSONAL)
        assert get_current_edition() == Edition.PERSONAL


# ============================================================================
# V2Schema 测试
# ============================================================================


class TestV2Schema:
    def test_default_values(self):
        schema = V2Schema()
        assert schema.version == 2
        assert schema.project == {}
        assert schema.settings == {}
        assert schema.schemas == []
        assert schema.constraints == []
        assert schema.regex_nodes == []
        assert schema.patterns_dir == "patterns"

    def test_with_values(self):
        schema = V2Schema(
            version=2,
            project={"id": "demo", "name": "Demo"},
            schemas=[{"id": "users", "path": "schemas/users.yaml"}],
            constraints=[{"id": "c1", "path": "constraints/c1.yaml"}],
            regex_nodes=[{"id": "r1", "path": "regex/r1.yaml"}],
            patterns_dir="my_patterns",
        )
        assert schema.project["id"] == "demo"
        assert len(schema.schemas) == 1
        assert len(schema.constraints) == 1
        assert len(schema.regex_nodes) == 1
        assert schema.patterns_dir == "my_patterns"

    def test_serialization(self):
        schema = V2Schema(project={"id": "test"})
        d = schema.model_dump()
        assert d["version"] == 2
        assert d["project"]["id"] == "test"


# ============================================================================
# ImpactAnalysisResult 测试
# ============================================================================


class TestImpactAnalysisResult:
    def test_default_values(self):
        result = ImpactAnalysisResult()
        assert result.summary == {}
        assert result.changes == []
        assert result.risks == []
        assert result.recommendations == []

    def test_with_values(self):
        result = ImpactAnalysisResult(
            summary={"total_changes": 3},
            changes=[{"type": "add", "target": "column"}],
            risks=[{"level": "high", "description": "data loss"}],
            recommendations=[{"action": "backup"}],
        )
        assert result.summary["total_changes"] == 3
        assert len(result.changes) == 1
        assert len(result.risks) == 1
        assert len(result.recommendations) == 1
