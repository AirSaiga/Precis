# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview loaders/__init__.py 边缘分支单元测试

覆盖 load_source_data、__getattr__ 延迟导入、load_source_data_safe 成功分支。
"""

from unittest.mock import patch

import pytest

from app.shared.core.data_source.loaders import (
    load_source_data,
    load_source_data_safe,
)


class TestLoadSourceData:
    def test_spec_without_type(self):
        with pytest.raises(TypeError, match="type"):
            load_source_data({})

    def test_unsupported_type(self):
        class Spec:
            type = "unknown_xyz"

        with pytest.raises(TypeError, match="不支持"):
            load_source_data(Spec())


class TestLoadSourceDataSafeSuccess:
    def test_safe_load_success(self):
        import pandas as pd

        spec = type("Spec", (), {"type": "json"})()
        with patch("app.shared.core.data_source.loaders.load_source_data", return_value=pd.DataFrame({"a": [1]})):
            df, errors = load_source_data_safe(spec)
        assert df.empty is False
        assert errors == []


class TestLazyImports:
    def test_lazy_excel_loader(self):
        import app.shared.core.data_source.loaders as loaders

        cls = loaders.ExcelLoader
        from app.shared.core.data_source.loaders.excel_loader import ExcelLoader as RealCls

        assert cls is RealCls

    def test_lazy_csv_loader(self):
        import app.shared.core.data_source.loaders as loaders

        cls = loaders.CSVLoader
        from app.shared.core.data_source.loaders.csv_loader import CSVLoader as RealCls

        assert cls is RealCls

    def test_lazy_json_loader(self):
        import app.shared.core.data_source.loaders as loaders

        cls = loaders.JSONLoader
        from app.shared.core.data_source.loaders.json_loader import JSONLoader as RealCls

        assert cls is RealCls

    def test_lazy_sql_loader(self):
        import app.shared.core.data_source.loaders as loaders

        cls = loaders.SQLLoader
        from app.shared.core.data_source.loaders.sql_loader import SQLLoader as RealCls

        assert cls is RealCls

    def test_lazy_unknown_attribute(self):
        import app.shared.core.data_source.loaders as loaders

        with pytest.raises(AttributeError):
            _ = loaders.UnknownLoader
