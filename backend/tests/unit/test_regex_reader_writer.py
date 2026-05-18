"""
@fileoverview 正则节点读写模块单元测试

测试 load_regex_node, save_regex_node, find_pattern_by_name。
"""

import os
import re
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.regex.reader import find_pattern_by_name, load_regex_node, resolve_regex_pattern
from app.shared.core.project.regex.types import PatternRef, RegexNodeFile
from app.shared.core.project.regex.writer import save_regex_node


class MockPattern:
    def __init__(self, name, pattern):
        self.name = name
        self.regex = re.compile(pattern)


class MockRegistry:
    def __init__(self, patterns):
        self._patterns = patterns


class TestLoadRegexNode:
    def test_load_direct_mode(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".regex.yaml", delete=False, encoding="utf-8") as f:
            f.write(r"""
version: 2
id: email
name: 邮箱校验
pattern: '^[\w\.-]+@[\w\.-]+\.\w+$'
match_mode: full
enabled: true
""")
            path = f.name
        try:
            node = load_regex_node(path)
            assert node.id == "email"
            assert node.pattern is not None
        finally:
            os.unlink(path)

    def test_load_ref_mode(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".regex.yaml", delete=False, encoding="utf-8") as f:
            f.write("""
version: 2
id: phone
name: 手机号
uses_pattern:
  registry: patterns
  pattern_name: phone_cn
match_mode: full
""")
            path = f.name
        try:
            node = load_regex_node(path)
            assert node.uses_pattern.pattern_name == "phone_cn"
        finally:
            os.unlink(path)


class TestSaveRegexNode:
    def test_save_creates_file(self):
        node = RegexNodeFile(id="test", name="Test", pattern=".*")
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "test.regex.yaml")
            save_regex_node(node, path)
            assert os.path.exists(path)


class TestFindPatternByName:
    def test_find_existing(self):
        registry = MockRegistry([MockPattern("email", r".*@.*"), MockPattern("phone", r"\d+")])
        result = find_pattern_by_name(registry, "phone")
        assert result is not None
        assert result.name == "phone"

    def test_find_missing(self):
        registry = MockRegistry([MockPattern("email", r".*@.*")])
        result = find_pattern_by_name(registry, "phone")
        assert result is None


class TestResolveRegexPattern:
    def test_direct_mode(self):
        config = RegexNodeFile(id="x", name="X", pattern=r"^\d+$")
        result = resolve_regex_pattern(config, {})
        assert result.pattern == r"^\d+$"

    def test_ref_mode_no_overrides(self):
        config = RegexNodeFile(
            id="x",
            name="X",
            uses_pattern=PatternRef(registry="patterns", pattern_name="digits"),
        )
        registry = MockRegistry([MockPattern("digits", r"^\d+$")])
        result = resolve_regex_pattern(config, {"expression_registry": registry})
        assert result.pattern == r"^\d+$"

    def test_ref_mode_with_flags_override(self):
        config = RegexNodeFile(
            id="x",
            name="X",
            uses_pattern=PatternRef(registry="patterns", pattern_name="digits"),
            pattern_overrides={"flags": "i"},
        )
        registry = MockRegistry([MockPattern("digits", r"^\d+$")])
        result = resolve_regex_pattern(config, {"expression_registry": registry})
        assert result.flags & re.IGNORECASE

    def test_ref_mode_registry_missing(self):
        config = RegexNodeFile(
            id="x",
            name="X",
            uses_pattern=PatternRef(registry="patterns", pattern_name="digits"),
        )
        with pytest.raises(ValueError, match="未加载注册表"):
            resolve_regex_pattern(config, {})

    def test_ref_mode_pattern_missing(self):
        config = RegexNodeFile(
            id="x",
            name="X",
            uses_pattern=PatternRef(registry="patterns", pattern_name="digits"),
        )
        registry = MockRegistry([])
        with pytest.raises(ValueError, match="未找到"):
            resolve_regex_pattern(config, {"expression_registry": registry})
