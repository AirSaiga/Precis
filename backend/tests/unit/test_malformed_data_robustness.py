# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 畸形输入与边界数据健壮性矩阵（失效模式清单 A/B 系列）

校验引擎的输入全是不可信外部文件，本文件按真实用户会撞上的失效模式
逐项钉死期望行为：结构化错误（DataLoadError）或定义好的解析结果，
不允许裸 traceback。矩阵与缺口盘点见 AGENTS.md 缺陷处理分级与
本文件各类 docstring（A1-A6 畸形输入 / B1-B3 边界数据）。
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.loaders.excel_loader import ExcelLoader
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec


def _csv(path: Path, on_bad_lines: str | None = None):
    spec = (
        CSVSourceSpec(path=str(path), mode="relative")
        if on_bad_lines is None
        else CSVSourceSpec(path=str(path), mode="relative", on_bad_lines=on_bad_lines)
    )
    return CSVLoader(spec).load()


class TestMalformedInput:
    """A 系列：畸形输入（0 字节 / 仅表头 / ragged / 损坏 zip / 编码 / 引号）"""

    def test_a1_empty_csv_structured_error(self, tmp_path):
        """A1: 0 字节 CSV → DataLoadError（含路径），不裸抛。"""
        p = tmp_path / "empty.csv"
        p.write_bytes(b"")
        with pytest.raises(DataLoadError, match="为空"):
            _csv(p)

    def test_a1_corrupt_xlsx_zip_structured_error(self, tmp_path):
        """A1/A4: 非 zip 字节的 .xlsx → DataLoadError，不裸抛 BadZipFile。"""
        p = tmp_path / "corrupt.xlsx"
        p.write_bytes(b"not a zip file at all")
        with pytest.raises(DataLoadError):
            ExcelLoader(ExcelSourceSpec(path=str(p), mode="relative")).load()

    def test_a2_header_only_csv_keeps_columns(self, tmp_path):
        """A2: 仅表头 CSV → 空 DataFrame 且列名保留（下游按 0 行处理）。"""
        p = tmp_path / "header_only.csv"
        p.write_bytes(b"id,name,amount\n")
        df = _csv(p)
        assert df.empty
        assert list(df.columns) == ["id", "name", "amount"]

    def test_a2_header_only_xlsx_keeps_columns(self, tmp_path):
        """A2: 仅表头 xlsx → 空 DataFrame 且列名保留。"""
        from openpyxl import Workbook

        p = tmp_path / "header_only.xlsx"
        wb = Workbook()
        ws = wb.active
        ws.append(["id", "name", "amount"])
        wb.save(p)
        df = ExcelLoader(ExcelSourceSpec(path=str(p), mode="relative")).load()
        assert df.empty
        assert list(df.columns) == ["id", "name", "amount"]

    def test_a3_ragged_extra_fields_fails_closed_with_line_number(self, tmp_path):
        """A3: 字段数超表头的行 → DataLoadError 且消息含行号（漏报红线，fail-closed）。

        历史行为为 pandas on_bad_lines='warn' 静默跳过该行（仅 stderr 警告），
        用户在缺行数据上看到全绿——已按缺陷分级"数据漏报"改为默认报错。
        """
        p = tmp_path / "ragged.csv"
        p.write_bytes(b"id,name\n1,a\n2,b,extra\n3,c\n")
        with pytest.raises(DataLoadError, match="line 3"):
            _csv(p)

    def test_a3_ragged_short_fields_padded_kept(self, tmp_path):
        """A3: 字段数少于表头的行 → NaN 补齐保留（CSV 常规容忍，不丢行）。"""
        p = tmp_path / "short.csv"
        p.write_bytes(b"id,name\n1,a\n2\n3,c\n")
        df = _csv(p)
        assert len(df) == 3
        assert pd.isna(df.loc[1, "name"])

    def test_a3_bad_lines_warn_opt_in_still_skips(self, tmp_path):
        """A3: 显式 on_bad_lines='warn' 保留跳过容忍（opt-in 路径不回归）。"""
        p = tmp_path / "ragged.csv"
        p.write_bytes(b"id,name\n1,a\n2,b,extra\n3,c\n")
        df = _csv(p, on_bad_lines="warn")
        assert len(df) == 2

    def test_a5_gbk_bytes_decoded(self, tmp_path):
        """A5: 合法 GBK 编码 CSV → 自动检测并正确解码中文。"""
        p = tmp_path / "gbk.csv"
        p.write_bytes("id,name\n1,中文测试\n".encode("gbk"))
        df = _csv(p)
        assert df.loc[0, "name"] == "中文测试"

    def test_a5_mixed_encoding_no_crash(self, tmp_path):
        """A5: GBK+UTF-8 混合编码 → 不崩溃（按可解码编码读取，乱码值由约束/类型层报告）。"""
        p = tmp_path / "mixed.csv"
        p.write_bytes(b"id,name\n1," + "中文".encode("gbk") + b"\n2," + "中文".encode() + b"\n")
        df = _csv(p)
        assert len(df) == 2

    def test_a6_unclosed_quote_structured_error(self, tmp_path):
        """A6: 引号未闭合 → DataLoadError（EOF inside string）。"""
        p = tmp_path / "unclosed.csv"
        p.write_bytes(b'id,name\n1,"unclosed\n2,b\n')
        with pytest.raises(DataLoadError, match="tokenizing"):
            _csv(p)


class TestBoundaryData:
    """B 系列：边界数据（全空列 / 单行 / 极值）"""

    def test_b1_all_nan_column_notnull_flags_every_row(self):
        """B1: 整列全 NaN × NotNull → 每行违规（空值是 NotNull 的职责）。"""
        from app.shared.domain.constraints.not_null import NotNullConstraint

        constraint = NotNullConstraint(table="t", column="v")
        datasets = {"t": pd.DataFrame({"v": [None, None, None]})}
        errors = constraint.validate(datasets)["errors"]
        assert len(errors) == 3

    def test_b1_all_nan_column_range_exempts(self):
        """B1: float NaN 整列 × Range → 0 违规（缺失值豁免，§1.4 口径）。"""
        from app.shared.domain.constraints.range import RangeConstraint

        constraint = RangeConstraint(table="t", column="v", min_value=0, max_value=10)
        datasets = {"t": pd.DataFrame({"v": [float("nan"), float("nan")]})}
        errors = constraint.validate(datasets)["errors"]
        assert errors == []

    def test_b1_all_none_object_column_range_fails_fast(self):
        """B1: 全 None（object dtype）整列 × Range → ConstraintConfigError
        （fail-fast 设计：非数值列不隐式转换、不静默跳过）。"""
        from app.shared.domain.constraints.range import RangeConstraint

        constraint = RangeConstraint(table="t", column="v", min_value=0, max_value=10)
        datasets = {"t": pd.DataFrame({"v": [None, None]})}
        errors = constraint.validate(datasets)["errors"]
        assert len(errors) == 1
        assert errors[0]["error_type"] == "ConstraintConfigError"

    def test_b2_single_row_file_full_cycle(self, tmp_path):
        """B2: 单行数据文件 → 正常加载，约束正常执行。"""
        p = tmp_path / "single.csv"
        p.write_bytes(b"id,name\n1,only\n")
        df = _csv(p)
        assert len(df) == 1
        assert df.loc[0, "name"] == "only"

    def test_b3_finite_float_extremes_valid(self):
        """B3: 1e308/-1e308（float 有限极值）→ 类型层不误报。"""
        from app.shared.domain.data_types_parts.scalars import FloatType

        ft = FloatType()
        assert ft.validate(1e308)[0] is True
        assert ft.validate(-1e308)[0] is True

    def test_b3_overflow_to_inf_rejected(self):
        """B3: 1e309（解析溢出为 inf）→ 类型层拒绝。"""
        from app.shared.domain.data_types_parts.scalars import FloatType

        valid, _ = FloatType().validate(float("1e309"))
        assert valid is False

    def test_b3_beyond_int64_reported_in_column_path(self):
        """B3: 2^63（超 int64 上界）→ 向量化校验路径报精度损失
        （标量 validate() 无 int64 界定是既有设计；真实校验走 process_column）。"""
        from app.shared.domain.data_types_parts.scalars import IntegerType

        series = pd.Series([9223372036854775807, 9223372036854775808], name="v")
        _, errors = IntegerType().process_column(series, "v", nullable=True)
        # 2^63 精度损失必须报告（2^63-1 是 int64 上界本身，合法）
        assert any(e["row_index"] == 1 for e in errors)
