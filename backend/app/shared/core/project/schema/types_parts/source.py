"""
@fileoverview 数据源类型定义模块

功能概述:
- 定义 Schema 中的数据源结构 (SourceSpec)
- 指定数据文件的路径和工作表信息
- 支持多种数据源格式：Excel、CSV、JSON 等
- 格式选项通过 FormatOptions 联合类型实现

架构设计:
- 路径模式: 支持相对路径和绝对路径
- Excel 支持: 可指定工作表名和表头行
- 格式选项: 通过 FormatOptions 联合类型支持不同格式的特定配置

输入示例 (schema.yaml):
    # Excel 数据源
    source:
      mode: relative_file
      path: data/users.xlsx
      sheet: Sheet1
      header_row: 0

    # JSON 数据源
    source:
      mode: relative_file
      path: data/users.json
      options:
        format: auto

    # 嵌套 JSON 数据源
    source:
      mode: relative_file
      path: data/api_response.json
      options:
        format: object
        json_path: "$.data.items"
        sep: "."

    # CSV 数据源
    source:
      mode: relative_file
      path: data/users.csv
      options:
        delimiter: ","
        encoding: utf-8

输出示例:
    SourceSpec(
        mode="relative_file",
        path="data/users.xlsx",
        sheet="Sheet1",
        header_row=0,
        options=ExcelOptions()
    )

原理说明:
    为什么需要 mode 字段?
    - relative_file: 便于项目迁移，路径相对于项目根目录
    - absolute_file: 用于共享数据源，多个项目共享同一文件

    为什么需要 options 字段?
    - 将格式特定配置分离到独立的对象中
    - 提高类型安全性，避免 JSON 配置污染 CSV/Excel schema
    - 便于扩展新格式的支持
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.shared.core.utils.path_utils import normalize_to_posix

from .source_options import (
    FormatOptions,
)


class SourceSpec(BaseModel):
    """@classdesc 数据源规范

    指定 Schema 对应的数据文件位置。

    字段说明:
        - mode: 路径模式
            - relative_file: 相对于项目根目录
            - absolute_file: 绝对路径
        - path: 文件路径
        - sheet: Excel 工作表名 (可选，仅 Excel 文件需要)
        - header_row: 表头行索引 (默认 0，即第一行)
        - options: 格式特定配置（JSONOptions/CSVOptions/ExcelOptions）

    输入示例 (schema.yaml):
        # Excel 数据源
        source:
          mode: relative_file
          path: data/users.xlsx
          sheet: Sheet1
          header_row: 0

        # JSON 数据源
        source:
          mode: relative_file
          path: data/users.json
          options:
            format: auto

        # 嵌套 JSON 数据源
        source:
          mode: relative_file
          path: data/api_response.json
          options:
            format: object
            json_path: "$.data.items"
            sep: "."

        # CSV 数据源
        source:
          mode: relative_file
          path: data/users.csv
          options:
            delimiter: ","
            encoding: utf-8

    输出示例:
        SourceSpec(
            mode="relative_file",
            path="data/users.xlsx",
            sheet="Sheet1",
            header_row=0,
            options=ExcelOptions()
        )
    """

    mode: Literal["relative_file", "absolute_file"] = Field(..., description="数据源模式")
    path: str = Field(..., description="文件路径（相对/绝对取决于 mode）")
    sheet: str | None = Field(None, description="Excel 工作表名称")
    header_row: int = Field(0, ge=0, description="表头行索引（与 pandas header 语义一致）")

    options: FormatOptions | None = Field(None, description="格式特定配置（JSONOptions/CSVOptions/ExcelOptions）")

    @field_validator("path")
    @classmethod
    def normalize_path(cls, v: str) -> str:
        r"""
        @methoddesc 标准化路径，将反斜杠转换为正斜杠

        不同操作系统使用不同的路径分隔符：
        - Windows 使用反斜杠（\）
        - Linux/macOS 使用正斜杠（/）

        为了保证跨平台一致性，统一将反斜杠替换为正斜杠。

        参数说明:
            :param v: 原始路径字符串
            :return: 标准化后的路径字符串

        示例:
            >>> normalize_path(r"data\myfile.xlsx")
            'data/myfile.xlsx'
        """
        return normalize_to_posix(v)

    def is_json(self) -> bool:
        """@methoddesc 判断数据源是否为 JSON 格式

        通过检查文件路径的后缀名来判断是否为 JSON 文件。
        支持的 JSON 扩展名包括：.json、.jsonl（JSON Lines）、.ndjson（Newline Delimited JSON）

        返回:
            True 表示是 JSON 格式，False 表示不是

        示例:
            >>> spec = SourceSpec(mode="relative_file", path="data/users.json")
            >>> spec.is_json()
            True
            >>> spec = SourceSpec(mode="relative_file", path="data/users.csv")
            >>> spec.is_json()
            False
        """
        return self.path.lower().endswith((".json", ".jsonl", ".ndjson"))

    def get_file_extension(self) -> str:
        """@methoddesc 获取文件扩展名（小写）

        从文件路径中提取扩展名部分，用于判断文件格式。

        返回:
            小写的文件扩展名（不含点号），如果路径中没有扩展名则返回空字符串

        示例:
            >>> spec = SourceSpec(mode="relative_file", path="data/users.xlsx")
            >>> spec.get_file_extension()
            'xlsx'
            >>> spec = SourceSpec(mode="relative_file", path="data/users")
            >>> spec.get_file_extension()
            ''
        """
        return self.path.split(".")[-1].lower() if "." in self.path else ""

    def to_loader_config(self) -> dict[str, Any]:
        """@methoddesc 转换为数据加载器配置字典

        将 SourceSpec 对象转换为底层数据加载器可识别的配置字典。
        加载器使用这些参数来读取和解析数据文件。

        处理流程：
        1. 构建基础配置（路径、模式、编码、表头行）
        2. 如果存在格式特定选项（options），将其配置合并到基础配置中
        3. 返回完整的加载器配置字典

        返回:
            加载器配置字典，包含以下键：
            - path: 文件路径
            - mode: 路径模式（"relative" 或 "absolute"）
            - encoding: 文件编码
            - header_row: 表头行索引
            - 以及 format options 中的其他配置项

        示例:
            >>> spec = SourceSpec(mode="relative_file", path="data/users.csv")
            >>> spec.to_loader_config()
            {'path': 'data/users.csv', 'mode': 'relative', 'encoding': 'utf-8', 'header_row': 0}
        """
        # 构建基础配置字典
        config = {
            "path": self.path,
            # 将 mode 转换为加载器使用的格式
            "mode": "relative" if self.mode == "relative_file" else "absolute",
            "encoding": "utf-8",
            "header_row": self.header_row,
        }

        # 如果存在格式特定选项，合并到配置中
        # 例如 CSVOptions 会添加 delimiter、quotechar 等配置
        if self.options:
            config.update(self.options.to_loader_config())

        return config
