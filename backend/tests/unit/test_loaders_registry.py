"""
@fileoverview 数据源加载器注册表单元测试

测试 loader 注册、获取、类型查询。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.data_source.loaders import registry as reg
from app.shared.core.data_source.loaders.base import DataSourceLoader


class FakeSpec:
    def get_discriminator_value(self):
        return "fake"


class FakeLoader(DataSourceLoader):
    spec_class = FakeSpec

    def load(self):
        import pandas as pd

        return pd.DataFrame()


class TestRegisterLoader:
    def setup_method(self):
        self._original = dict(reg.LOADER_REGISTRY)

    def teardown_method(self):
        reg.LOADER_REGISTRY.clear()
        reg.LOADER_REGISTRY.update(self._original)

    def test_register_new_loader(self):
        @reg.register_loader("fake_new")
        class NewLoader(DataSourceLoader):
            spec_class = FakeSpec

            def load(self):
                import pandas as pd

                return pd.DataFrame()

        assert "fake_new" in reg.LOADER_REGISTRY

    def test_register_duplicate_raises(self):
        @reg.register_loader("dup")
        class DupLoader(DataSourceLoader):
            spec_class = FakeSpec

            def load(self):
                import pandas as pd

                return pd.DataFrame()

        with pytest.raises(ValueError, match="已注册"):

            @reg.register_loader("dup")
            class DupLoader2(DataSourceLoader):
                spec_class = FakeSpec

                def load(self):
                    import pandas as pd

                    return pd.DataFrame()


class TestGetLoader:
    def setup_method(self):
        self._original = dict(reg.LOADER_REGISTRY)
        reg.LOADER_REGISTRY["fake"] = FakeLoader

    def teardown_method(self):
        reg.LOADER_REGISTRY.clear()
        reg.LOADER_REGISTRY.update(self._original)

    def test_get_loader_for_spec(self):
        spec = FakeSpec()
        loader = reg.get_loader_for_spec(spec)
        assert isinstance(loader, FakeLoader)

    def test_get_loader_for_spec_missing(self):
        class MissingSpec:
            def get_discriminator_value(self):
                return "missing"

        with pytest.raises(ValueError, match="未找到"):
            reg.get_loader_for_spec(MissingSpec())

    def test_get_loader_class_for_type(self):
        cls = reg.get_loader_class_for_type("fake")
        assert cls is FakeLoader

    def test_get_loader_class_for_type_missing(self):
        with pytest.raises(KeyError, match="未找到"):
            reg.get_loader_class_for_type("nope")

    def test_supports_source_type(self):
        assert reg.supports_source_type("fake") is True
        assert reg.supports_source_type("nope") is False

    def test_get_supported_types(self):
        types = reg.get_supported_types()
        assert "fake" in types

    def test_register_loader_class(self):
        class AnotherLoader(DataSourceLoader):
            spec_class = FakeSpec

            def load(self):
                import pandas as pd

                return pd.DataFrame()

        reg.register_loader_class("another", AnotherLoader)
        assert reg.supports_source_type("another") is True
        assert reg.get_loader_class_for_type("another") is AnotherLoader
