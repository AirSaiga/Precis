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
@fileoverview 数据源加载器入口模块单元测试

测试 loaders/__init__.py 中的注册表和加载辅助函数。
"""

import pytest

from app.shared.core.data_source.loaders import (
    can_load_type,
    get_loader_for_source_type,
    get_supported_types,
    load_source_data_safe,
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


class TestLoadSourceDataSafe:
    def test_safe_load_error(self):
        class BadSpec:
            pass

        df, errors = load_source_data_safe(BadSpec())
        assert len(errors) == 1
        assert df.empty
