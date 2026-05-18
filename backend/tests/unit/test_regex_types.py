"""
@fileoverview 正则节点类型单元测试

测试 RegexSourceRef, PatternRef, RegexNodeFile 的构造和验证。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest
from pydantic import ValidationError

from app.shared.core.project.regex.types import (
    PatternRef,
    PatternRefV2,
    RegexNodeFile,
    RegexNodeFileV2,
    RegexSourceRef,
    RegexSourceRefV2,
)


class TestRegexSourceRef:
    def test_create(self):
        ref = RegexSourceRef(table_id="users", column_id="email")
        assert ref.table_id == "users"
        assert ref.column_id == "email"


class TestPatternRef:
    def test_create(self):
        p = PatternRef(registry="patterns", pattern_name="phone_cn")
        assert p.registry == "patterns"
        assert p.pattern_name == "phone_cn"
        assert p.as_alias is None

    def test_with_alias(self):
        p = PatternRef(registry="patterns", pattern_name="email", as_alias="personal")
        assert p.as_alias == "personal"

    def test_invalid_registry_raises(self):
        with pytest.raises(ValidationError):
            PatternRef(registry="invalid", pattern_name="x")


class TestRegexNodeFile:
    def test_direct_mode(self):
        node = RegexNodeFile(
            id="email",
            name="邮箱校验",
            pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$",
            match_mode="full",
        )
        assert node.pattern is not None
        assert node.uses_pattern is None

    def test_ref_mode(self):
        node = RegexNodeFile(
            id="phone",
            name="手机号",
            uses_pattern=PatternRef(registry="patterns", pattern_name="phone_cn"),
            match_mode="partial",
        )
        assert node.uses_pattern is not None
        assert node.pattern is None

    def test_defaults(self):
        node = RegexNodeFile(id="x", name="X", pattern=".*")
        assert node.version == 2
        assert node.enabled is True
        assert node.case_sensitive is False
        assert node.flags == ""
        assert node.parameters == []
        assert node.rules == []

    def test_both_modes_raises(self):
        with pytest.raises(ValidationError, match="不能同时使用"):
            RegexNodeFile(
                id="x",
                name="X",
                pattern=".*",
                uses_pattern=PatternRef(registry="patterns", pattern_name="x"),
            )

    def test_neither_mode_raises(self):
        with pytest.raises(ValidationError, match="必须使用"):
            RegexNodeFile(id="x", name="X")

    def test_empty_pattern_string_raises(self):
        with pytest.raises(ValidationError, match="必须使用"):
            RegexNodeFile(id="x", name="X", pattern="   ")

    def test_source_ref(self):
        node = RegexNodeFile(
            id="x",
            name="X",
            pattern=".*",
            source_ref=RegexSourceRef(table_id="t", column_id="c"),
            source_column_name="c",
        )
        assert node.source_ref.table_id == "t"
        assert node.source_column_name == "c"

    def test_pattern_overrides(self):
        node = RegexNodeFile(
            id="x",
            name="X",
            uses_pattern=PatternRef(registry="patterns", pattern_name="x"),
            pattern_overrides={"flags": "i"},
        )
        assert node.pattern_overrides == {"flags": "i"}

    def test_match_mode_extract(self):
        node = RegexNodeFile(id="x", name="X", pattern=".*", match_mode="extract")
        assert node.match_mode == "extract"


class TestCompatibilityAliases:
    def test_aliases(self):
        assert RegexSourceRefV2 is RegexSourceRef
        assert PatternRefV2 is PatternRef
        assert RegexNodeFileV2 is RegexNodeFile
