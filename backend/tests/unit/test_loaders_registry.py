"""
@fileoverview 数据源加载器注册表单元测试

测试 loader 注册、获取、类型查询。
"""

import pytest

from app.shared.core.data_source.loaders import registry as reg
from app.shared.core.data_source.loaders.base import DataSourceLoader


class FakeSpec:
    def get_discriminator_value(self):
        return "fake"


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
