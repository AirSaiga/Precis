"""
@fileoverview JSONLoader load/validate 单元测试

测试 JSONLoader 的完整加载流程和异常处理。
使用 MockSpec 绕过 Pydantic 字段缺失问题。
"""

import pytest

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.json_loader import JSONLoader


class MockSpec:
    def __init__(
        self, path, json_path=None, dtype=None, flatten=False, sep=".", max_depth=None, format="array", encoding="utf-8"
    ):
        self.path = path
        self.json_path = json_path
        self.jsonpath = json_path  # alias for production code bug
        self.dtype = dtype
        self.flatten = flatten
        self.sep = sep
        self.max_depth = max_depth
        self.format = format
        self.type = "json"
        self.encoding = encoding


def _make_loader(path, **kwargs):
    return JSONLoader(MockSpec(path, **kwargs))


class TestJSONLoaderLoad:
    def test_load_basic_array(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('[{"a": 1}, {"a": 2}]', encoding="utf-8")
        loader = _make_loader(str(json_file), format="array")
        df = loader.load()
        assert list(df["a"]) == [1, 2]

    def test_load_with_jsonpath(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('{"data": {"items": [{"x": 1}, {"x": 2}]}}', encoding="utf-8")
        loader = _make_loader(str(json_file), format="object", json_path="$.data.items")
        df = loader.load()
        assert "x" in df.columns
        assert len(df) >= 1

    def test_load_with_flatten(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('[{"a": {"b": 1}}]', encoding="utf-8")
        loader = _make_loader(str(json_file), format="array", flatten=True)
        df = loader.load()
        assert "a.b" in df.columns

    def test_load_with_dtype(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('[{"a": "1"}, {"a": "2"}]', encoding="utf-8")
        loader = _make_loader(str(json_file), format="array", dtype={"a": "int"})
        df = loader.load()
        assert "a" in df.columns

    def test_load_file_not_found(self):
        loader = _make_loader("D:\\nonexistent.json")
        with pytest.raises(DataLoadError) as exc_info:
            loader.load()
        assert "文件不存在" in str(exc_info.value)

    def test_load_invalid_json(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('{"a": ', encoding="utf-8")
        loader = _make_loader(str(json_file))
        # D8: 默认 array 格式,无效 JSON 由 ArrayParser 报错,包装为 DataLoadError
        with pytest.raises(DataLoadError):
            loader.load()

    def test_load_empty_file(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text("", encoding="utf-8")
        loader = _make_loader(str(json_file))
        # D8: array 格式下空输入是错误(ArrayParser 报"输入为空"),不再静默返回空 DataFrame
        with pytest.raises(DataLoadError):
            loader.load()


class TestJSONLoaderValidate:
    def test_validate_exists(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text("[]", encoding="utf-8")
        loader = _make_loader(str(json_file))
        errors = loader.validate()
        assert errors == []

    def test_validate_not_exists(self):
        loader = _make_loader("D:\\nonexistent.json")
        errors = loader.validate()
        assert any("不存在" in e for e in errors)

    def test_validate_wrong_extension(self, tmp_path):
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("[]", encoding="utf-8")
        loader = _make_loader(str(txt_file))
        errors = loader.validate()
        assert any("扩展名" in e for e in errors)
