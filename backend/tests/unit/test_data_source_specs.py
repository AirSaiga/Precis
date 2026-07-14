"""
数据源规格模块单元测试

测试覆盖:
- DataSourceSpec 抽象基类行为
- FileSourceSpec 文件相关验证和方法
- FileValidationMixin 文件系统验证
- CSV/Excel/JSON/SQL 各具体 Spec 的字段、验证、方法
- 注册表功能 (register_source_spec, get_spec_class, create_spec)
"""

import os
from typing import ClassVar

import pytest
from pydantic import ValidationError

from app.shared.core.data_source.specs.base import (
    DataSourceSpec,
    create_spec,
    get_spec_class,
    register_source_spec,
)
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
from app.shared.core.data_source.specs.file_base import FileSourceSpec, FileValidationMixin
from app.shared.core.data_source.specs.json_source import JSONSourceSpec
from app.shared.core.data_source.specs.sql_source import SQLSourceSpec

# ============================================================================
# 辅助类
# ============================================================================


class _MinimalSpec(DataSourceSpec):
    """用于测试 DataSourceSpec 基类的最小具象类"""

    source_type: ClassVar[str] = "minimal"
    type: str = "minimal"

    def get_connection_key(self):
        return "minimal_key"

    def get_loader_class(self):
        return object


class _MinimalFileSpec(FileSourceSpec):
    """用于测试 FileSourceSpec 基类的最小具象类"""

    source_type: ClassVar[str] = "minimal_file"
    type: str = "minimal_file"

    def get_loader_class(self):
        return object


# ============================================================================
# DataSourceSpec 基类
# ============================================================================


class TestDataSourceSpecBase:
    def test_cannot_instantiate_abstract(self):
        """抽象基类不可直接实例化"""
        with pytest.raises(TypeError):
            DataSourceSpec(type="abstract")

    def test_type_mismatch_raises(self):
        """type 字段与 source_type 不一致时应抛错"""
        with pytest.raises(ValidationError) as exc_info:
            _MinimalSpec(type="wrong_type")
        assert "类型不匹配" in str(exc_info.value)

    def test_get_discriminator_value(self):
        """get_discriminator_value 返回 source_type"""
        spec = _MinimalSpec()
        assert spec.get_discriminator_value() == "minimal"

    def test_to_display_dict(self):
        """to_display_dict 包含基本字段"""
        spec = _MinimalSpec(name="Test", description="desc")
        d = spec.to_display_dict()
        assert d["type"] == "minimal"
        assert d["name"] == "Test"
        assert d["source_type"] == "minimal"

    def test_cache_and_timeout_defaults(self):
        """默认缓存和超时配置"""
        spec = _MinimalSpec()
        assert spec.cache_enabled is True
        assert spec.cache_ttl == 300
        assert spec.timeout_seconds == 30


# ============================================================================
# 注册表
# ============================================================================


class TestSourceSpecRegistry:
    def test_register_requires_source_type(self):
        """注册时必须定义 source_type"""

        class BadSpec:
            pass

        with pytest.raises(ValueError, match="必须定义 source_type"):
            register_source_spec(BadSpec)

    def test_register_rejects_abstract(self):
        """source_type 不能为 abstract"""

        class BadSpec(DataSourceSpec):
            source_type: ClassVar[str] = "abstract"
            type: str = "abstract"

        with pytest.raises(ValueError, match="不能为 'abstract'"):
            register_source_spec(BadSpec)

    def test_get_spec_class(self):
        """get_spec_class 返回已注册的类"""
        assert get_spec_class("csv") is CSVSourceSpec
        assert get_spec_class("excel") is ExcelSourceSpec
        assert get_spec_class("json") is JSONSourceSpec
        assert get_spec_class("sql") is SQLSourceSpec
        assert get_spec_class("nonexistent") is None

    def test_create_spec(self):
        """create_spec 根据字典创建对应实例"""
        spec = create_spec({"type": "csv", "path": "data.csv"})
        assert isinstance(spec, CSVSourceSpec)
        assert spec.path == "data.csv"

    def test_create_spec_missing_type(self):
        """缺少 type 字段时抛错"""
        with pytest.raises(ValueError, match="必须包含 'type' 字段"):
            create_spec({"path": "data.csv"})

    def test_create_spec_unknown_type(self):
        """未知类型时抛错"""
        with pytest.raises(ValueError, match="未知的数据源类型"):
            create_spec({"type": "unknown"})


# ============================================================================
# FileSourceSpec
# ============================================================================


class TestFileSourceSpec:
    def test_validate_path_empty(self):
        """空路径验证失败"""
        with pytest.raises(ValidationError) as exc_info:
            _MinimalFileSpec(path="")
        assert "文件路径不能为空" in str(exc_info.value)

    def test_validate_path_whitespace_only(self):
        """纯空白路径验证失败"""
        with pytest.raises(ValidationError):
            _MinimalFileSpec(path="   ")

    def test_validate_path_illegal_chars(self):
        """包含非法字符时验证失败"""
        for ch in '<>:"|?*':
            with pytest.raises(ValidationError) as exc_info:
                _MinimalFileSpec(path=f"data{ch}.csv")
            assert "非法字符" in str(exc_info.value)

    def test_validate_windows_absolute_path_allowed(self):
        """Windows 绝对路径盘符写法应被允许"""
        spec = _MinimalFileSpec(path=r"D:\data\users.csv", mode="absolute")
        assert spec.path == r"D:\data\users.csv"

    def test_validate_non_drive_colon_rejected(self):
        """非盘符场景的冒号仍应被拒绝"""
        with pytest.raises(ValidationError) as exc_info:
            _MinimalFileSpec(path="data:users.csv")
        assert "非法字符" in str(exc_info.value)

    def test_get_connection_key_absolute(self):
        """绝对模式返回原路径"""
        spec = _MinimalFileSpec(path="/data/file.csv", mode="absolute")
        assert spec.get_connection_key() == "/data/file.csv"

    def test_get_connection_key_relative(self):
        """相对模式返回解析后的绝对路径"""
        spec = _MinimalFileSpec(path="data/file.csv", mode="relative")
        assert os.path.isabs(spec.get_connection_key())

    def test_get_file_extension(self):
        """扩展名转小写"""
        spec = _MinimalFileSpec(path="data/File.CSV")
        assert spec.get_file_extension() == ".csv"
        spec2 = _MinimalFileSpec(path="data/file")
        assert spec2.get_file_extension() == ""

    def test_to_display_dict(self):
        """display_dict 包含文件相关字段"""
        spec = _MinimalFileSpec(path="data.csv", mode="relative", encoding="gbk")
        d = spec.to_display_dict()
        assert d["path"] == "data.csv"
        assert d["mode"] == "relative"
        assert d["encoding"] == "gbk"
        assert d["extension"] == ".csv"

    def test_invalid_mode(self):
        """mode 只能为 relative 或 absolute"""
        with pytest.raises(ValidationError):
            _MinimalFileSpec(path="data.csv", mode="invalid")

    def test_negative_header_row(self):
        """header_row 不能为负数"""
        with pytest.raises(ValidationError):
            _MinimalFileSpec(path="data.csv", header_row=-1)

    def test_negative_skip_rows(self):
        """skip_rows 不能为负数"""
        with pytest.raises(ValidationError):
            _MinimalFileSpec(path="data.csv", skip_rows=-1)

    def test_nrows_must_be_positive(self):
        """nrows 必须 >= 1"""
        with pytest.raises(ValidationError):
            _MinimalFileSpec(path="data.csv", nrows=0)

    def test_nrows_none_allowed(self):
        """nrows 为 None 表示全部"""
        spec = _MinimalFileSpec(path="data.csv", nrows=None)
        assert spec.nrows is None


# ============================================================================
# FileValidationMixin
# ============================================================================


class TestFileValidationMixin:
    def test_validate_file_exists_missing(self):
        """文件不存在返回错误信息"""
        mixin = FileValidationMixin()
        mixin.path = "non_existent_file_12345.txt"
        result = mixin.validate_file_exists()
        assert result is not None
        assert "文件不存在" in result

    def test_validate_file_exists_ok(self, tmp_path):
        """文件存在返回 None"""
        f = tmp_path / "exists.txt"
        f.write_text("hello")
        mixin = FileValidationMixin()
        mixin.path = str(f)
        assert mixin.validate_file_exists() is None

    def test_validate_file_readable_on_dir(self, tmp_path):
        """路径为目录时返回错误"""
        mixin = FileValidationMixin()
        mixin.path = str(tmp_path)
        result = mixin.validate_file_readable()
        assert result is not None
        assert "路径不是文件" in result

    def test_validate_file_size_normal(self, tmp_path):
        """小文件不返回警告"""
        f = tmp_path / "small.txt"
        f.write_text("hello")
        mixin = FileValidationMixin()
        mixin.path = str(f)
        assert mixin.validate_file_size(max_size_mb=500) is None

    def test_validate_file_size_too_large(self, tmp_path):
        """大文件返回警告"""
        f = tmp_path / "big.txt"
        f.write_text("x" * (1024 * 1024 * 2))  # 2 MB
        mixin = FileValidationMixin()
        mixin.path = str(f)
        result = mixin.validate_file_size(max_size_mb=1)
        assert result is not None
        assert "警告" in result

    def test_validate_file_size_missing_file(self, tmp_path):
        """文件不存在时 validate_file_size 返回 None"""
        mixin = FileValidationMixin()
        mixin.path = str(tmp_path / "missing.txt")
        assert mixin.validate_file_size() is None


# ============================================================================
# CSVSourceSpec
# ============================================================================


class TestCSVSourceSpec:
    def test_defaults(self):
        """默认值检查"""
        spec = CSVSourceSpec(path="data.csv")
        assert spec.delimiter == ","
        assert spec.quotechar == '"'
        assert spec.escapechar is None
        assert spec.encoding_detection is True
        assert spec.fallback_encodings == ["utf-8", "gbk", "latin1"]
        assert spec.on_bad_lines == "warn"

    def test_custom_values(self):
        """自定义值"""
        spec = CSVSourceSpec(
            path="data.csv",
            delimiter=";",
            quotechar="'",
            escapechar="\\",
            on_bad_lines="skip",
        )
        assert spec.delimiter == ";"
        assert spec.quotechar == "'"
        assert spec.escapechar == "\\"
        assert spec.on_bad_lines == "skip"

    def test_invalid_delimiter_empty(self):
        """分隔符不能为空字符串"""
        with pytest.raises(ValidationError):
            CSVSourceSpec(path="data.csv", delimiter="")

    def test_invalid_delimiter_long(self):
        """分隔符只能为单个字符"""
        with pytest.raises(ValidationError):
            CSVSourceSpec(path="data.csv", delimiter="||")

    def test_get_loader_class(self):
        """返回 CSVLoader"""
        spec = CSVSourceSpec(path="data.csv")
        loader_cls = spec.get_loader_class()
        assert loader_cls.__name__ == "CSVLoader"

    def test_to_display_dict(self):
        """display_dict 包含 CSV 特有字段"""
        spec = CSVSourceSpec(path="data.csv", delimiter=";")
        d = spec.to_display_dict()
        assert d["delimiter"] == "';'"
        assert d["encoding"] == "utf-8"
        assert d["type"] == "csv"


# ============================================================================
# ExcelSourceSpec
# ============================================================================


class TestExcelSourceSpec:
    def test_defaults(self):
        """默认值检查"""
        spec = ExcelSourceSpec(path="data.xlsx")
        assert spec.sheet is None
        assert spec.sheet_index == 0
        assert spec.engine == "openpyxl"
        assert spec.dtype_inference is True

    def test_get_connection_key_with_sheet_name(self):
        """指定 sheet 时连接键包含 sheet 名"""
        spec = ExcelSourceSpec(path="data.xlsx", sheet="Sheet1")
        key = spec.get_connection_key()
        assert "Sheet1" in key

    def test_get_connection_key_with_sheet_index(self):
        """未指定 sheet 时连接键使用 sheet_index"""
        spec = ExcelSourceSpec(path="data.xlsx")
        key = spec.get_connection_key()
        assert "sheet_0" in key

    def test_get_loader_class(self):
        """返回 ExcelLoader"""
        spec = ExcelSourceSpec(path="data.xlsx")
        loader_cls = spec.get_loader_class()
        assert loader_cls.__name__ == "ExcelLoader"

    def test_to_display_dict(self):
        """display_dict 包含 Excel 特有字段"""
        spec = ExcelSourceSpec(path="data.xlsx", sheet="Sheet2")
        d = spec.to_display_dict()
        assert d["sheet"] == "Sheet2"
        assert d["engine"] == "openpyxl"

    def test_invalid_engine(self):
        """engine 只能为 openpyxl 或 xlrd"""
        with pytest.raises(ValidationError):
            ExcelSourceSpec(path="data.xlsx", engine="invalid")


# ============================================================================
# JSONSourceSpec
# ============================================================================


class TestJSONSourceSpec:
    def test_defaults(self):
        """默认值检查"""
        spec = JSONSourceSpec(path="data.json")
        assert spec.format == "auto"
        assert spec.sep == "."
        assert spec.json_path is None
        assert spec.meta_prefix == "meta."
        assert spec.streaming_threshold_mb == 50.0
        assert spec.chunk_size == 10000

    def test_object_format_requires_json_path(self):
        """format=object 时必须提供 json_path"""
        with pytest.raises(ValidationError) as exc_info:
            JSONSourceSpec(path="data.json", format="object")
        assert "必须指定 json_path" in str(exc_info.value)

    def test_json_path_must_start_with_dollar_dot(self):
        """json_path 必须以 '$.' 开头"""
        with pytest.raises(ValidationError) as exc_info:
            JSONSourceSpec(path="data.json", format="object", json_path="data.items")
        assert "必须以 '$.'" in str(exc_info.value)

    def test_valid_object_format(self):
        """正确的 object 格式配置"""
        spec = JSONSourceSpec(
            path="data.json",
            format="object",
            json_path="$.data.items",
        )
        assert spec.json_path == "$.data.items"

    def test_get_loader_class(self):
        """返回 JSONLoader"""
        spec = JSONSourceSpec(path="data.json")
        loader_cls = spec.get_loader_class()
        assert loader_cls.__name__ == "JSONLoader"

    def test_to_display_dict(self):
        """display_dict 包含 JSON 特有字段"""
        spec = JSONSourceSpec(path="data.json", format="array", json_path="$.items")
        d = spec.to_display_dict()
        assert d["format"] == "array"
        assert d["json_path"] == "$.items"
        assert d["sep"] == "."

    def test_dtype_dict(self):
        """dtype 字段接受字典"""
        spec = JSONSourceSpec(path="data.json", dtype={"id": "str", "count": "int"})
        assert spec.dtype == {"id": "str", "count": "int"}


# ============================================================================
# SQLSourceSpec
# ============================================================================


class TestSQLSourceSpec:
    def test_defaults(self):
        """默认值检查"""
        spec = SQLSourceSpec(
            connection_string="sqlite:///test.db",
            table_or_query="users",
        )
        assert spec.batch_size == 1000
        assert spec.params is None
        assert spec.type == "sql"

    def test_get_connection_key(self):
        """连接键为 connection_string:table_or_query"""
        spec = SQLSourceSpec(
            connection_string="sqlite:///test.db",
            table_or_query="users",
        )
        assert spec.get_connection_key() == "sqlite:///test.db:users"

    def test_get_loader_class(self):
        """返回 SQLLoader"""
        spec = SQLSourceSpec(
            connection_string="sqlite:///test.db",
            table_or_query="users",
        )
        try:
            loader_cls = spec.get_loader_class()
            assert loader_cls.__name__ == "SQLLoader"
        except ImportError as e:
            pytest.skip(f"SQLLoader 暂不可用: {e}")

    def test_to_display_dict_hides_password(self):
        """to_display_dict 隐藏连接字符串中的密码"""
        spec = SQLSourceSpec(
            connection_string="postgresql://admin:secret@localhost/db",
            table_or_query="users",
        )
        d = spec.to_display_dict()
        assert "***" in d["connection"]
        assert "secret" not in d["connection"]
        assert d["table_or_query"] == "users"

    def test_to_display_dict_no_password(self):
        """无密码的连接字符串保持不变"""
        spec = SQLSourceSpec(
            connection_string="sqlite:///test.db",
            table_or_query="users",
        )
        d = spec.to_display_dict()
        assert d["connection"] == "sqlite:///test.db"

    def test_to_display_dict_with_params(self):
        """params 字段不影响显示"""
        spec = SQLSourceSpec(
            connection_string="sqlite:///test.db",
            table_or_query="SELECT * FROM t WHERE id = :id",
            params={"id": 1},
        )
        d = spec.to_display_dict()
        assert "params" not in d
