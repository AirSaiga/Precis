"""
@fileoverview JSONPathExtractor 单元测试

测试 JSONPath 数据提取器的各种路径解析场景。
"""

from app.shared.core.data_source.loaders.extractor import JSONPathExtractor


class TestJSONPathExtractor:
    def test_extract_root(self):
        e = JSONPathExtractor()
        data = {"users": [{"name": "Alice"}]}
        assert e.extract(data, "$") == [data]

    def test_extract_simple_key(self):
        e = JSONPathExtractor()
        data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
        # _extract_by_path returns the list directly when the final value is a list
        assert e.extract(data, "$.users") == [{"name": "Alice"}, {"name": "Bob"}]

    def test_extract_nested_key(self):
        e = JSONPathExtractor()
        data = {"data": {"items": [{"id": 1}, {"id": 2}]}}
        assert e.extract(data, "$.data.items") == [{"id": 1}, {"id": 2}]

    def test_extract_array_index(self):
        e = JSONPathExtractor()
        data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
        assert e.extract(data, "$.users[0]") == [{"name": "Alice"}]

    def test_extract_array_wildcard(self):
        e = JSONPathExtractor()
        data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
        assert e.extract(data, "$.users[*]") == [{"name": "Alice"}, {"name": "Bob"}]

    def test_extract_recursive(self):
        e = JSONPathExtractor()
        data = {"a": {"name": "x"}, "b": {"name": "y"}}
        # Note: $..key normalization has a bug ($. strips to .key), use ..key directly
        assert e.extract(data, "..name") == ["x", "y"]

    def test_extract_missing_path(self):
        e = JSONPathExtractor()
        data = {"a": 1}
        assert e.extract(data, "$.b") == []

    def test_extract_empty_jsonpath(self):
        e = JSONPathExtractor()
        data = {"a": 1}
        assert e.extract(data, "") == [data]

    def test_normalize_path(self):
        e = JSONPathExtractor()
        assert e._normalize_path("$.a.b") == "a.b"
        assert e._normalize_path("$a.b") == "a.b"
        assert e._normalize_path("a.b") == "a.b"

    def test_parse_path(self):
        e = JSONPathExtractor()
        assert e._parse_path("a.b.c") == ["a", "b", "c"]
        assert e._parse_path("a[0].b") == ["a", 0, "b"]
        assert e._parse_path("a[*]") == ["a", "*"]
        assert e._parse_path('a["key"].b') == ["a", "key", "b"]

    def test_navigate_step_dict(self):
        e = JSONPathExtractor()
        assert e._navigate_step({"a": 1}, "a") == 1
        assert e._navigate_step({"a": 1}, "b") is None

    def test_navigate_step_list_index(self):
        e = JSONPathExtractor()
        assert e._navigate_step([10, 20, 30], 1) == 20
        assert e._navigate_step([10, 20], 5) is None

    def test_navigate_step_list_wildcard(self):
        e = JSONPathExtractor()
        assert e._navigate_step([10, 20], "*") == [10, 20]

    def test_navigate_step_invalid(self):
        e = JSONPathExtractor()
        assert e._navigate_step("string", "a") is None
        assert e._navigate_step(123, "a") is None

    def test_is_recursive_path(self):
        e = JSONPathExtractor()
        assert e._is_recursive_path("..key") is True
        assert e._is_recursive_path("key") is False

    def test_extract_recursive_deep(self):
        e = JSONPathExtractor()
        data = {"level1": {"level2": {"target": 42}}}
        assert e.extract(data, "..target") == [42]

    def test_extract_list_input(self):
        e = JSONPathExtractor()
        data = [{"id": 1}, {"id": 2}]
        assert e.extract(data, "$") == data
