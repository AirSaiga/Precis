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
@fileoverview 数据源加载器基类单元测试

测试 DataSourceLoader、DataLoadError、ValidationError。
"""

from unittest.mock import MagicMock

import pandas as pd
import pytest

from app.shared.core.data_source.loaders.base import (
    DataLoadError,
    DataSourceLoader,
    ValidationError,
)


class MockSpec:
    type = "mock"
    source_type = "mock"


class ConcreteLoader(DataSourceLoader):
    spec_class = MockSpec

    def load(self) -> pd.DataFrame:
        return pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})


class TestDataSourceLoader:
    def test_concrete_loader_load(self):
        loader = ConcreteLoader(MockSpec())
        df = loader.load()
        assert len(df) == 3
        assert list(df.columns) == ["a", "b"]

    def test_load_batch_default(self):
        loader = ConcreteLoader(MockSpec())
        batches = list(loader.load_batch(batch_size=2))
        assert len(batches) == 1
        assert len(batches[0]) == 3

    def test_validate_default_returns_empty(self):
        loader = ConcreteLoader(MockSpec())
        assert loader.validate() == []

    def test_preview(self):
        loader = ConcreteLoader(MockSpec())
        preview = loader.preview(nrows=2)
        assert len(preview) == 2
        assert list(preview.columns) == ["a", "b"]

    def test_get_schema(self):
        loader = ConcreteLoader(MockSpec())
        schema = loader.get_schema()
        assert "a" in schema
        assert "b" in schema
        assert "int" in schema["a"].lower() or "Int" in schema["a"]

    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            DataSourceLoader(MockSpec())


class TestDataLoadError:
    def test_basic_message(self):
        err = DataLoadError("文件未找到")
        assert str(err) == "文件未找到"

    def test_message_with_spec(self):
        spec = MagicMock()
        spec.type = "csv"
        err = DataLoadError("文件未找到", spec=spec)
        assert "[csv]" in str(err)
        assert "文件未找到" in str(err)

    def test_message_with_spec_and_cause(self):
        spec = MagicMock()
        spec.type = "excel"
        cause = ValueError("权限不足")
        err = DataLoadError("无法打开文件", spec=spec, cause=cause)
        msg = str(err)
        assert "[excel]" in msg
        assert "无法打开文件" in msg
        assert "权限不足" in msg

    def test_attributes(self):
        spec = MagicMock()
        cause = RuntimeError("boom")
        err = DataLoadError("fail", spec=spec, cause=cause)
        assert err.spec is spec
        assert err.cause is cause


class TestValidationError:
    def test_is_exception(self):
        err = ValidationError("验证失败")
        assert isinstance(err, Exception)
        assert str(err) == "验证失败"
