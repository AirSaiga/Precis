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

    def test_save_preserves_all_fields_roundtrip(self):
        """save→load roundtrip 必须保留 RegexNodeFile 的全部业务字段。

        历史 bug：writer 用手动白名单挑字段，丢失了 source_ref / input_from_node /
        input_column / output_columns / capture_groups / rules / parameters /
        case_sensitive / flags / source_column_name。本测试覆盖全部字段。
        """
        from app.shared.core.project.regex.reader import load_regex_node

        node = RegexNodeFile(
            version=2,
            id="full_node",
            name="完整节点",
            description="测试全字段保留",
            pattern=r"^\d+$",
            match_mode="extract",
            case_sensitive=True,
            flags="im",
            enabled=True,
            parameters=[{"key": "limit", "value": 10}],
            rules=[{"id": "r1", "type": "literal"}],
            input_from_node="users",
            input_column="phone",
            capture_groups=[{"name": "area", "group_index": 1}],
            output_columns=["area", "number"],
            source_ref={"table_id": "users", "column_id": "phone"},
            source_column_name="phone",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "full_node.regex.yaml")
            save_regex_node(node, path)
            reloaded = load_regex_node(path)

        # 逐字段验证 roundtrip 保留
        assert reloaded.id == "full_node"
        assert reloaded.name == "完整节点"
        assert reloaded.description == "测试全字段保留"
        assert reloaded.pattern == r"^\d+$"
        assert reloaded.match_mode == "extract"
        assert reloaded.case_sensitive is True
        assert reloaded.flags == "im"
        assert reloaded.enabled is True
        assert reloaded.parameters == [{"key": "limit", "value": 10}]
        assert reloaded.rules == [{"id": "r1", "type": "literal"}]
        assert reloaded.input_from_node == "users"
        assert reloaded.input_column == "phone"
        assert reloaded.capture_groups == [{"name": "area", "group_index": 1}]
        assert reloaded.output_columns == ["area", "number"]
        assert reloaded.source_ref is not None
        assert reloaded.source_ref.table_id == "users"
        assert reloaded.source_ref.column_id == "phone"
        assert reloaded.source_column_name == "phone"

    def test_save_preserves_uses_pattern_mode_roundtrip(self):
        """引用模式（uses_pattern + pattern_overrides）也应完整保留。"""
        from app.shared.core.project.regex.reader import load_regex_node

        node = RegexNodeFile(
            id="ref_node",
            name="引用节点",
            uses_pattern=PatternRef(registry="patterns", pattern_name="phone_cn"),
            pattern_overrides={"flags": "i"},
            match_mode="full",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "ref_node.regex.yaml")
            save_regex_node(node, path)
            reloaded = load_regex_node(path)

        assert reloaded.uses_pattern is not None
        assert reloaded.uses_pattern.pattern_name == "phone_cn"
        assert reloaded.uses_pattern.registry == "patterns"
        assert reloaded.pattern_overrides == {"flags": "i"}


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
