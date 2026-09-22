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
# WITHOUT WARRANTIES OR CONDITIONS OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""校验错误码（error_code/error_params）单元测试

i18n 治理：所有约束校验错误除中文 message 兜底外，还须携带稳定错误码与插值参数，
供前端按当前语言渲染（错误码 → validation.codes.<CODE> i18n key）。本测试守卫：
1. 各校验器错误 dict 均携带 error_code（UPPER_SNAKE）与 error_params（JSON 标量 dict）
2. 错误码经服务层适配器 / API 行模型透传不丢失
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from app.api.models.validation import ValidationErrorRow
from app.shared.domain.constraints.not_null import NotNullConstraint
from app.shared.domain.constraints.range import RangeConstraint
from app.shared.domain.constraints.unique import UniqueConstraint
from app.shared.services.validation.validators.adapter import ConstraintAdapter, PreCheck
from app.shared.services.validation.validators.base import BaseValidator


def _assert_error_carries_code(err: dict) -> None:
    """断言单条错误携带非空 error_code 与 dict 型 error_params，且 params JSON 可序列化"""
    assert isinstance(err.get("error_code"), str) and err["error_code"], f"error dict 缺少 error_code: {err}"
    assert err["error_code"] == err["error_code"].upper(), f"error_code 须为 UPPER_SNAKE: {err['error_code']}"
    params = err.get("error_params")
    assert isinstance(params, dict), f"error_params 须为 dict: {err}"
    # params 供 API JSON 输出，必须可序列化（数据值须已 str 化）
    json.dumps(params)


class TestDomainConstraintErrorCodes:
    """Domain Constraint 错误码守卫（以 Range/NotNull/Unique 为代表抽样）"""

    def test_range_config_error_carries_code(self):
        """非数值列配置错误：RANGE_COLUMN_NOT_NUMERIC + column 参数"""
        datasets = {"orders": pd.DataFrame({"total": ["1", "2", "3"]})}
        constraint = RangeConstraint(table="orders", column="total", min_value=0, max_value=100000)
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        err = result["errors"][0]
        _assert_error_carries_code(err)
        assert err["error_code"] == "RANGE_COLUMN_NOT_NUMERIC"
        assert err["error_params"]["column"] == "total"

    def test_range_row_violation_carries_code(self):
        """行级越界错误：RANGE_VALUE_OUT_OF_RANGE + value/bounds 参数"""
        datasets = {"products": pd.DataFrame({"price": [10, 150]})}
        constraint = RangeConstraint(
            table="products", column="price", min_value=0, max_value=100, boundary_mode="inclusive"
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        err = result["errors"][0]
        _assert_error_carries_code(err)
        assert err["error_code"] == "RANGE_VALUE_OUT_OF_RANGE"
        assert err["error_params"]["value"] == "150"
        assert "0" in err["error_params"]["bounds"] and "100" in err["error_params"]["bounds"]

    def test_range_missing_bounds_code(self):
        """未配置边界：RANGE_NO_BOUNDS"""
        datasets = {"products": pd.DataFrame({"price": [10]})}
        constraint = RangeConstraint(table="products", column="price")
        result = constraint.validate(datasets)

        assert result["errors"][0]["error_code"] == "RANGE_NO_BOUNDS"

    def test_not_null_row_error_carries_code(self):
        """非空行级错误：NOT_NULL_VALUE_EMPTY"""
        datasets = {"users": pd.DataFrame({"nickname": ["a", None]})}
        constraint = NotNullConstraint(table="users", column="nickname")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        err = result["errors"][0]
        _assert_error_carries_code(err)
        assert err["error_code"] == "NOT_NULL_VALUE_EMPTY"

    def test_unique_row_error_carries_code(self):
        """唯一性行级错误：UNIQUE_VALUE_DUPLICATED（重复两侧行均计入）"""
        datasets = {"users": pd.DataFrame({"email": ["a@x.com", "a@x.com"]})}
        constraint = UniqueConstraint(table="users", column="email")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 2
        err = result["errors"][0]
        _assert_error_carries_code(err)
        assert err["error_code"] == "UNIQUE_VALUE_DUPLICATED"


class TestServiceLayerErrorCodes:
    """服务层透传守卫：预检与错误格式化不丢失错误码"""

    def test_pre_check_column_exists_returns_structured_error(self):
        """预检列不存在：结构化错误（错误码 + 参数 + 兜底文案）"""
        df = pd.DataFrame({"a": [1]})
        check = PreCheck.column_exists()

        err = check(df, "missing", {})

        assert err is not None
        assert err["error_code"] == "COLUMN_NOT_FOUND"
        assert err["error_params"] == {"column": "missing"}
        assert "missing" in err["message"]

    def test_pre_check_param_required_returns_structured_error(self):
        """预检参数缺失：PARAM_REQUIRED + param 参数"""
        df = pd.DataFrame({"a": [1]})
        check = PreCheck.param_required("regex_pattern")

        err = check(df, "a", {})

        assert err is not None
        assert err["error_code"] == "PARAM_REQUIRED"
        assert err["error_params"] == {"param": "regex_pattern"}

    def test_adapter_pre_check_failure_propagates_code(self):
        """适配器预检失败路径：error_code 进入 error_rows"""

        class _MinimalValidator(BaseValidator):
            def validate(self, df, column, **kwargs):  # pragma: no cover - 不应被调用
                raise AssertionError("pre-check 失败时不应执行 validate")

        validator = ConstraintAdapter(
            _MinimalValidator.__mro__[1],  # 占位，不实际使用
            column_param="column",
            pre_checks=[PreCheck.column_exists()],
        )
        result = validator.validate(pd.DataFrame({"a": [1]}), "missing")

        assert result.is_valid is False
        assert len(result.error_rows) == 1
        assert result.error_rows[0]["error_code"] == "COLUMN_NOT_FOUND"

    def test_format_errors_forwards_error_code(self):
        """_format_errors 透传 error_code/error_params"""
        errors = [
            {
                "row_index": 2,
                "value": "x",
                "message": "兜底文案",
                "error_code": "SOME_VIOLATION",
                "error_params": {"value": "x", "column": "c"},
            }
        ]
        result = BaseValidator._format_errors(errors, total_rows=10, validation_time=0.01)

        assert result.error_rows[0]["error_code"] == "SOME_VIOLATION"
        assert result.error_rows[0]["error_params"] == {"value": "x", "column": "c"}


class TestApiModelErrorCodes:
    """API 行模型：error_code/error_params 为可选新增字段（契约向后兼容）"""

    def test_error_row_accepts_code_and_params(self):
        row = ValidationErrorRow(
            row_index=0,
            cell_value="x",
            error_message="兜底",
            error_code="RANGE_COLUMN_NOT_NUMERIC",
            error_params={"column": "total"},
        )
        assert row.error_code == "RANGE_COLUMN_NOT_NUMERIC"
        assert row.error_params == {"column": "total"}

    def test_error_row_code_optional(self):
        """缺省 None：旧调用方/旧数据不受影响"""
        row = ValidationErrorRow(row_index=0, cell_value="x", error_message="m")
        assert row.error_code is None
        assert row.error_params is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
