"""
@fileoverview JSON 数据源加载器模块

功能概述:
- 加载 JSON / JSONL / NDJSON 文件为 pandas DataFrame
- 使用策略模式自动识别 JSON 格式（array / lines / object / auto）
- 支持 JSONPath 数据提取（B14: 空列表不再回退到原始未过滤数据）
- 支持 record_path 通过 pd.json_normalize 展开嵌套数组（B15）
- 加载后应用 dtype 转换（B17）
- 自动解析器支持递归查找列表元素（B18）
- JSON Lines 中非字典条目包装为 {"value": parsed}（B19）

架构设计:
- 继承 DataSourceLoader[JSONSourceSpec]，通过注册表自动发现
- 解析逻辑委托给 strategies/ 下的策略类（AutoDetectParser、LinesParser 等）
- 数据提取委托给 JSONPathExtractor
- 类型转换委托给 TypeConverter

输入示例:
    spec = JSONSourceSpec(
        path="data/users.json",
        format="auto",
        json_path="$.data.users",
        record_path="orders",
        dtype={"age": "int64"}
    )
    loader = JSONLoader(spec)

输出示例:
    df = loader.load()
    # 返回 pandas.DataFrame，JSONPath 和 record_path 已应用
    # 若 json_path 返回空列表则抛出 DataLoadError
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from ..specs.json_source import JSONSourceSpec
from .base import DataLoadError, DataSourceLoader
from .converter import TypeConverter
from .extractor import JSONPathExtractor
from .registry import register_loader
from .strategies import JSONParserStrategy, get_parser


@register_loader("json")
class JSONLoader(DataSourceLoader[JSONSourceSpec]):
    """
    @classdesc JSON 文件加载器

    ============================================================================
    功能说明
    ============================================================================
    使用策略模式加载和解析 JSON 文件，支持多种格式。
    核心职责是流程编排，实际解析逻辑委托给策略类和工具类。

    ============================================================================
    支持的 JSON 格式
    ============================================================================
    - 标准数组 (array): [{"a": 1}, {"a": 2}]
    - JSON Lines (lines): 每行一个 JSON 对象
    - 嵌套对象 (object): {"data": [{"a": 1}]}
    - 自动检测 (auto): 自动识别最佳格式

    ============================================================================
    架构设计
    ============================================================================
    加载流程：
    1. 读取文件内容
    2. 使用 ParserStrategy 解析
    3. 使用 JSONPathExtractor 提取数据
    4. 使用 TypeConverter 转换类型
    5. 转换为 DataFrame

    ============================================================================
    使用示例
    ============================================================================
    >>> from app.shared.core.data_source.loaders.json_loader import JSONLoader
    >>> from app.shared.core.data_source.specs.json_source import JSONSourceSpec
    >>>
    >>> spec = JSONSourceSpec(path="data/users.json", format="auto")
    >>> loader = JSONLoader(spec)
    >>> df = loader.load()
    """

    spec_class = JSONSourceSpec

    FORMAT_ARRAY = "array"
    FORMAT_LINES = "lines"
    FORMAT_OBJECT = "object"
    FORMAT_AUTO = "auto"

    def __init__(self, spec: JSONSourceSpec):
        """
        初始化 JSON 加载器

        Args:
            spec: JSON 数据源配置
        """
        super().__init__(spec)
        self._parser: JSONParserStrategy | None = None
        self._extractor = JSONPathExtractor()
        self._converter = TypeConverter()

    def load(self) -> pd.DataFrame:
        """
        @methoddesc 加载 JSON 文件并返回 DataFrame

        ============================================================================
        处理流程
        ============================================================================
        1. 读取文件内容
        2. 使用策略模式解析 JSON
        3. 应用 JSONPath 提取（如果配置了）
        4. 转换数据类型（如果配置了）
        5. 转换为 DataFrame 并扁平化

        Returns:
            加载的数据 DataFrame

        Raises:
            DataLoadError: 加载失败时抛出
        """
        try:
            content = self._read_file()

            parser = self._get_parser()
            records = parser.parse(content)

            if self.spec.json_path:
                extracted = self._extractor.extract(records, self.spec.json_path)
                # B14 修复：空列表是合法结果，不应回退到原始未过滤数据。
                # 但如果 records 已被 parser 提取为字典列表（如 ObjectParser），
                # 再次 json_path 提取会失败为空；此时保持已提取的 records。
                if isinstance(extracted, list):
                    if extracted:
                        records = extracted
                    elif isinstance(records, list) and records and all(isinstance(r, dict) for r in records):
                        # extracted 为空但 records 已是提取后的字典列表，保持原样
                        pass
                    else:
                        records = extracted
                else:
                    records = [extracted] if extracted is not None else []

            df = self._convert_to_dataframe(records)

            if self.spec.flatten and self._has_nested_structure(df):
                df = self._flatten_dataframe(df)

            # dtype 转换在扁平化之后执行，确保列名匹配（B17）
            dtype = getattr(self.spec, "dtype", None)
            if dtype:
                df = self._apply_dtype_to_dataframe(df, dtype)

            return df

        except FileNotFoundError as e:
            raise DataLoadError(f"文件不存在: {self.spec.path}", self.spec, e)
        except json.JSONDecodeError as e:
            raise DataLoadError(f"JSON 解析错误 (行 {e.lineno}, 列 {e.colno}): {e.msg}", self.spec, e)
        except DataLoadError:
            raise
        except Exception as e:
            raise DataLoadError(f"JSON 加载失败: {e}", self.spec, e)

    def _read_file(self) -> str:
        """
        @methoddesc 读取文件内容

        Returns:
            文件内容字符串
        """
        with open(self.spec.path, encoding=self.spec.encoding) as f:
            return f.read()

    def _get_parser(self) -> JSONParserStrategy:
        """
        @methoddesc 获取合适的 JSON 解析器

        根据配置选择或自动检测合适的解析策略。

        Returns:
            JSON 解析策略实例
        """
        if self._parser:
            return self._parser

        format_type = self.spec.format or self.FORMAT_AUTO
        self._parser = get_parser(format_type)
        return self._parser

    def _convert_to_dataframe(self, data: list[dict]) -> pd.DataFrame:
        """
        @methoddesc 将数据列表转换为 DataFrame

        Args:
            data: 数据字典列表

        Returns:
            DataFrame
        """
        if not data:
            return pd.DataFrame()

        standardized = []
        for record in data:
            if isinstance(record, dict):
                standardized.append(record)
            else:
                standardized.append({"value": record})

        # 支持 record_path 展开嵌套数组（B15）
        # 设计说明：record_path 统一由 pd.json_normalize 处理，不再需要预标准化步骤。
        # pd.json_normalize 的 record_path 参数会自动将嵌套数组展开为独立行，
        # 与之前的手动 _apply_record_path 逻辑等价，且更可靠。
        record_path = getattr(self.spec, "record_path", None)
        if record_path:
            meta_prefix = getattr(self.spec, "meta_prefix", "meta.")
            sep = getattr(self.spec, "sep", ".")
            df = pd.json_normalize(
                standardized,
                record_path=record_path,
                meta_prefix=meta_prefix,
                sep=sep,
            )
        else:
            df = pd.json_normalize(standardized)
        return df

    def _has_nested_structure(self, df: pd.DataFrame) -> bool:
        """
        @methoddesc 检查 DataFrame 是否包含嵌套结构

        Args:
            df: DataFrame

        Returns:
            是否存在嵌套结构
        """
        for col in df.columns:
            if df[col].dtype == "object":
                sample = df[col].dropna().head(100)
                for val in sample:
                    if isinstance(val, (dict, list)):
                        return True
        return False

    def _flatten_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        @methoddesc 扁平化 DataFrame 中的嵌套结构

        Args:
            df: 原始 DataFrame

        Returns:
            扁平化后的 DataFrame
        """
        if df.empty:
            return df

        records = df.to_dict("records")

        flat_df = pd.json_normalize(records, sep=self.spec.sep, max_level=self.spec.max_depth)

        return flat_df

    def validate(self) -> list[str]:
        """
        @methoddesc 验证 JSON 文件配置和文件本身。

        检查项：
        - 文件是否存在
        - 文件扩展名是否为 .json、.jsonl 或 .ndjson
        - 前 5 行是否为有效的 JSON 格式（仅 JSON Lines 文件）

        Returns:
            错误信息列表，空列表表示验证通过

        示例:
            >>> errors = loader.validate()
            >>> if errors:
            ...     print("验证失败:", errors)
        """
        errors = []
        path = Path(self.spec.path)

        if not path.exists():
            errors.append(f"文件不存在: {self.spec.path}")
            return errors

        if path.suffix.lower() not in [".json", ".jsonl", ".ndjson"]:
            errors.append(f"警告: 文件扩展名不是 .json/.jsonl/.ndjson: {path.suffix}")

        try:
            with open(path, encoding=self.spec.encoding) as f:
                for _ in range(5):
                    line = f.readline()
                    if not line:
                        break
                    if path.suffix.lower() in [".jsonl", ".ndjson"]:
                        json.loads(line.strip())
        except json.JSONDecodeError as e:
            errors.append(f"JSON 格式错误: {e.msg}")
        except Exception as e:
            errors.append(f"无法读取文件: {e}")

        return errors

    def _apply_dtype_to_dataframe(self, df: pd.DataFrame, dtype: dict[str, str]) -> pd.DataFrame:
        """@methoddesc 对 DataFrame 的指定列进行类型转换（B17）。"""
        if df.empty or not dtype:
            return df
        for col, type_str in dtype.items():
            if col in df.columns:
                df[col] = df[col].apply(lambda x: self._converter.convert_single(x, type_str))
        return df

    def get_schema(self) -> dict[str, str]:
        """
        @methoddesc 获取数据源的 schema

        Returns:
            列名到类型的映射
        """
        df = self.preview(nrows=100)
        return {col: str(dtype) for col, dtype in df.dtypes.items()}
