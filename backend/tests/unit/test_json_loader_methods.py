"""
@fileoverview JSONLoader 内部方法单元测试

测试 _convert_to_dataframe、_has_nested_structure、_flatten_dataframe、_get_parser。
"""

import pandas as pd

from app.shared.core.data_source.loaders.json_loader import JSONLoader
from app.shared.core.data_source.specs.json_source import JSONSourceSpec


class TestConvertToDataframe:
    def test_empty_data(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = loader._convert_to_dataframe([])
        assert df.empty

    def test_dict_records(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = loader._convert_to_dataframe([{"a": 1}, {"a": 2}])
        assert list(df["a"]) == [1, 2]

    def test_non_dict_records(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = loader._convert_to_dataframe([1, 2, 3])
        assert list(df["value"]) == [1, 2, 3]


class TestHasNestedStructure:
    def test_no_nested(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
        assert loader._has_nested_structure(df) is False

    def test_with_nested_dict(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = pd.DataFrame({"a": [{"nested": 1}, {"nested": 2}]})
        assert loader._has_nested_structure(df) is True

    def test_with_nested_list(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = pd.DataFrame({"a": [[1, 2], [3, 4]]})
        assert loader._has_nested_structure(df) is True

    def test_all_null(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = pd.DataFrame({"a": [None, None]})
        assert loader._has_nested_structure(df) is False


class TestFlattenDataframe:
    def test_flatten_nested(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)

        # JSONSourceSpec doesn't have max_depth field, so mock the spec attribute
        class MockSpec:
            sep = "."
            max_depth = None

        loader.spec = MockSpec()
        df = pd.DataFrame({"a": [{"b": 1}, {"b": 2}]})
        flat = loader._flatten_dataframe(df)
        assert "a.b" in flat.columns

    def test_empty_df(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        df = pd.DataFrame()
        flat = loader._flatten_dataframe(df)
        assert flat.empty


class TestGetParser:
    def test_get_array_parser(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        parser = loader._get_parser()
        from app.shared.core.data_source.loaders.strategies import ArrayParser

        assert isinstance(parser, ArrayParser)

    def test_get_auto_parser_deprecated(self):
        # D8: format=auto 已废弃,spec 层拦截并报错引导
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="auto|废弃|array|lines|object"):
            JSONSourceSpec(path="test.json", format="auto")

    def test_caches_parser(self):
        spec = JSONSourceSpec(path="test.json", format="array")
        loader = JSONLoader(spec)
        p1 = loader._get_parser()
        p2 = loader._get_parser()
        assert p1 is p2
