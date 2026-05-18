"""
@fileoverview 文件数据源基类模块

功能概述:
- 提供所有基于文件的数据源的抽象基类
- 封装文件路径、编码、表头等通用配置
- 实现路径验证（非空、非法字符检查）
- 提供相对/绝对路径的连接键生成

架构设计:
- 继承自 DataSourceSpec，扩展文件相关配置
- 子类覆盖 type 和 source_type 即可支持新文件格式
- field_validator 自动校验 path 字段合法性
- 与文件加载器（ExcelLoader、CSVLoader 等）配对使用
- FileValidationMixin 提供文件存在性、可读性、大小等通用验证

输入示例:
    spec = FileSourceSpec(
        path="data/users.csv",
        mode="relative",
        encoding="utf-8",
        header_enabled=True,
        header_row=0,
        skip_rows=0
    )

输出示例:
    key = spec.get_connection_key()   # 返回绝对路径字符串
    display = spec.to_display_dict()  # 返回可展示的字典
"""

from __future__ import annotations

from abc import ABC
from pathlib import Path
from typing import Any, ClassVar, Literal

from pydantic import Field, field_validator

from .base import DataSourceSpec


class FileSourceSpec(DataSourceSpec, ABC):
    """
    @classdesc 文件数据源基类

    所有基于文件的数据源（Excel、CSV、JSON 等）的基类。
    提供文件相关的通用配置和验证，子类只需覆盖 type 和 source_type 即可。

    属性:
        path: 文件路径（相对或绝对）
        mode: 路径模式，"relative" 表示相对于项目根目录，"absolute" 表示绝对路径
        encoding: 文件编码（默认 utf-8），常用于 CSV 和 JSON 文件
        header_enabled: 是否有表头行，True 表示第一行（或 header_row 指定行）是列名
        header_row: 表头行索引（从0开始），默认第0行
        skip_rows: 跳过的行数（表头前），用于跳过文件开头的说明行
        nrows: 读取的最大行数，None 表示读取全部数据

    示例:
        >>> spec = FileSourceSpec(path="data/users.csv", mode="relative")
        >>> spec.get_connection_key()  # 返回解析后的绝对路径
    """

    # 类级别的类型标识
    source_type: ClassVar[str] = "file"

    # 实例级别的类型字段（必须与 source_type 匹配）
    type: str = "file"  # 子类应覆盖此值

    # 文件相关配置
    path: str = Field(..., description="文件路径（相对或绝对）")
    mode: Literal["relative", "absolute"] = Field("relative", description="路径模式")
    encoding: str = Field("utf-8", description="文件编码")

    # 表头配置
    header_enabled: bool = Field(True, description="是否有表头行")
    header_row: int = Field(0, ge=0, description="表头行索引（从0开始）")

    # 数据范围配置
    skip_rows: int = Field(0, ge=0, description="跳过的行数（表头前）")
    nrows: int | None = Field(None, ge=1, description="读取的最大行数")

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        """
        @methoddesc 验证路径非空且不含非法字符

        这是 Pydantic 的字段验证器，在创建实例时自动执行。
        会去除首尾空白字符，并检查 Windows 非法字符。

        Args:
            v: 用户输入的路径字符串

        Returns:
            去除首尾空白后的路径字符串

        Raises:
            ValueError: 路径为空或包含 Windows 非法字符时抛出
        """
        # 检查路径是否为空或仅包含空白字符
        if not v or not v.strip():
            raise ValueError("文件路径不能为空")

        normalized_path = v.strip()

        # 检查非法字符。冒号需要单独处理，Windows 绝对路径盘符（如 D:\foo.csv）
        # 是合法输入，不能被通用非法字符规则误杀。
        illegal_chars = '<>"|?*'
        if any(c in normalized_path for c in illegal_chars):
            raise ValueError(f"文件路径包含非法字符: {illegal_chars}")

        colon_count = normalized_path.count(":")
        if colon_count:
            is_windows_absolute_path = (
                colon_count == 1
                and len(normalized_path) >= 3
                and normalized_path[0].isalpha()
                and normalized_path[1] == ":"
                and normalized_path[2] in ("\\", "/")
            )
            if not is_windows_absolute_path:
                raise ValueError("文件路径包含非法字符: :")

        # 去除首尾空白，避免因为空格导致文件找不到
        return normalized_path

    def get_connection_key(self) -> str:
        """
        @methoddesc 获取连接标识符

        对于文件数据源，使用绝对路径作为唯一标识。
        如果 mode 为 "relative"，会解析为绝对路径（基于当前工作目录）。

        Returns:
            文件的绝对路径字符串
        """
        # 如果已经是绝对路径，直接返回
        if self.mode == "absolute":
            return self.path

        # 相对路径需要解析为绝对路径
        # 注意：实际使用时需要基于项目根目录解析
        # Path.resolve() 会将相对路径转换为绝对路径，并解析 . 和 ..
        return str(Path(self.path).resolve())

    def get_file_extension(self) -> str:
        """
        @methoddesc 获取文件扩展名（小写）

        用于根据扩展名判断文件类型，或验证文件格式是否符合预期。

        Returns:
            小写的文件扩展名，如 ".csv"、".xlsx"、".json"
        """
        return Path(self.path).suffix.lower()

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典

        在基类的基础上增加文件相关的展示字段，方便前端显示文件信息。

        Returns:
            包含 type、name、path、mode、encoding、extension 等字段的字典
        """
        return {
            **super().to_display_dict(),  # 复用基类的通用字段
            "path": self.path,
            "mode": self.mode,
            "encoding": self.encoding,
            "extension": self.get_file_extension(),
        }


class FileValidationMixin:
    """
    @classdesc 文件验证混入类

    提供文件数据源通用的验证方法，如检查文件是否存在、是否可读、文件大小等。
    可以通过多重继承混入到具体的 Spec 类中使用。
    所有方法返回 str | None：如果验证通过返回 None，失败返回错误信息字符串。
    """

    def validate_file_exists(self) -> str | None:
        """
        @methoddesc 验证文件是否存在

        Returns:
            如果文件不存在返回错误信息，否则返回 None
        """
        path = Path(self.path)
        if not path.exists():
            return f"文件不存在: {self.path}"
        return None

    def validate_file_readable(self) -> str | None:
        """
        @methoddesc 验证文件是否可读

        先检查路径是否存在且是文件（而非目录），
        实际的读取权限测试在数据加载时进行。

        Returns:
            如果路径不是文件返回错误信息，否则返回 None
        """
        path = Path(self.path)
        # 检查路径存在但不是文件（可能是目录）
        if path.exists() and not path.is_file():
            return f"路径不是文件: {self.path}"
        # 实际读取测试在加载时进行（避免在这里做 I/O 操作影响性能）
        return None

    def validate_file_size(self, max_size_mb: float = 500) -> str | None:
        """
        @methoddesc 验证文件大小

        检查文件是否超过指定大小，用于提前预警大文件可能导致加载缓慢。

        Args:
            max_size_mb: 最大允许大小（MB），默认 500MB

        Returns:
            警告信息（如果文件过大），或 None（如果正常或文件不存在）
        """
        path = Path(self.path)
        # 如果文件不存在，跳过大小检查（存在性检查由 validate_file_exists 负责）
        if not path.exists():
            return None

        # 计算文件大小（MB），1 MB = 1024 * 1024 字节
        size_mb = path.stat().st_size / (1024 * 1024)
        if size_mb > max_size_mb:
            return f"警告: 文件较大 ({size_mb:.1f}MB)，加载可能较慢"
        return None
