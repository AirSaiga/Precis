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
"""@fileoverview adopt-unlisted 端点单元测试

POST /project/inspection/adopt-unlisted：把磁盘已存在但未登记进 manifest 的
资源"收养"登记。验证登记成功（id/path 取文件实际值）、幂等（已登记返回
already_listed）、404（文件不存在）、路径穿越拒绝与各资源种类覆盖。
"""

from __future__ import annotations

import pytest
import yaml
from fastapi import HTTPException

from app.api.routers.project.inspection_fix import (
    AdoptUnlistedRequest,
    adopt_unlisted,
)


def _write_project(tmp_path, files: dict) -> str:
    """在 tmp_path 下写入项目文件；manifest 缺省为空清单（schemas: [] 等）。"""
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    manifest = tmp_path / "project.precis.yaml"
    if not manifest.exists():
        manifest.write_text(
            "version: 2\nproject:\n  id: p\n  name: P\nschemas: []\nconstraints: []\n"
            "regex_nodes: []\ntransforms: []\nmanual_data: []\n",
            encoding="utf-8",
        )
    return str(tmp_path)


def _read_manifest(tmp_path) -> dict:
    with open(tmp_path / "project.precis.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class TestAdoptUnlistedEndpoint:
    """登记成功 / 幂等 / 404 / 输入校验 / 种类覆盖。"""

    def test_adopt_schema_registers_with_actual_id_and_path(self, tmp_path):
        """按 id 收养：文件名与内容 id 不同时，登记取文件实际 id + 实际路径。"""
        config_path = _write_project(
            tmp_path,
            {
                "schemas/产品库存表.schema.yaml": ("version: 2\nid: sc_inv_001\nname: 产品库存表\ncolumns: []\n"),
            },
        )
        result = adopt_unlisted(
            AdoptUnlistedRequest(resource_type="schema", resource_id="sc_inv_001"),
            config_path,
        )

        assert result["already_listed"] is False
        assert result["resource_id"] == "sc_inv_001"
        refs = _read_manifest(tmp_path)["schemas"]
        assert refs == [{"id": "sc_inv_001", "path": "schemas/产品库存表.schema.yaml"}]

    def test_adopt_by_path(self, tmp_path):
        """按相对路径收养：路径精确命中文件。"""
        config_path = _write_project(
            tmp_path,
            {"regex/phone.regex.yaml": "version: 2\nid: rx_phone\nname: phone\npattern: .*\n"},
        )
        result = adopt_unlisted(
            AdoptUnlistedRequest(resource_type="regex", resource_path="regex/phone.regex.yaml"),
            config_path,
        )

        assert result["already_listed"] is False
        assert _read_manifest(tmp_path)["regex_nodes"] == [{"id": "rx_phone", "path": "regex/phone.regex.yaml"}]

    def test_adopt_is_idempotent(self, tmp_path):
        """幂等：已登记（按路径命中）时返回 already_listed=True，不重复追加。"""
        config_path = _write_project(
            tmp_path,
            {
                "schemas/users.schema.yaml": "version: 2\nid: sc_users\nname: users\ncolumns: []\n",
                "project.precis.yaml": (
                    "version: 2\nproject:\n  id: p\n  name: P\n"
                    "schemas:\n  - id: sc_users\n    path: schemas/users.schema.yaml\n"
                ),
            },
        )
        result = adopt_unlisted(
            AdoptUnlistedRequest(resource_type="schema", resource_id="sc_users"),
            config_path,
        )

        assert result["already_listed"] is True
        assert _read_manifest(tmp_path)["schemas"] == [{"id": "sc_users", "path": "schemas/users.schema.yaml"}]

    def test_adopt_missing_file_returns_404(self, tmp_path):
        config_path = _write_project(tmp_path, {})
        with pytest.raises(HTTPException) as exc_info:
            adopt_unlisted(AdoptUnlistedRequest(resource_type="schema", resource_id="ghost"), config_path)
        assert exc_info.value.status_code == 404

    def test_adopt_missing_manifest_returns_404(self, tmp_path):
        """manifest 不存在：先初始化项目（与其他 inspection 端点口径一致）。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "version: 2\nid: sc_users\nname: users\ncolumns: []\n", encoding="utf-8"
        )
        with pytest.raises(HTTPException) as exc_info:
            adopt_unlisted(AdoptUnlistedRequest(resource_type="schema", resource_id="sc_users"), str(tmp_path))
        assert exc_info.value.status_code == 404

    def test_adopt_rejects_unknown_resource_type(self, tmp_path):
        config_path = _write_project(tmp_path, {})
        with pytest.raises(HTTPException) as exc_info:
            adopt_unlisted(AdoptUnlistedRequest(resource_type="template", resource_id="x"), config_path)
        assert exc_info.value.status_code == 400

    def test_adopt_rejects_path_traversal(self, tmp_path):
        config_path = _write_project(tmp_path, {})
        for bad_path in (
            "../outside.yaml",
            "schemas/../../etc/passwd",
            "C:\\\\windows\\\\system.ini",
            "C:relative.yaml",
        ):
            with pytest.raises(HTTPException) as exc_info:
                adopt_unlisted(AdoptUnlistedRequest(resource_type="schema", resource_path=bad_path), config_path)
            assert exc_info.value.status_code == 400

    def test_adopt_covers_constraint_transform_manual_data(self, tmp_path):
        """种类覆盖：constraint/transform/manual_data 均可收养登记。"""
        config_path = _write_project(
            tmp_path,
            {
                "constraints/c1.constraint.yaml": (
                    "version: 2\nid: c1\ntype: NotNull\nrefs:\n  table_id: t\n  column_id: a\n"
                ),
                "transforms/t1.transform.yaml": "version: 2\nid: t1\ntype: Strip\nenabled: true\n",
                "manual_data/m1.manual_data.yaml": "version: 2\nid: m1\nname: m\nrows: []\n",
            },
        )
        for kind, ref_id, section in (
            ("constraint", "c1", "constraints"),
            ("transform", "t1", "transforms"),
            ("manual_data", "m1", "manual_data"),
        ):
            result = adopt_unlisted(AdoptUnlistedRequest(resource_type=kind, resource_id=ref_id), config_path)
            assert result["already_listed"] is False
            assert _read_manifest(tmp_path)[section] == [
                {"id": ref_id, "path": f"{section}/{ref_id}.{kind if kind != 'manual_data' else 'manual_data'}.yaml"}
            ]

    def test_adopt_falls_back_to_filename_stem_for_broken_file(self, tmp_path):
        """内容不可解析的坏文件：id 回退文件名推导，仍可收养。"""
        config_path = _write_project(tmp_path, {"schemas/broken.schema.yaml": "{{{{ not yaml"})
        result = adopt_unlisted(AdoptUnlistedRequest(resource_type="schema", resource_id="broken"), config_path)

        assert result["resource_id"] == "broken"
        refs = _read_manifest(tmp_path)["schemas"]
        assert refs == [{"id": "broken", "path": "schemas/broken.schema.yaml"}]
