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
@fileoverview Project Loader 类型单元测试

测试 LoadingError 和 LoadedProject 数据类。
"""

from pathlib import Path

from app.shared.core.project.loader.types import LoadedProject, LoadingError


class TestLoadingError:
    def test_to_dict(self):
        err = LoadingError(
            error_type="SchemaNotFound",
            file_path="/path/to/schema.yaml",
            ref_id="users",
            message="文件不存在",
            suggestion="检查路径",
        )
        d = err.to_dict()
        assert d["error_type"] == "SchemaNotFound"
        assert d["file_path"] == "/path/to/schema.yaml"
        assert d["ref_id"] == "users"
        assert d["message"] == "文件不存在"
        assert d["suggestion"] == "检查路径"

    def test_defaults(self):
        err = LoadingError(error_type="ParseError", file_path="/x.yaml")
        assert err.ref_id is None
        assert err.message == ""
        assert err.suggestion == ""


class TestLoadedProject:
    def test_post_init_defaults(self):
        lp = LoadedProject(
            manifest_path=Path("/project/manifest.yaml"),
            manifest=None,
            schema_files={},
            constraint_files={},
            regex_node_files={},
            dataset_schema=None,
        )
        assert lp.warnings == []
        assert lp.loading_errors == []

    def test_post_init_preserves_values(self):
        lp = LoadedProject(
            manifest_path=Path("/project/manifest.yaml"),
            manifest=None,
            schema_files={},
            constraint_files={},
            regex_node_files={},
            dataset_schema=None,
            warnings=["warn1"],
            loading_errors=[LoadingError("E", "/f")],
        )
        assert lp.warnings == ["warn1"]
        assert len(lp.loading_errors) == 1
