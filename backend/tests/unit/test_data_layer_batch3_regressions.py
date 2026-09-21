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
"""@fileoverview 2026-09-21 审计第三批数据层项回归测试

覆盖：dot-path 非字符串键、项目历史原子写+损坏备份、strict OOXML
命名空间兼容、xlsx 报告表名清洗去重。
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path


class TestDotPathNonStringKeys:
    def test_get_matches_non_string_key_by_str_form(self):
        from app.cli.shared_services.config_ops import get_by_dotpath

        data = {2024: {"jan": 1}}
        found, value = get_by_dotpath(data, "2024.jan")
        assert found is True
        assert value == 1

    def test_set_reuses_non_string_key_no_shadow(self):
        from app.cli.shared_services.config_ops import set_by_dotpath

        data = {2024: {"jan": 1}}
        result = set_by_dotpath(data, "2024.feb", 2)
        # 复用原 int 键，不写出字符串影子键 "2024"
        same_form = [k for k in result if str(k) == "2024"]
        assert same_form == [2024]
        assert result[2024] == {"jan": 1, "feb": 2}

    def test_set_missing_path_still_creates_string_keys(self):
        from app.cli.shared_services.config_ops import set_by_dotpath

        result = set_by_dotpath({}, "project.name", "x")
        assert result == {"project": {"name": "x"}}


class TestProjectHistoryAtomicWrite:
    def test_corrupt_history_backed_up_not_silently_zeroed(self, tmp_path: Path, monkeypatch):
        from app.cli.shared_services import project_ops

        hist = tmp_path / "history.json"
        hist.write_text("{broken json", encoding="utf-8")
        monkeypatch.setattr(project_ops, "HISTORY_FILE", str(hist))

        loaded = project_ops.load_history()
        assert loaded == []
        backup = tmp_path / "history.json.corrupt.bak"
        assert backup.exists(), "损坏文件应被备份而非静默丢弃"
        assert "{broken json" in backup.read_text(encoding="utf-8")

    def test_save_history_atomic_and_roundtrip(self, tmp_path: Path, monkeypatch):
        from app.cli.shared_services import project_ops

        hist = tmp_path / "sub" / "history.json"
        monkeypatch.setattr(project_ops, "HISTORY_FILE", str(hist))

        project_ops._save_history([{"path": "D:/proj", "last_opened": "2026-09-21T00:00:00"}])
        assert not (tmp_path / "sub" / "history.json.tmp").exists(), "临时文件应已替换"
        data = json.loads(hist.read_text(encoding="utf-8"))
        assert data[0]["path"] == "D:/proj"


class _StrictOoxmlHelper:
    """把 transitional xlsx 的主命名空间改写为 strict 造出 strict OOXML 样本。"""

    TRANSITIONAL = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    STRICT = "http://purl.oclc.org/ooxml/spreadsheetml/2006/main"

    @classmethod
    def rewrite(cls, src: Path, dst: Path) -> None:
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.namelist():
                raw = zin.read(item)
                if item.endswith((".xml", ".rels")):
                    raw = raw.replace(cls.TRANSITIONAL.encode(), cls.STRICT.encode())
                zout.writestr(item, raw)


class TestStrictOoxmlMergedRanges:
    def test_strict_namespace_merged_ranges_parsed(self, tmp_path: Path):
        """strict OOXML 的合并区域与首行值不再静默跳过。"""
        import datetime as dt

        from openpyxl import Workbook

        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        wb = Workbook()
        ws = wb.active
        ws.title = "S"
        ws["A1"], ws["B1"] = "name", "deadline"
        ws["A2"], ws["A3"], ws["A4"] = "甲", "乙", "丙"
        ws["B2"] = dt.date(2024, 1, 15)
        ws.merge_cells("B2:B4")
        normal = tmp_path / "normal.xlsx"
        strict = tmp_path / "strict.xlsx"
        wb.save(normal)
        _StrictOoxmlHelper.rewrite(normal, strict)

        regions = read_merged_ranges_from_xlsx(strict, "S")
        assert regions, "strict OOXML 的合并区域应被解析到（此前命名空间不匹配静默跳过）"
        values = regions[0][4]
        assert isinstance(values[0], (dt.date, dt.datetime)), "日期语义同时保留"


class TestXlsxReportSheetNames:
    def _payload(self, names: list[str]) -> dict:
        return {
            "is_valid": False,
            "duration_ms": 1,
            "tables": [{"name": n} for n in names],
            "errors": [],
            "summary": {"constraints_total": 0, "constraints_passed": 0, "constraints_failed": 0},
        }

    def test_invalid_chars_sanitized_and_collision_resolved(self, tmp_path: Path):
        from openpyxl import load_workbook

        from app.shared.services.validation.report_export import export_excel_report

        out = tmp_path / "r.xlsx"
        path = export_excel_report(self._payload(["订单[1]", "订单/1", "超长" * 20]), out)
        wb = load_workbook(path)
        titles = wb.sheetnames
        # 禁用字符被替换、截断到 31、冲突加序号——三个业务表各自有独立 sheet
        # （"概览" 为报告总览 sheet，不计入）
        assert len([t for t in titles if t != "概览"]) == 3
        assert len(set(titles)) == len(titles), "sheet 名不得重复"
        for t in titles:
            assert len(t) <= 31
            assert not set(t) & set("[]:*?/\\")

    def test_normal_names_unchanged(self, tmp_path: Path):
        from openpyxl import load_workbook

        from app.shared.services.validation.report_export import export_excel_report

        out = tmp_path / "r.xlsx"
        path = export_excel_report(self._payload(["orders"]), out)
        wb = load_workbook(path)
        assert "orders" in wb.sheetnames
