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
"""@fileoverview schema 推断服务单元测试（P2-2 headless infer_schema）

覆盖：6 种类型推断、混合类型回退、空列默认、CSV/Excel/JSON/JSONL 输入、
ID/名称/源路径覆盖、错误路径（文件不存在/扩展名不支持）。
"""

from __future__ import annotations

import json

import pytest
import yaml

from app.shared.services.schema_inference import infer_column_type, infer_schema


class TestInferColumnType:
    """纯函数级类型判定"""

    def test_integer(self):
        assert infer_column_type(["1", "42", "-7"]) == "integer"

    def test_float_from_decimal_text(self):
        assert infer_column_type(["1.5", "2.0", "-0.25"]) == "float"

    def test_int_and_float_promotes_to_float(self):
        assert infer_column_type(["1", "2.5"]) == "float"

    def test_boolean_literals(self):
        assert infer_column_type(["true", "False", "TRUE"]) == "boolean"

    def test_iso_date(self):
        assert infer_column_type(["2026-06-01", "2025-12-31"]) == "date"

    def test_string(self):
        assert infer_column_type(["机械键盘", "USB-C 数据线"]) == "string"

    def test_mixed_types_fall_back_to_string(self):
        assert infer_column_type(["1", "2026-06-01", "abc"]) == "string"

    def test_dirty_minority_keeps_dominant_type(self):
        """少量脏值不拖垮整列：17 个合法日期 + 1 个非法日期 → 仍判 date。

        脏值正是校验阶段要报告的问题，推断阶段应采信主导类型。
        """
        values = ["2026-06-01"] * 17 + ["2026-06-32"]
        assert infer_column_type(values) == "date"

    def test_dirty_minority_numeric_keeps_integer(self):
        # 9/10 = 90% 数值，恰好达到采信阈值
        values = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "not-a-number"]
        assert infer_column_type(values) == "integer"

    def test_below_dominant_threshold_falls_back(self):
        """占比 2/3 不足 90% 阈值 → 保守回退 string。"""
        assert infer_column_type(["1", "2", "abc"]) == "string"

    def test_empty_column_defaults_to_string(self):
        assert infer_column_type([]) == "string"

    def test_nan_inf_text_not_float(self):
        # NaN/Inf 字面量不作为 float 证据，与其他值混合回退 string
        assert infer_column_type(["nan", "abc"]) == "string"

    def test_json_native_types(self):
        assert infer_column_type([1, 2, 3]) == "integer"
        assert infer_column_type([True, False]) == "boolean"
        assert infer_column_type([1.5, 2]) == "float"


class TestInferSchemaCsv:
    """CSV 输入的 schema 结构"""

    def test_csv_all_types_inferred(self, tmp_path):
        csv = tmp_path / "orders.csv"
        csv.write_text(
            "order_id,quantity,unit_price,paid,order_date,product\n"
            "ORD-0001,1,299.00,true,2026-06-01,机械键盘\n"
            "ORD-0002,2,89.50,false,2026-06-02,无线鼠标\n",
            encoding="utf-8",
        )
        schema = infer_schema(csv)

        assert schema["version"] == 2
        assert schema["name"] == "orders"
        assert schema["source"] == {"mode": "relative_file", "path": str(csv)}
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types == {
            "order_id": "string",
            "quantity": "integer",
            "unit_price": "float",
            "paid": "boolean",
            "order_date": "date",
            "product": "string",
        }
        # 列 id 与列名一致
        assert all(c["id"] == c["name"] for c in schema["columns"])

    def test_id_name_source_override(self, tmp_path):
        csv = tmp_path / "t.csv"
        csv.write_text("a\n1\n", encoding="utf-8")
        schema = infer_schema(
            csv, table_id="11111111-2222-4333-8444-555555555555", table_name="orders", source_path="../orders.csv"
        )

        assert schema["id"] == "11111111-2222-4333-8444-555555555555"
        assert schema["name"] == "orders"
        assert schema["source"]["path"] == "../orders.csv"

    def test_default_id_is_uuid_v4(self, tmp_path):
        csv = tmp_path / "t.csv"
        csv.write_text("a\n1\n", encoding="utf-8")
        schema = infer_schema(csv)
        # UUID v4 版本位为 4
        assert schema["id"].count("-") == 4
        parts = schema["id"].split("-")
        assert parts[2].startswith("4")

    def test_output_is_valid_yaml_roundtrip(self, tmp_path):
        csv = tmp_path / "t.csv"
        csv.write_text("a,b\n1,x\n", encoding="utf-8")
        schema = infer_schema(csv)
        text = yaml.safe_dump(schema, allow_unicode=True, sort_keys=False)
        assert yaml.safe_load(text) == schema

    def test_empty_column_inferred_as_string(self, tmp_path):
        csv = tmp_path / "t.csv"
        # remark 列全空（NaN）
        csv.write_text("a,remark\n1,\n2,\n", encoding="utf-8")
        schema = infer_schema(csv)
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types["remark"] == "string"


class TestInferSchemaOtherFormats:
    """Excel / JSON / JSONL 输入"""

    def test_excel_input(self, tmp_path):
        pytest.importorskip("openpyxl")
        import pandas as pd

        xlsx = tmp_path / "t.xlsx"
        pd.DataFrame({"a": ["1", "2"], "b": ["x", "y"]}).to_excel(xlsx, index=False)
        schema = infer_schema(xlsx)
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types == {"a": "integer", "b": "string"}

    def test_json_array_input(self, tmp_path):
        jf = tmp_path / "t.json"
        jf.write_text(
            json.dumps([{"id": 1, "score": 9.5, "ok": True, "day": "2026-06-01"}], ensure_ascii=False),
            encoding="utf-8",
        )
        schema = infer_schema(jf)
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types == {"id": "integer", "score": "float", "ok": "boolean", "day": "date"}

    def test_jsonl_input(self, tmp_path):
        jf = tmp_path / "t.jsonl"
        jf.write_text('{"a": 1}\n{"a": 2}\n', encoding="utf-8")
        schema = infer_schema(jf)
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types == {"a": "integer"}


class TestInferSchemaErrors:
    """错误路径"""

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(ValueError, match="不存在"):
            infer_schema(tmp_path / "no_such.csv")

    def test_unsupported_extension_raises(self, tmp_path):
        f = tmp_path / "t.txt"
        f.write_text("a\n", encoding="utf-8")
        with pytest.raises(ValueError, match="不支持的文件扩展名"):
            infer_schema(f)

    def test_header_only_file_raises(self, tmp_path):
        # 只有表头无数据行 → 无列可推断（pandas 读出全 NaN 列时按空列处理，
        # 完全空文件（0 字节）才触发无表头错误）
        f = tmp_path / "empty.csv"
        f.write_text("", encoding="utf-8")
        with pytest.raises(ValueError, match="无表头"):
            infer_schema(f)
