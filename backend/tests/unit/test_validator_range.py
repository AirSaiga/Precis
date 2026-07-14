"""
RangeValidator (ConstraintAdapter 包装) 单元测试

测试通过 UnifiedValidationService 注册的 Range ConstraintAdapter，
覆盖 boundary_mode 参数、min/max 参数传递以及错误格式化。
"""

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestRangeValidator:
    def setup_method(self):
        self.validator = UnifiedValidationService.get_validator("range")

    def test_inclusive_pass(self):
        df = pd.DataFrame({"age": [10, 50, 100]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100, boundary_mode="inclusive")
        assert result.is_valid is True
        assert result.error_count == 0
        assert result.total_rows == 3

    def test_inclusive_fail(self):
        df = pd.DataFrame({"age": [-1, 50, 150]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100, boundary_mode="inclusive")
        assert result.is_valid is False
        assert result.error_count == 2
        assert result.total_rows == 3
        assert result.match_count == 1

    def test_exclusive_pass(self):
        df = pd.DataFrame({"age": [1, 50, 99]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100, boundary_mode="exclusive")
        assert result.is_valid is True

    def test_exclusive_fail_boundary(self):
        df = pd.DataFrame({"age": [0, 100]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100, boundary_mode="exclusive")
        assert result.is_valid is False
        assert result.error_count == 2

    def test_default_boundary_mode_is_inclusive(self):
        df = pd.DataFrame({"age": [0, 100]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100)
        assert result.is_valid is True

    def test_min_only(self):
        df = pd.DataFrame({"val": [5, 10]})
        result = self.validator.validate(df, "val", min_value=10)
        assert result.error_count == 1

    def test_max_only(self):
        df = pd.DataFrame({"val": [5, 15]})
        result = self.validator.validate(df, "val", max_value=10)
        assert result.error_count == 1

    def test_no_bounds(self):
        df = pd.DataFrame({"val": [1, 2, 3]})
        result = self.validator.validate(df, "val")
        assert result.is_valid is True

    def test_empty_dataframe(self):
        df = pd.DataFrame({"val": pd.Series([], dtype=float)})
        result = self.validator.validate(df, "val", min_value=0, max_value=100)
        assert result.is_valid is True
        assert result.total_rows == 0

    def test_error_format(self):
        df = pd.DataFrame({"age": [-5]})
        result = self.validator.validate(df, "age", min_value=0, max_value=100)
        assert len(result.error_rows) == 1
        err = result.error_rows[0]
        assert "row_index" in err
        assert "cell_value" in err
        assert "error_message" in err

    def test_all_values_out_of_range(self):
        df = pd.DataFrame({"x": [-10, -20, -30]})
        result = self.validator.validate(df, "x", min_value=0, max_value=100)
        assert result.is_valid is False
        assert result.error_count == 3
        assert result.match_count == 0
