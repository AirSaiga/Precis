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
"""@fileoverview 类型层格式校验错误码单元测试

两阶段流水线第一阶段的类型校验（data_types_parts）与缺列检查（data_engine）
此前的错误只有中文 error_message、无 error_code/error_params——英文渲染链
（messages_en）与 JSON 契约三字段均消费不到。本文件守卫：
- 每类失败分支 emit 稳定错误码与插值参数
- 码可经 render_message_en 渲染为英文（模板占位符与 params 键一致）
- DecimalType 经 base 默认路径（validate_ex）同样带码，validate() 契约不变
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.domain.constraints.messages_en import render_message_en
from app.shared.domain.data_types import (
    BooleanType,
    DateType,
    DecimalType,
    FloatType,
    IntegerType,
    StringType,
)


def _first_error(errors: list[dict]) -> dict:
    """断言至少一条错误并返回首条（测试数据均只构造一个违规值）。"""
    assert errors, "应产生至少一条类型错误"
    return errors[0]


class TestScalarProcessColumnCodes:
    """向量化路径（各类型自有 process_column）的错误码"""

    def test_integer_format_invalid(self):
        _, errors = IntegerType().process_column(pd.Series(["12.5"]), "qty")
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_INT_FORMAT_INVALID"
        assert err["error_params"] == {"value": "12.5"}
        assert render_message_en(err["error_code"], err["error_params"]) is not None

    def test_integer_overflow(self):
        _, errors = IntegerType().process_column(pd.Series(["9007199254740993"]), "big")
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_INT_OVERFLOW"

    def test_float_invalid(self):
        _, errors = FloatType().process_column(pd.Series(["abc"]), "price")
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_FLOAT_INVALID"
        assert err["error_params"] == {"value": "abc"}

    def test_date_format_invalid(self):
        _, errors = DateType().process_column(pd.Series(["2026-06-32"]), "order_date")
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_DATE_FORMAT_INVALID"
        assert err["error_params"] == {"value": "2026-06-32"}
        en = render_message_en(err["error_code"], err["error_params"])
        assert en == "Value '2026-06-32' is not a valid date (expected format YYYY-MM-DD)."

    def test_bool_invalid(self):
        _, errors = BooleanType().process_column(pd.Series(["maybe"]), "flag")
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_BOOL_INVALID"

    @pytest.mark.parametrize("dtype_factory", [IntegerType, StringType, FloatType, BooleanType, DateType])
    def test_nullable_violation_coded(self, dtype_factory):
        """schema 层 nullable=False 的空值违规统一 TYPE_NULL_NOT_ALLOWED（各类型向量化路径）。"""
        _, errors = dtype_factory().process_column(pd.Series([None]), "col", nullable=False)
        err = _first_error(errors)
        assert err["error_type"] == "NotNullViolation"
        assert err["error_code"] == "TYPE_NULL_NOT_ALLOWED"
        assert err["error_params"] == {"column": "col"}


class TestDecimalViaBaseDefaultPath:
    """DecimalType 无向量化覆写，走 base.process_column 默认路径（validate_ex）"""

    def _run(self, dtype: DecimalType, value) -> dict:
        _, errors = dtype.process_column(pd.Series([value]), "amount")
        return _first_error(errors)

    def test_invalid_value(self):
        err = self._run(DecimalType(), "abc")
        assert err["error_code"] == "TYPE_DECIMAL_INVALID"
        assert err["error_params"] == {"value": "abc"}

    def test_not_finite(self):
        err = self._run(DecimalType(), "NaN")
        assert err["error_code"] == "TYPE_DECIMAL_NOT_FINITE"

    def test_precision_exceeded(self):
        err = self._run(DecimalType(precision=3), "12345")
        assert err["error_code"] == "TYPE_DECIMAL_PRECISION"
        assert err["error_params"] == {"value": "12345", "precision": 3}
        assert render_message_en(err["error_code"], err["error_params"]) is not None

    def test_scale_exceeded(self):
        err = self._run(DecimalType(scale=1), "1.23")
        assert err["error_code"] == "TYPE_DECIMAL_SCALE"
        assert err["error_params"] == {"value": "1.23", "scale": 1}

    def test_nullable_via_base_branch(self):
        """base 默认路径分支 1（NotNullViolation）同样带码。"""
        _, errors = DecimalType().process_column(pd.Series([None]), "amount", nullable=False)
        err = _first_error(errors)
        assert err["error_code"] == "TYPE_NULL_NOT_ALLOWED"

    def test_validate_contract_unchanged(self):
        """validate() 二元组契约不变（既有调用方零破坏），消息与 validate_ex 同源。"""
        ok, msg = DecimalType().validate("abc")
        assert ok is False and "不是一个有效的数值" in msg
        ok, msg = DecimalType().validate("1.5")
        assert ok is True and msg is None


class TestMissingColumnCode:
    """data_engine 缺列检查（_process_columns_recursive）的错误码"""

    def test_missing_column_coded(self):
        from app.shared.domain.data_engine import process_dataframe
        from app.shared.domain.dataset_schema import ColumnSchema, TableSchema

        schema = TableSchema(
            name="orders",
            columns=[ColumnSchema(name="qty", data_type=IntegerType(), nullable=True)],
        )
        # DataFrame 缺少 qty 列 → MissingColumn 带码
        _, errors = process_dataframe(pd.DataFrame({"other": [1]}), schema)
        err = _first_error(errors)
        assert err["error_type"] == "MissingColumn"
        assert err["error_code"] == "SCHEMA_COLUMN_MISSING"
        assert err["error_params"] == {"column": "qty"}


class TestAllTypeCodesRenderInEnglish:
    """全部类型层错误码可渲染英文（模板占位符与 emit params 键一致）"""

    def test_every_code_renders(self):
        cases = [
            ("TYPE_NULL_NOT_ALLOWED", {"column": "c"}),
            ("TYPE_INT_FORMAT_INVALID", {"value": "x"}),
            ("TYPE_INT_OVERFLOW", {"value": "x"}),
            ("TYPE_FLOAT_INVALID", {"value": "x"}),
            ("TYPE_DECIMAL_INVALID", {"value": "x"}),
            ("TYPE_DECIMAL_NOT_FINITE", {"value": "x"}),
            ("TYPE_DECIMAL_PRECISION", {"value": "x", "precision": 3}),
            ("TYPE_DECIMAL_SCALE", {"value": "x", "scale": 1}),
            ("TYPE_DATE_FORMAT_INVALID", {"value": "x"}),
            ("TYPE_BOOL_INVALID", {"value": "x"}),
            ("SCHEMA_COLUMN_MISSING", {"column": "c"}),
        ]
        for code, params in cases:
            rendered = render_message_en(code, params)
            assert rendered is not None, f"{code} 应有英文模板且可渲染"
