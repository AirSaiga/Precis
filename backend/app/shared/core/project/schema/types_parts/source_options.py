"""
@fileoverview 数据源格式选项模块

功能概述:
- 定义不同数据源格式的特定配置选项
- 实现 FormatOptions 联合类型
- 支持 JSON、CSV、Excel 等格式的特定配置

架构设计:
- JSONOptions: JSON 格式配置（format, json_path, sep, dtype）
- CSVOptions: CSV 格式配置（delimiter, encoding, quote_char）
- ExcelOptions: Excel 格式配置（暂无特有选项）
- FormatOptions: 联合类型，通过 Union 实现多态

输入示例 (schema.yaml):
    # JSON 格式选项
    source:
      path: data/users.json
      options:
        format: auto
        json_path: "$.data.items"
        sep: "."

    # CSV 格式选项
    source:
      path: data/users.csv
      options:
        delimiter: ","
        encoding: utf-8
        skip_rows: 0

    # Excel 格式选项
    source:
      path: data/users.xlsx
      options:
        engine: openpyxl
        dtype_inference: true

输出示例:
    # JSON 格式选项
    JSONOptions(format="auto", json_path="$.data.items", sep=".")

    # CSV 格式选项
    CSVOptions(delimiter=",", encoding="utf-8", skip_rows=0)

    # Excel 格式选项
    ExcelOptions(engine="openpyxl", dtype_inference=True)

    # 联合类型使用
    SourceSpec(
        mode="relative_file",
        path="data/users.json",
        options=JSONOptions(format="array")
    )
"""

from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field


class JSONOptions(BaseModel):
    """@classdesc JSON 格式选项

    包含 JSON 数据源的特定配置。

    字段说明:
        - format: JSON 格式类型
            - auto: 自动检测
            - array: 对象数组格式
            - lines: JSON Lines 格式
            - object: 嵌套对象格式
        - json_path: JSONPath 提取路径
        - record_path: 要展平的路径
        - meta_prefix: 元数据字段前缀
        - sep: 嵌套对象展平时的分隔符
        - dtype: 列类型指定

    输入示例:
        options:
          format: object
          json_path: "$.data.items"
          sep: "."

    输出示例:
        JSONOptions(
            format="object",
            json_path="$.data.items",
            sep="."
        )
    """

    format: Literal["auto", "array", "lines", "object"] = Field(
        "auto", description="JSON 格式类型：auto-自动检测, array-对象数组, lines-JSON Lines, object-嵌套对象"
    )

    json_path: str | None = Field(None, description="JSONPath 提取路径，如 '$.data.items'（用于从嵌套对象提取数组）")

    record_path: str | None = Field(None, description="要展平的路径，如 'items'（用于数组字段）")

    meta_prefix: str = Field("meta.", description="元数据字段前缀")

    sep: str = Field(".", description="嵌套对象展平时的分隔符")

    dtype: dict[str, str] | None = Field(None, description="列类型指定，如 {'id': 'str', 'count': 'int'}")

    flatten: bool = Field(False, description="是否自动扁平化嵌套结构")

    def to_loader_config(self) -> dict[str, any]:
        """@methoddesc 转换为加载器配置字典

        将 JSONOptions 对象转换为数据加载器可识别的配置字典。
        加载器使用这些参数来正确解析 JSON 文件。

        返回:
            包含 type、format、json_path 等键的字典

        示例:
            >>> opts = JSONOptions(format="array", json_path="$.data")
            >>> opts.to_loader_config()
            {'type': 'json', 'format': 'array', 'json_path': '$.data', ...}
        """
        return {
            "type": "json",
            "format": self.format,
            "json_path": self.json_path,
            "record_path": self.record_path,
            "meta_prefix": self.meta_prefix,
            "sep": self.sep,
            "dtype": self.dtype,
            "flatten": self.flatten,
        }


class CSVOptions(BaseModel):
    """@classdesc CSV 格式选项

    包含 CSV 数据源的特定配置。

    字段说明:
        - delimiter: 字段分隔符（默认逗号）
        - quotechar: 引号字符（默认双引号）
        - escapechar: 转义字符
        - encoding: 文件编码（默认 utf-8）
        - skip_rows: 跳过的行数
        - on_bad_lines: 遇到坏行的处理方式

    输入示例:
        options:
          delimiter: ","
          encoding: utf-8
          skip_rows: 0

    输出示例:
        CSVOptions(
            delimiter=",",
            encoding="utf-8",
            skip_rows=0
        )
    """

    delimiter: str = Field(",", description="字段分隔符")

    quotechar: str = Field('"', description="引号字符")

    escapechar: str | None = Field(None, description="转义字符")

    encoding: str = Field("utf-8", description="文件编码")

    skip_rows: int = Field(0, ge=0, description="跳过的行数")

    on_bad_lines: Literal["error", "warn", "skip"] = Field("warn", description="遇到坏行的处理方式")

    def to_loader_config(self) -> dict[str, any]:
        """@methoddesc 转换为加载器配置字典

        将 CSVOptions 对象转换为数据加载器可识别的配置字典。
        加载器使用这些参数来正确解析 CSV 文件。

        返回:
            包含 type、delimiter、encoding 等键的字典

        示例:
            >>> opts = CSVOptions(delimiter=";", encoding="gbk")
            >>> opts.to_loader_config()
            {'type': 'csv', 'delimiter': ';', 'encoding': 'gbk', ...}
        """
        return {
            "type": "csv",
            "delimiter": self.delimiter,
            "quotechar": self.quotechar,
            "escapechar": self.escapechar,
            "encoding": self.encoding,
            "skip_rows": self.skip_rows,
            "on_bad_lines": self.on_bad_lines,
        }


class ExcelOptions(BaseModel):
    """@classdesc Excel 格式选项

    包含 Excel 数据源的特定配置。

    字段说明:
        - engine: 读取引擎（openpyxl 或 xlrd）
        - dtype_inference: 是否自动推断数据类型

    输入示例:
        options:
          engine: openpyxl
          dtype_inference: true

    输出示例:
        ExcelOptions(
            engine="openpyxl",
            dtype_inference=True
        )
    """

    engine: Literal["openpyxl", "xlrd"] = Field("openpyxl", description="读取引擎")

    dtype_inference: bool = Field(True, description="是否自动推断数据类型")

    def to_loader_config(self) -> dict[str, any]:
        """@methoddesc 转换为加载器配置字典

        将 ExcelOptions 对象转换为数据加载器可识别的配置字典。
        加载器使用这些参数来正确解析 Excel 文件。

        返回:
            包含 type、engine、dtype_inference 等键的字典

        示例:
            >>> opts = ExcelOptions(engine="openpyxl")
            >>> opts.to_loader_config()
            {'type': 'excel', 'engine': 'openpyxl', 'dtype_inference': True}
        """
        return {
            "type": "excel",
            "engine": self.engine,
            "dtype_inference": self.dtype_inference,
        }


# 格式选项联合类型
# 使用 Union 实现多态，支持不同格式的特定配置
# 这意味着一个变量可以是 JSONOptions、CSVOptions 或 ExcelOptions 中的任意一种
FormatOptions = Union[JSONOptions, CSVOptions, ExcelOptions]


def create_format_options(file_ext: str, options_dict: dict | None = None) -> FormatOptions | None:
    """@methoddesc 根据文件扩展名创建对应的格式选项对象

    本函数是格式选项的工厂方法，根据文件扩展名自动选择正确的选项类，
    并将配置字典转换为对应的 Pydantic 模型对象。

    参数说明:
        :param file_ext: 文件扩展名，支持以下格式：
            - ".json", ".jsonl", ".ndjson" -> JSONOptions
            - ".csv" -> CSVOptions
            - ".xlsx", ".xls" -> ExcelOptions
        :param options_dict: 选项配置字典（来自 schema.yaml 的 options 字段）
        :return: 对应格式的选项对象，如果扩展名不支持或 options_dict 为空则返回 None

    示例:
        >>> # 创建 JSON 选项
        >>> opts = create_format_options('.json', {'format': 'array', 'json_path': '$.data'})
        >>> type(opts).__name__
        'JSONOptions'

        >>> # 创建 CSV 选项
        >>> opts = create_format_options('.csv', {'delimiter': ';', 'encoding': 'gbk'})
        >>> type(opts).__name__
        'CSVOptions'

        >>> # 无配置时返回 None
        >>> opts = create_format_options('.json', None)
        >>> opts is None
        True
    """
    # 如果未提供配置字典，直接返回 None（表示使用默认配置）
    if not options_dict:
        return None

    # 将扩展名统一转为小写，保证大小写不敏感匹配
    ext = file_ext.lower()

    # 根据扩展名创建对应的格式选项对象
    # JSON 格式（包括标准 JSON、JSON Lines、Newline Delimited JSON）
    if ext in (".json", ".jsonl", ".ndjson"):
        return JSONOptions(**options_dict)
    # CSV 格式
    elif ext == ".csv":
        return CSVOptions(**options_dict)
    # Excel 格式（包括 .xlsx 和 .xls）
    elif ext in (".xlsx", ".xls"):
        return ExcelOptions(**options_dict)

    # 不支持的扩展名，返回 None
    return None


def get_options_type(options: FormatOptions | None) -> str:
    """@methoddesc 获取格式选项的类型名称

    用于调试和日志记录，快速判断一个 FormatOptions 对象具体是哪种类型。

    参数说明:
        :param options: 格式选项对象（JSONOptions / CSVOptions / ExcelOptions）
        :return: 类型名称字符串
            - "JSONOptions" - JSON 格式选项
            - "CSVOptions" - CSV 格式选项
            - "ExcelOptions" - Excel 格式选项
            - "None" - 空值

    示例:
        >>> get_options_type(JSONOptions(format="array"))
        'JSONOptions'
        >>> get_options_type(None)
        'None'
    """
    # 如果 options 为 None，直接返回 "None"
    if options is None:
        return "None"
    # 使用 Python 内置的 type() 函数获取对象的类名
    return type(options).__name__
