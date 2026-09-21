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
"""@fileoverview 2026-09-21 审计第三批 MCP 边界项回归测试

覆盖：
- manifest 内容 absolute 数据源越界被拒（resolver 白名单注入）
- infer_schema 的 sample_rows 非正数拒绝（协议 schema minimum:1 + 直调兜底）
- JSONL/Excel 采样截断不读全文
"""

from __future__ import annotations

from pathlib import Path

import pytest


class TestResolverAllowedRoots:
    """DataSourceResolver 白名单：absolute 数据源复用根校验。"""

    def _make_resolver(self, tmp_path: Path, manifest_src: str, schema_src: str, allowed_roots):
        from app.shared.core.project.loader import load_project

        proj = tmp_path / "proj"
        (proj / "schemas").mkdir(parents=True)
        (proj / "data").mkdir()
        (proj / "data" / "orders.csv").write_text("id,qty\n1,2\n", encoding="utf-8")
        (proj / "schemas" / "orders.schema.yaml").write_text(schema_src, encoding="utf-8")
        (proj / "project.precis.yaml").write_text(manifest_src, encoding="utf-8")

        loaded = load_project(str(proj / "project.precis.yaml"))
        from app.shared.services.validation.resolver import DataSourceResolver

        return DataSourceResolver(
            project_root=str(proj),
            manifest=loaded.manifest,
            schema_by_id=loaded.schema_files,
            allowed_roots=allowed_roots,
        )

    def test_absolute_file_outside_roots_rejected(self, tmp_path: Path):
        """schema 声明 absolute_file 越界路径 → 解析返回 None（不读越界文件）。"""
        outside = tmp_path / "outside" / "secret.csv"
        schema_src = (
            "version: 2\nid: orders\nname: orders\n"
            f"source:\n  mode: absolute_file\n  path: {outside.as_posix()}\n"
            "columns:\n  - id: id\n    name: id\n    type: integer\n"
        )
        resolver = self._make_resolver(
            tmp_path,
            "version: 2\nproject:\n  id: p\n  name: p\nschemas:\n  - id: orders\n    path: schemas/orders.schema.yaml\n",
            schema_src,
            allowed_roots=[str(tmp_path / "proj")],
        )
        path, _sheet = resolver.resolve_source_path(str(tmp_path / "proj"), resolver._schema_by_id["orders"])
        assert path is None

    def test_absolute_file_inside_roots_allowed(self, tmp_path: Path):
        """白名单根内的 absolute_file 正常解析（回归：不能误伤合法场景）。"""
        inside = tmp_path / "proj" / "data" / "orders.csv"
        schema_src = (
            "version: 2\nid: orders\nname: orders\n"
            f"source:\n  mode: absolute_file\n  path: {inside.as_posix()}\n"
            "columns:\n  - id: id\n    name: id\n    type: integer\n"
        )
        resolver = self._make_resolver(
            tmp_path,
            "version: 2\nproject:\n  id: p\n  name: p\nschemas:\n  - id: orders\n    path: schemas/orders.schema.yaml\n",
            schema_src,
            allowed_roots=[str(tmp_path / "proj")],
        )
        path, _sheet = resolver.resolve_source_path(str(tmp_path / "proj"), resolver._schema_by_id["orders"])
        assert path is not None and path.endswith("orders.csv")

    def test_no_roots_injected_keeps_legacy_behavior(self, tmp_path: Path):
        """CLI 场景不注入 allowed_roots：absolute_file 维持原样放行。"""
        outside = tmp_path / "outside" / "legacy.csv"
        outside.parent.mkdir()
        outside.write_text("id\n1\n", encoding="utf-8")
        schema_src = (
            "version: 2\nid: orders\nname: orders\n"
            f"source:\n  mode: absolute_file\n  path: {outside.as_posix()}\n"
            "columns:\n  - id: id\n    name: id\n    type: integer\n"
        )
        resolver = self._make_resolver(
            tmp_path,
            "version: 2\nproject:\n  id: p\n  name: p\nschemas:\n  - id: orders\n    path: schemas/orders.schema.yaml\n",
            schema_src,
            allowed_roots=None,
        )
        path, _sheet = resolver.resolve_source_path(str(tmp_path / "proj"), resolver._schema_by_id["orders"])
        assert path is not None


class TestInferSchemaSampling:
    """sample_rows 边界与采样截断。"""

    def test_mcp_tool_rejects_non_positive_sample_rows(self):
        from app.mcp_server import tool_infer_schema

        with pytest.raises(ValueError, match="sample_rows"):
            tool_infer_schema(data_file="whatever.csv", sample_rows=0)

    def test_jsonl_head_stops_at_sample_rows(self, tmp_path: Path):
        """JSONL 采样：凑满 sample_rows 行即停（不解析全文）。"""
        import pandas as pd

        from app.shared.services.schema_inference import _read_json_head

        lines = "\n".join(f'{{"id": {i}}}' for i in range(100))
        f = tmp_path / "stream.jsonl"
        f.write_text(lines, encoding="utf-8")

        df = _read_json_head(f, 5)
        assert len(df) == 5
        assert list(pd.DataFrame(df)["id"]) == [0, 1, 2, 3, 4]

    def test_excel_head_uses_nrows(self, tmp_path: Path):
        """Excel 采样经 nrows 截断：仅读头部样本行。"""
        from openpyxl import Workbook

        from app.shared.services.schema_inference import _read_head

        wb = Workbook()
        ws = wb.active
        ws.append(["id"])
        for i in range(50):
            ws.append([str(i)])
        f = tmp_path / "head.xlsx"
        wb.save(f)

        df = _read_head(f, 3)
        assert len(df) == 3
