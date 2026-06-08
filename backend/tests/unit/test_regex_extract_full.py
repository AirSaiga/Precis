"""
@fileoverview _extract_derived_columns 全分支单元测试

覆盖 extractors.py 中所有未覆盖的分支路径：
源列不存在、schema 未定义、显式/隐式 Expr、flags 处理、
result_type 类型转换、extract_key 缺失、异常处理、raw_df 优先等。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock

import pandas as pd

from app.shared.services.validation.extractors import _extract_derived_columns

# ============================================================================
# 辅助函数：构造 mock ColumnSchema
# ============================================================================


def _make_extracted_column(name, source_column, extract_key, result_type=None):
    """构造 Extracted 类型的 mock 列"""
    col = MagicMock()
    col.name = name
    data_type = MagicMock()
    data_type.name = "Extracted"
    data_type.source_column = source_column
    data_type.extract_key = extract_key
    if result_type:
        data_type.result_type = result_type
    col.data_type = data_type
    return col


def _make_expr_column(name, pattern=None, flags="g", case_sensitive=True, registry=None):
    """构造 Expr 类型的 mock 列"""
    col = MagicMock()
    col.name = name
    if pattern is not None:
        # 显式 Expr：有 pattern 属性
        data_type = MagicMock()
        data_type.name = "Expr"
        data_type.pattern = pattern
        data_type.flags = flags
        data_type.case_sensitive = case_sensitive
        col.data_type = data_type
    elif registry is not None:
        # 隐式 Expr：有 registry，无 pattern
        data_type = MagicMock()
        data_type.name = "Expr"
        # 不设置 pattern 属性
        del data_type.pattern
        data_type.registry = registry
        col.data_type = data_type
    else:
        data_type = MagicMock()
        data_type.name = "Expr"
        del data_type.pattern
        col.data_type = data_type
    return col


def _make_string_column(name):
    """构造普通 String 类型的 mock 列"""
    col = MagicMock()
    col.name = name
    data_type = MagicMock()
    data_type.name = "Str"
    col.data_type = data_type
    return col


def _make_schema(tables_dict):
    """构造 mock DataSetSchema"""
    schema = MagicMock()
    schema.tables = {}
    for table_id, columns in tables_dict.items():
        table = MagicMock()
        table.columns = {col.name: col for col in columns}
        schema.tables[table_id] = table
    return schema


# ============================================================================
# _extract_derived_columns 测试
# ============================================================================


class TestExtractDerivedColumns:
    def test_source_column_not_in_dataframe(self):
        """源列不存在于 DataFrame 时追加错误"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "nonexistent", "key"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"existing": ["a"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 1
        assert "不存在于表" in str(errors[0]["message"])

    def test_source_column_not_in_schema(self):
        """源列存在于 DataFrame 但未在 schema 中定义时追加错误"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                ]
            }
        )
        # source_col 存在于 DataFrame 但不存在于 schema.tables.t1.columns
        parsed = {"t1": pd.DataFrame({"source_col": ["abc"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 1
        assert "未在 schema 中定义" in str(errors[0]["message"])

    def test_explicit_expr_with_pattern(self):
        """显式 Expr 类型（有 pattern 属性）正常提取"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>\d+)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["123", "456", "abc"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        # 匹配的行 should have values, 不匹配的应该是 NA
        assert "derived" in parsed["t1"].columns
        assert parsed["t1"]["derived"].tolist()[0] == "123"
        assert parsed["t1"]["derived"].tolist()[1] == "456"

    def test_implicit_expr_via_registry(self):
        """隐式 Expr 类型（有 registry，无 pattern）从 registry 查找"""
        pattern_obj = MagicMock()
        regex_obj = MagicMock()
        regex_obj.pattern = r"(?P<key>\d+)"
        regex_obj.groupindex = {"key": 1}
        pattern_obj.regex = regex_obj

        registry = MagicMock()
        registry._patterns = [pattern_obj]

        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", registry=registry),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["123", "456"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        assert "derived" in parsed["t1"].columns
        assert parsed["t1"]["derived"].tolist() == ["123", "456"]

    def test_no_regex_pattern(self):
        """源列没有绑定正则表达式时追加错误"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col"),  # 无 pattern 无 registry
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["abc"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 1
        assert "没有绑定正则表达式" in str(errors[0]["message"])

    def test_regex_flags_ignorecase(self):
        """IGNORECASE 标志组合"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>[a-z]+)", flags="i"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["HELLO", "world"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        assert parsed["t1"]["derived"].tolist() == ["HELLO", "world"]

    def test_regex_flags_multiline(self):
        """MULTILINE 标志"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>^\w+)", flags="m"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["abc\ndef"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        assert parsed["t1"]["derived"].tolist()[0] == "abc"

    def test_regex_flags_dotall(self):
        """DOTALL 标志"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>a.b)", flags="s"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["a\nb", "acb"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        assert parsed["t1"]["derived"].tolist() == ["a\nb", "acb"]

    def test_regex_flags_combined(self):
        """多标志组合 im"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>^[a-z]+)", flags="im", case_sensitive=True),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["HELLO", "world"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        # case_sensitive=True + "i" flag → 不区分大小写
        assert "HELLO" in parsed["t1"]["derived"].values

    def test_result_type_integer(self):
        """result_type=Integer 转换为 Int64"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key", result_type="Integer"),
                    _make_expr_column("source_col", pattern=r"(?P<key>\d+)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["123", "456"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].dtype.name == "Int64"
        assert parsed["t1"]["derived"].tolist() == [123, 456]

    def test_result_type_float(self):
        """result_type=Float 转换为 float"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key", result_type="Float"),
                    _make_expr_column("source_col", pattern=r"(?P<key>\d+\.?\d*)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["12.5", "3.14"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].dtype == float
        assert parsed["t1"]["derived"].tolist() == [12.5, 3.14]

    def test_result_type_boolean(self):
        """result_type=Boolean 转换为 boolean"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key", result_type="Boolean"),
                    _make_expr_column("source_col", pattern=r"(?P<key>true|false|1|0|yes|no)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["true", "false", "1", "0", "yes", "no", ""]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].dtype.name == "boolean"
        assert parsed["t1"]["derived"].tolist()[:3] == [True, False, True]

    def test_result_type_string(self):
        """result_type=String 时保持为 pandas StringDtype 或 object"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key", result_type="String"),
                    _make_expr_column("source_col", pattern=r"(?P<key>.+)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["hello", "world"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].tolist() == ["hello", "world"]

    def test_result_type_default_string(self):
        """无 result_type 时保持字符串"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),  # No result_type
                    _make_expr_column("source_col", pattern=r"(?P<key>.+)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["test"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].tolist() == ["test"]

    def test_extract_key_not_in_capture_group(self):
        """extract_key 不在正则捕获组中时追加配置错误"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "nonexistent_key"),
                    _make_expr_column("source_col", pattern=r"(?P<actual_key>\d+)"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["123"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 1
        assert "不在正则表达式的命名捕获组中" in str(errors[0]["message"])

    def test_exception_handling(self):
        """正则编译失败时不崩溃，静默跳过"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>\d+"),  # 未闭合的括号
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["123"]})}
        raw = {}
        errors = []
        # 不应抛出异常
        _extract_derived_columns(parsed, schema, raw, errors)
        # 不应有错误报告（异常分支静默跳过）
        assert len(errors) == 0

    def test_raw_datasets_preferred(self):
        """raw_datasets 有对应表时优先使用 raw_df（保留原始字符串格式）"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>.+)"),
                ]
            }
        )
        # raw 中有原始字符串
        raw = {"t1": pd.DataFrame({"source_col": ["raw_val"]})}
        parsed = {"t1": pd.DataFrame({"source_col": ["parsed_val"]})}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        # 应使用 raw 中的值
        assert parsed["t1"]["derived"].tolist() == ["raw_val"]

    def test_raw_datasets_fallback_to_parsed(self):
        """raw_datasets 中没有对应表时回退到 parsed df"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>.+)"),
                ]
            }
        )
        raw = {}  # 无 t1
        parsed = {"t1": pd.DataFrame({"source_col": ["parsed_val"]})}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert parsed["t1"]["derived"].tolist() == ["parsed_val"]

    def test_table_not_in_schema(self):
        """parsed_datasets 中的表未在 schema 中定义时跳过"""
        schema = _make_schema({})  # 空 schema
        parsed = {"t1": pd.DataFrame({"col": ["a"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0  # 应静默跳过

    def test_no_extracted_columns(self):
        """表中无 Extracted 类型列时跳过"""
        schema = _make_schema(
            {
                "t1": [
                    _make_string_column("name"),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"name": ["Alice"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0

    def test_case_sensitive_false(self):
        """case_sensitive=False 时不区分大小写"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>[a-z]+)", flags="g", case_sensitive=False),
                ]
            }
        )
        parsed = {"t1": pd.DataFrame({"source_col": ["HELLO"]})}
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert len(errors) == 0
        assert parsed["t1"]["derived"].tolist() == ["HELLO"]

    def test_multiple_tables_some_skipped(self):
        """多表场景，部分表被跳过"""
        schema = _make_schema(
            {
                "t1": [
                    _make_extracted_column("derived", "source_col", "key"),
                    _make_expr_column("source_col", pattern=r"(?P<key>\d+)"),
                ],
                # t2 在 schema 中但无 extracted 列
                "t2": [
                    _make_string_column("name"),
                ],
            }
        )
        parsed = {
            "t1": pd.DataFrame({"source_col": ["123"]}),
            "t2": pd.DataFrame({"name": ["Alice"]}),
        }
        raw = {}
        errors = []
        _extract_derived_columns(parsed, schema, raw, errors)
        assert "derived" in parsed["t1"].columns
        assert "derived" not in parsed["t2"].columns
