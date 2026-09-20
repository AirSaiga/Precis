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
"""@fileoverview 2026-09-18 逻辑漏洞治理第二轮 B3 批次（分块/加载/展示）回归测试

覆盖 docs/plans/2026-09-18-logic-remediation/01 规格中 B3 批次的修复：
- §1.4  空串口径统一为"缺失值豁免"（AllowedValues/Regex/Range 对齐）
- §1.19 days_diff 按 24h 完整天数、去掉 .abs()、小数目标值报错
- §1.30 约束错误的 source_file/source_sheet 附加（显示名反查回退）
- §1.31 分块中断块计入进度 + Timeout 每报告一次
- §1.27 分块 Excel 合并单元格前向填充（B7 同构）
"""

from __future__ import annotations

import time
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pandas as pd

# ============================================================
# §1.4 空串口径统一（缺失值豁免）
# ============================================================


class TestEmptyStringExemption:
    def test_allowed_values_blank_string_exempt(self):
        from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint

        constraint = AllowedValuesConstraint(table="t", column="c", allowed_values=["A", "B"])
        result = constraint.validate({"t": pd.DataFrame({"c": ["A", "", "  ", "C"]})})
        violations = [e for e in result["errors"] if e["error_type"] == "AllowedValuesViolation"]
        # 空串/全空白豁免；"C" 仍违规
        assert len(violations) == 1
        assert violations[0]["value"] == "C"

    def test_regex_blank_string_exempt(self):
        from app.shared.domain.constraints.regex import RegexConstraint

        constraint = RegexConstraint(
            table="t", column="c", pattern=r"\d+", match_mode="full", case_sensitive=True, flags=""
        )
        result = constraint.validate({"t": pd.DataFrame({"c": ["123", "", "   ", "abc"]})})
        violations = [e for e in result["errors"] if e["error_type"] == "RegexViolation"]
        # 空串/全空白豁免；"abc" 仍违规
        assert len(violations) == 1
        assert violations[0]["value"] == "abc"

    def test_range_decimal_blank_string_exempt(self):
        from app.shared.domain.constraints.range import RangeConstraint

        constraint = RangeConstraint(table="t", column="c", min_value=Decimal("0"), max_value=Decimal("100"))
        result = constraint.validate({"t": pd.DataFrame({"c": [Decimal("50"), "", "150"]})})
        violations = [e for e in result["errors"] if e["error_type"] == "RangeViolation"]
        # 空串豁免（原 Decimal("") 抛 InvalidOperation 判违规且消息误导）；150 越界仍违规
        assert len(violations) == 1


# ============================================================
# §1.19 days_diff 语义收紧
# ============================================================


class TestDaysDiffSemantics:
    def _constraint(self, compare_op, target_value):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        return DateLogicConstraint(
            table="t",
            column="d",
            logic_mode="calculation",
            calculation_type="days_diff",
            compare_op=compare_op,
            target_value=target_value,
            target_column="ref",
        )

    def test_partial_day_not_equal_to_three(self):
        """3 天 1 小时的差 vs eq 3 → 违规（截断时代会通过）"""
        constraint = self._constraint("eq", 3)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-04 01:00"], "ref": ["2024-01-01"]})})
        errors = [e for e in result["errors"] if e["error_type"] == "DateLogicError"]
        assert len(errors) == 1

    def test_negative_diff_does_not_satisfy_positive_eq(self):
        """目标列早 3 天（差 -3）vs eq 3 → 违规（abs 时代会通过）"""
        constraint = self._constraint("eq", 3)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-01"], "ref": ["2024-01-04"]})})
        errors = [e for e in result["errors"] if e["error_type"] == "DateLogicError"]
        assert len(errors) == 1

    def test_negative_diff_satisfies_negative_eq(self):
        """差 -3 vs eq -3 → 通过"""
        constraint = self._constraint("eq", -3)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-01"], "ref": ["2024-01-04"]})})
        assert result["errors"] == []

    def test_fractional_target_value_reports_config_error(self):
        constraint = self._constraint("eq", "3.5")
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-04"], "ref": ["2024-01-01"]})})
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1
        assert "3.5" in config_errors[0]["message"]

    def test_exact_day_diff_regression(self):
        """恰好 24h 整数倍差 vs eq 3 → 通过"""
        constraint = self._constraint("eq", 3)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-04"], "ref": ["2024-01-01"]})})
        # 这里的正差 3 天：d=0104 - ref=0101 = +3 → eq 3 通过
        assert result["errors"] == []


# ============================================================
# §1.30 约束错误 source 附加
# ============================================================


class TestConstraintErrorSourceAttachment:
    def _make_schema_file(self, source_path, sheet=None):
        from app.shared.core.project.schema.types import TableSchemaFile

        source = MagicMock()
        source.path = source_path
        source.sheet = sheet
        schema = MagicMock(spec=TableSchemaFile)
        schema.source = source
        schema.sheet = sheet
        return schema

    def test_constraint_error_gets_source_file_after_name_mapping(self):
        from app.shared.services.validation.postprocess import postprocess_result

        schema_file = self._make_schema_file("data/orders.xlsx", sheet="Sheet1")
        schema_by_id = {"t-001": schema_file}
        dataset_schema = MagicMock()
        table = MagicMock()
        table.id = "t-001"
        table.name = "订单表"
        dataset_schema.tables = {"t-001": table}

        # 约束错误条目：只有 table 键（值是表 ID），无 table_id —— map 后变显示名
        result = {
            "errors": [
                {"error_type": "NotNullViolation", "table": "t-001", "column": "c", "message": "x"},
            ],
            "loading_errors": [],
            "validation_details": {
                "format_checks": [
                    {"error_type": "TypeValidationError", "table_id": "t-001", "table": "订单表"},
                ],
                "constraint_checks": [
                    {"error_type": "UniqueViolation", "table": "t-001", "column": "c"},
                ],
            },
        }
        postprocess_result(result, dataset_schema, schema_by_id)

        constraint_error = result["errors"][0]
        assert constraint_error["table"] == "订单表"  # ID 已换显示名
        assert constraint_error["source_file"] == "data/orders.xlsx"  # 反查回退命中
        assert constraint_error["source_sheet"] == "Sheet1"
        detail = result["validation_details"]["constraint_checks"][0]
        assert detail["source_file"] == "data/orders.xlsx"
        fmt = result["validation_details"]["format_checks"][0]
        assert fmt["source_file"] == "data/orders.xlsx"

    def test_unknown_table_stays_without_source(self):
        from app.shared.services.validation.postprocess import postprocess_result

        result = {
            "errors": [{"error_type": "X", "table": "no-such", "message": "x"}],
            "loading_errors": [],
            "validation_details": {"format_checks": [], "constraint_checks": []},
        }
        dataset_schema = MagicMock()
        dataset_schema.tables = {}
        postprocess_result(result, dataset_schema, {})
        assert "source_file" not in result["errors"][0]


# ============================================================
# §1.31 分块循环：中断块进度 + Timeout 去重
# ============================================================


class TestChunkedLoopTimeoutAndProgress:
    def _make_executor(self):
        import app.shared.services.validation.executor as exec_mod

        executor = exec_mod.ValidationExecutor.__new__(exec_mod.ValidationExecutor)
        executor.dataset_schema = MagicMock()
        executor.settings = MagicMock()
        return executor

    def test_timeout_recorded_once_across_tables(self):
        """两表 × 立即超时 → Timeout 恰 1 条（原实现每表追加一条重复错误）"""
        executor = self._make_executor()
        chunked_datasets = {
            "t1": [pd.DataFrame({"a": [1]})],
            "t2": [pd.DataFrame({"a": [2]})],
        }
        from app.shared.services.validation.executor import ValidationOptions

        # deadline 已过（started 取当前、timeout 0 → deadline = started < 循环内 now）
        parsed, errors, details, interrupted = executor._parse_chunks_loop(
            chunked_datasets,
            ValidationOptions(timeout_seconds=0),
            time.monotonic(),
            total_rows=2,
            total_chunks=2,
            allow_unsafe_eval=False,
            deadline=time.monotonic() - 1,  # 已过期
            stop_on_first_error=False,
        )
        timeouts = [e for e in errors if e["error_type"] == "Timeout"]
        assert len(timeouts) == 1
        assert "剩余分块未执行" in timeouts[0]["message"]

    def test_interrupted_chunk_counted_in_progress(self):
        """超时中断块的行数计入 rows_done 进度（started 事件后补计保持单调）"""
        executor = self._make_executor()
        progress_events = []

        def cb(event):
            progress_events.append(event)

        chunked_datasets = {"t1": [pd.DataFrame({"a": [1, 2, 3, 4, 5]})]}
        from app.shared.services.validation.executor import ValidationOptions

        parsed, errors, details, interrupted = executor._parse_chunks_loop(
            chunked_datasets,
            ValidationOptions(timeout_seconds=0),
            time.monotonic(),
            total_rows=5,
            total_chunks=1,
            allow_unsafe_eval=False,
            deadline=time.monotonic() - 1,
            stop_on_first_error=False,
            progress_callback=cb,
        )
        # started 事件（rows_done=0）之后应有补计的行数出现在后续事件中——
        # 超时 break 前补计 5 行，done 阶段事件或最终 rows_done 应达 5
        assert any(ev.rows_done == 5 for ev in progress_events if hasattr(ev, "rows_done")) or (
            isinstance(progress_events[-1], dict) and progress_events[-1].get("rows_done") == 5
        )

    def test_stop_on_first_error_counts_interrupted_chunk(self):
        """stop_on_first_error 中断：当前块已完整处理，行数计入"""
        executor = self._make_executor()
        chunked_datasets = {
            "t1": [
                pd.DataFrame({"a": [1, 2]}),
                pd.DataFrame({"a": [3, 4]}),
            ]
        }
        from app.shared.services.validation.executor import ValidationOptions

        progress_events = []

        def cb(event):
            progress_events.append(event)

        with patch(
            "app.shared.services.validation.executor.validate_full_dataset",
            return_value=(
                {},
                [{"error_type": "TypeValidationError", "message": "bad"}],
                {"format_checks": [], "constraint_checks": []},
            ),
        ) as mock_validate:
            parsed, errors, details, interrupted = executor._parse_chunks_loop(
                chunked_datasets,
                ValidationOptions(timeout_seconds=300, error_handling="stop"),
                time.monotonic(),
                total_rows=4,
                total_chunks=2,
                allow_unsafe_eval=False,
                deadline=None,
                stop_on_first_error=True,
                progress_callback=cb,
            )
        assert interrupted is True
        assert mock_validate.call_count == 1  # 第一块后即停
        events = [e for e in progress_events if hasattr(e, "rows_done")]
        assert any(e.rows_done == 2 for e in events)  # 中断块 2 行已计入


# ============================================================
# §1.27 分块 Excel 合并单元格填充
# ============================================================


class TestChunkedExcelMergedFill:
    def _write_merged_xlsx(self, tmp_path, merged_spec):
        """构造含合并单元格的 xlsx：列 dept 每 merged_spec 行合并一次，name 逐行不同"""
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws.append(["dept", "name"])
        row = 2
        for dept, count in merged_spec:
            for i in range(count):
                ws.append([dept if i == 0 else None, f"n{row}"])
                row += 1
            ws.merge_cells(start_row=row - count, start_column=1, end_row=row - 1, end_column=1)
        path = tmp_path / "merged.xlsx"
        wb.save(path)
        return path

    def _loader(self):
        from app.shared.services.validation.chunked_loader import ChunkedDataLoader

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        return loader

    def test_merged_region_filled_in_chunks(self, tmp_path):
        """合并区域非首行取区域首行值（分块路径对齐标准路径 B7 语义）"""
        path = self._write_merged_xlsx(tmp_path, [("总部", 3), ("分部", 2)])
        loader = self._loader()
        chunks = loader._load_excel_chunked(str(path), "Sheet1", 0, chunk_size=2)

        all_depts = []
        for chunk in chunks:
            all_depts.extend(chunk["dept"].tolist())
        assert all_depts == ["总部", "总部", "总部", "分部", "分部"]

    def test_global_row_indices_continuous(self, tmp_path):
        """回归 #8：分块行号全局连续不受填充影响"""
        path = self._write_merged_xlsx(tmp_path, [("A", 4)])
        loader = self._loader()
        chunks = loader._load_excel_chunked(str(path), "Sheet1", 0, chunk_size=2)
        expected_start = 0
        for chunk in chunks:
            assert chunk.index[0] == expected_start
            assert list(chunk.index) == list(range(expected_start, expected_start + len(chunk)))
            expected_start += len(chunk)

    def test_merged_region_within_single_chunk(self, tmp_path):
        """合并区域整体落在单块内：全部填充"""
        path = self._write_merged_xlsx(tmp_path, [("总部", 3)])
        loader = self._loader()
        chunks = loader._load_excel_chunked(str(path), "Sheet1", 0, chunk_size=10)
        assert len(chunks) == 1
        assert chunks[0]["dept"].tolist() == ["总部", "总部", "总部"]

    def test_no_merged_ranges_unchanged(self, tmp_path):
        """无合并单元格的文件：行为不变"""
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws.append(["a"])
        ws.append([1])
        ws.append([2])
        path = tmp_path / "plain.xlsx"
        wb.save(path)

        loader = self._loader()
        chunks = loader._load_excel_chunked(str(path), "Sheet1", 0, chunk_size=1)
        values = [c["a"].tolist() for c in chunks]
        assert values == [[1], [2]]


class TestXlsxMergedRangesReader:
    """2026-09-20 修复回归：合并区域读取改 zipfile+ElementTree 流式解析。

    修复动机：openpyxl 普通模式 load_workbook 会把全部 sheet 的 Cell 对象图
    整体物化（0.5MB/15 万格实测峰值 55MB vs read_only ≈0MB，~120 倍放大），
    恰好落在 >500MB 分块校验为之设计的场景上。read_only 模式的
    ReadOnlyWorksheet 无 merged_cells 属性，故按 OOXML 结构直接流式解析。
    """

    def _write_xlsx(self, tmp_path, rows, merges):
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        for row in rows:
            ws.append(row)
        for ref in merges:
            ws.merge_cells(ref)
        path = tmp_path / "m.xlsx"
        wb.save(path)
        return path

    def test_reader_vertical_merge_bounds_and_value(self, tmp_path):
        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        path = self._write_xlsx(
            tmp_path,
            rows=[["dept", "name"], ["总部", "a"], [None, "b"], [None, "c"]],
            merges=["A2:A4"],
        )
        ranges = read_merged_ranges_from_xlsx(str(path), "Sheet1")
        assert ranges == [(2, 1, 4, 1, ["总部"])]

    def test_reader_horizontal_merge_first_row_values(self, tmp_path):
        """跨列合并：values 为首行 min_col..max_col 各列值（非锚点格为 None）。"""
        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        path = self._write_xlsx(
            tmp_path,
            rows=[["h1", "h2", "h3"], ["合并值", None, None], ["x", "y", "z"]],
            merges=["A2:C2"],
        )
        ranges = read_merged_ranges_from_xlsx(str(path), "Sheet1")
        assert ranges == [(2, 1, 2, 3, ["合并值", None, None])]

    def test_reader_numeric_first_row_value(self, tmp_path):
        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        path = self._write_xlsx(tmp_path, rows=[["n"], [42], [None], [None]], merges=["A2:A4"])
        ranges = read_merged_ranges_from_xlsx(str(path), "Sheet1")
        assert ranges == [(2, 1, 4, 1, [42])]

    def test_reader_unknown_sheet_returns_none(self, tmp_path):
        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        path = self._write_xlsx(tmp_path, rows=[["a"], [1]], merges=[])
        assert read_merged_ranges_from_xlsx(str(path), "NoSuchSheet") is None

    def test_reader_no_merges_returns_empty(self, tmp_path):
        from app.shared.core.data_source.loaders.excel_loader import read_merged_ranges_from_xlsx

        path = self._write_xlsx(tmp_path, rows=[["a"], [1]], merges=[])
        assert read_merged_ranges_from_xlsx(str(path), "Sheet1") == []

    def test_reader_xls_degrades_to_none(self, tmp_path):
        """非 zip 容器（.xls）：调用方降级为 None（跳过填充），不向上抛。"""
        from app.shared.services.validation.chunked_loader import ChunkedDataLoader

        p = tmp_path / "fake.xls"
        p.write_bytes(b"not a zip")
        assert ChunkedDataLoader._read_excel_merged_ranges(str(p), "Sheet1") is None
