"""
@fileoverview 数据源加载器入口模块单元测试

测试 loaders/__init__.py 中的注册表和加载辅助函数。
"""

import pytest

from app.shared.core.data_source.loaders import (
    can_load_type,
    get_loader_for_source_type,
    get_supported_types,
    load_multiple_sources,
    load_source_data_safe,
    register_loader_for_type,
    validate_source_spec,
)
from app.shared.core.data_source.loaders.base import DataSourceLoader

# Eagerly import loader modules to populate LOADER_REGISTRY


class TestGetLoaderForSourceType:
    def test_existing_type(self):
        cls = get_loader_for_source_type("json")
        assert issubclass(cls, DataSourceLoader)

    def test_missing_type_raises(self):
        with pytest.raises(TypeError, match="不支持的数据源类型"):
            get_loader_for_source_type("nonexistent")


class TestRegisterLoaderForType:
    def test_register_and_retrieve(self):
        class DummyLoader(DataSourceLoader):
            spec_class = object

            def load(self):
                pass

        register_loader_for_type("dummy", DummyLoader)
        assert get_loader_for_source_type("dummy") is DummyLoader


class TestGetSupportedTypes:
    def test_returns_list(self):
        types = get_supported_types()
        assert isinstance(types, list)
        assert "json" in types
        assert "csv" in types


class TestCanLoadType:
    def test_true_for_existing(self):
        assert can_load_type("json") is True

    def test_false_for_missing(self):
        assert can_load_type("unknown") is False


class TestValidateSourceSpec:
    def test_missing_type_raises(self):
        with pytest.raises(ValueError, match="type"):
            validate_source_spec({})

    def test_unsupported_type_raises(self):
        class Spec:
            type = "unknown"

        with pytest.raises(ValueError, match="不支持"):
            validate_source_spec(Spec())

    def test_valid_spec(self):
        class Spec:
            type = "json"

        assert validate_source_spec(Spec()) is True

    def test_missing_file_raises(self, tmp_path):
        class Spec:
            type = "json"
            path = str(tmp_path / "nonexistent.json")

        with pytest.raises(ValueError, match="不存在"):
            validate_source_spec(Spec())

    def test_existing_file(self, tmp_path):
        f = tmp_path / "test.json"
        f.write_text("{}")

        class Spec:
            type = "json"
            path = str(f)

        assert validate_source_spec(Spec()) is True


class TestLoadSourceDataSafe:
    def test_safe_load_error(self):
        class BadSpec:
            pass

        df, errors = load_source_data_safe(BadSpec())
        assert len(errors) == 1
        assert df.empty


class TestLoadMultipleSources:
    def test_empty_list(self):
        result = load_multiple_sources([])
        assert result == {}

    def test_with_bad_specs(self):
        class BadSpec:
            pass

        result = load_multiple_sources([BadSpec(), BadSpec()])
        assert result == {}

    def test_mixed_specs(self):
        class GoodSpec:
            type = "json"
            name = "good"
            path = ""

        class BadSpec:
            pass

        # GoodSpec will fail at actual load but has type attr
        result = load_multiple_sources([GoodSpec(), BadSpec()])
        # good spec fails during load_source_data but is caught
        assert "good" not in result
