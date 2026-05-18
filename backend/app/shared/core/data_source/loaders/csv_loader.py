"""
@fileoverview CSV 数据源加载器模块

功能概述:
- 加载标准 CSV 文件为 pandas DataFrame
- 自动检测文件编码（支持 fallback 编码列表）
- 使用 utf-8-sig 去除 UTF-8 BOM，防止第一列名损坏（B12）
- 空文件提前检查，给出清晰的 DataLoadError（B13）
- 支持自定义分隔符、引号字符、转义字符、跳行、限制行数

架构设计:
- 继承 DataSourceLoader[CSVSourceSpec]，通过注册表自动发现
- 编码解析由 _resolve_encoding() 完成（父类提供）
- 读取参数根据 spec 动态构建，未配置项不传入 pandas

输入示例:
    spec = CSVSourceSpec(
        path="data/users.csv",
        header_row=0,
        delimiter=",",
        encoding="auto",
        fallback_encodings=["gbk", "latin1"]
    )
    loader = CSVLoader(spec)

输出示例:
    df = loader.load()
    # 返回 pandas.DataFrame，列名已根据 header_row 解析
    # 若 header_enabled=False，列名自动生成为 col_0, col_1, ...
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..specs.csv_source import CSVSourceSpec
from .base import DataLoadError, DataSourceLoader
from .registry import register_loader


@register_loader("csv")
class CSVLoader(DataSourceLoader[CSVSourceSpec]):
    """
    @classdesc CSV 文件加载器

    支持标准 CSV 文件，提供自动编码检测功能。
    """

    spec_class = CSVSourceSpec

    def load(self) -> pd.DataFrame:
        """
        @methoddesc 加载 CSV 文件

        Returns:
            DataFrame

        Raises:
            DataLoadError: 加载失败时抛出
        """
        try:
            # 空文件提前检查，给出清晰错误（B13）
            path = Path(self.spec.path)
            if path.exists() and path.stat().st_size == 0:
                raise DataLoadError(f"CSV 文件为空: {self.spec.path}", self.spec)

            # 确定编码
            encoding = self._resolve_encoding()
            # 使用 utf-8-sig 自动去除 UTF-8 BOM，避免第一列名损坏（B12）
            if encoding == "utf-8":
                encoding = "utf-8-sig"

            # 构建读取参数
            read_kwargs = {
                "header": self.spec.header_row if self.spec.header_enabled else None,
                "encoding": encoding,
                "sep": self.spec.delimiter,
                "quotechar": self.spec.quotechar,
                "on_bad_lines": self.spec.on_bad_lines,
            }

            # 可选参数
            if self.spec.escapechar:
                read_kwargs["escapechar"] = self.spec.escapechar
            if self.spec.skip_rows > 0:
                read_kwargs["skiprows"] = self.spec.skip_rows
            if self.spec.nrows:
                read_kwargs["nrows"] = self.spec.nrows

            # 读取数据
            df = pd.read_csv(self.spec.path, **read_kwargs)

            # 如果没有表头，生成默认列名
            if not self.spec.header_enabled:
                df.columns = [f"col_{i}" for i in range(len(df.columns))]

            return df

        except FileNotFoundError as e:
            raise DataLoadError(f"文件不存在: {self.spec.path}", self.spec, e)
        except UnicodeDecodeError as e:
            raise DataLoadError(
                f"编码错误: 无法使用 {self.spec.encoding} 编码读取文件，尝试的编码: {self.spec.fallback_encodings}",
                self.spec,
                e,
            )
        except Exception as e:
            raise DataLoadError(f"CSV 加载失败: {e}", self.spec, e)

    def _resolve_encoding(self) -> str:
        """
        @methoddesc 确定文件编码

        如果启用自动检测，尝试多个编码；
        否则直接使用配置的编码。

        Returns:
            确定的编码名称

        Raises:
            UnicodeDecodeError: 所有编码都失败时抛出
        """
        if not self.spec.encoding_detection:
            return self.spec.encoding

        # 尝试的编码列表
        encodings = [self.spec.encoding] + [e for e in self.spec.fallback_encodings if e != self.spec.encoding]

        last_error = None

        for encoding in encodings:
            try:
                # 尝试读取前 64KB 来验证编码（B11）
                # 之前只读 2 行，ASCII 表头 + 非 ASCII 数据会导致检测通过但后续读取失败
                with open(self.spec.path, encoding=encoding) as f:
                    f.read(65536)
                return encoding
            except UnicodeDecodeError as e:
                last_error = e
                continue

        # 所有编码都失败
        if last_error:
            raise last_error

        return self.spec.encoding

    def validate(self) -> list[str]:
        """
        @methoddesc 验证 CSV 文件配置和文件本身。

        检查项：
        - 文件是否存在
        - 文件扩展名是否为 .csv（如果不是则发出警告）

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

        # 检查扩展名
        if path.suffix.lower() != ".csv":
            errors.append(f"警告: 文件扩展名不是 .csv: {path.suffix}")

        return errors
