"""
@fileoverview 数据类型基类测试（T48 覆盖补充）

覆盖目标:
- domain/data_types_parts/base.py: DataType.process_column
"""

import pandas as pd

from app.shared.domain.data_types import IntegerType, StringType


class TestProcessColumn:
    def test_basic_valid_values(self):
        """有效值应正确解析。"""
        s = pd.Series([1, 2, 3])
        t = IntegerType()
        parsed, errors = t.process_column(s, "id")
        assert len(errors) == 0
        assert list(parsed) == [1, 2, 3]

    def test_invalid_values(self):
        """无效值应产生错误。"""
        s = pd.Series([1, "abc", 3])
        t = IntegerType()
        parsed, errors = t.process_column(s, "id")
        assert len(errors) == 1
        assert errors[0]["error_type"] == "TypeValidationError"
        assert errors[0]["row_index"] == 1

    def test_nullable_true_with_none(self):
        """nullable=True 时 None 值应透传。"""
        s = pd.Series(["1", None, "3"], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id", nullable=True)
        assert len(errors) == 0
        assert pd.isna(parsed.iloc[1])

    def test_nullable_false_with_none(self):
        """nullable=False 时 None 值应产生 NotNullViolation。"""
        s = pd.Series(["1", None, "3"], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id", nullable=False)
        assert len(errors) == 1
        assert errors[0]["error_type"] == "NotNullViolation"
        assert errors[0]["row_index"] == 1

    def test_nullable_false_with_empty_string(self):
        """nullable=False 时空字符串应产生 NotNullViolation。"""
        s = pd.Series([1, "", 3])
        t = IntegerType()
        parsed, errors = t.process_column(s, "id", nullable=False)
        assert len(errors) == 1
        assert errors[0]["error_type"] == "NotNullViolation"

    def test_string_type(self):
        """StringType 应正确处理。"""
        s = pd.Series(["alice", "bob", "charlie"])
        t = StringType()
        parsed, errors = t.process_column(s, "name")
        assert len(errors) == 0
        assert list(parsed) == ["alice", "bob", "charlie"]

    def test_mixed_valid_invalid(self):
        """混合有效和无效值应正确处理。"""
        s = pd.Series(["123", "abc", "456", "xyz"], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id")
        assert len(errors) == 2
        assert parsed.iloc[0] == 123
        assert pd.isna(parsed.iloc[1])
        assert parsed.iloc[2] == 456
        assert pd.isna(parsed.iloc[3])

    def test_empty_series(self):
        """空 Series 应返回空结果。"""
        s = pd.Series([], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id")
        assert len(errors) == 0
        assert len(parsed) == 0

    def test_all_none_nullable_true(self):
        """全 None 值且 nullable=True 应无错误。"""
        s = pd.Series([None, None, None], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id", nullable=True)
        assert len(errors) == 0
        assert all(pd.isna(v) for v in parsed)

    def test_all_none_nullable_false(self):
        """全 None 值且 nullable=False 应全部报错。"""
        s = pd.Series([None, None, None], dtype=object)
        t = IntegerType()
        parsed, errors = t.process_column(s, "id", nullable=False)
        assert len(errors) == 3
