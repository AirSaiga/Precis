"""
@fileoverview 数据源路径解析器

功能概述:
- 解析 manifest 中配置的第一个数据源目录（绝对/相对路径）
- 根据 Schema source 定义解析文件路径
- 自动发现匹配表名的数据文件（按扩展名优先级搜索）
- 支持 Excel 多 sheet 场景的路径解析

架构设计:
- 单一职责模式: 只做路径解析，不涉及数据加载或校验
- 从 ValidationExecutor 中提取，独立为可复用组件

输入示例:
    resolver = DataSourceResolver(project_root, manifest, schema_by_id)
    data_dir = resolver.resolve_first_data_source()
    file_path, sheet = resolver.resolve_source_path(data_dir, schema_file)

输出示例:
    data_dir = "/path/to/data"
    file_path = "/path/to/data/users.xlsx"
    sheet = "Sheet1"
"""

import logging
import os
from typing import Optional

from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.core.utils.path_utils import normalize_to_posix

logger = logging.getLogger(__name__)


class DataSourceResolver:
    """
    @classdesc 数据源路径解析器

    负责：
    - 解析 manifest 中配置的第一个数据源目录
    - 根据 Schema source 定义解析文件路径（绝对/相对）
    - 自动发现匹配表名的数据文件（按扩展名优先级搜索）

    设计决策：
    - 从 ValidationExecutor 中提取，单一职责：只做路径解析，不涉及数据加载或校验
    """

    def __init__(
        self,
        project_root: str,
        manifest: ProjectManifestV2,
        schema_by_id: dict[str, TableSchemaFile],
    ):
        self.project_root = project_root
        self.manifest = manifest
        self._schema_by_id = schema_by_id

    def resolve_first_data_source(self) -> Optional[str]:
        """
        @methoddesc 解析 manifest 中配置的第一个数据源目录

        返回第一个数据源对应的绝对路径。支持绝对路径和相对路径两种模式。

        返回:
            数据源目录的绝对路径，未配置或不存在则返回 None
        """
        if not self.manifest.data_sources:
            return None

        ds = self.manifest.data_sources[0]

        if ds.mode == "absolute":
            # 绝对路径模式：直接使用配置的路径
            if os.path.isdir(ds.path):
                return os.path.normpath(ds.path)
            else:
                logger.warning(f"[DataSourceResolver] 数据源目录不存在（绝对路径）: {ds.path}")
                return None
        else:
            # 相对路径模式：基于项目根目录拼接
            relative_path = os.path.join(self.project_root, ds.path)
            if os.path.isdir(relative_path):
                return os.path.normpath(relative_path)
            else:
                logger.warning(f"[DataSourceResolver] 数据源目录不存在（相对路径）: {relative_path}")
                return None

    def resolve_source_path(
        self, data_directory: str, schema_file: TableSchemaFile
    ) -> tuple[Optional[str], Optional[str]]:
        """
        @methoddesc 根据 Schema 定义解析数据源文件路径

        按照以下优先级解析文件路径：
        1. Schema 中显式配置的 source 路径（绝对文件或相对文件）
        2. 自动发现：在数据目录中按表名搜索匹配的数据文件

        参数:
            data_directory: 数据文件搜索目录
            schema_file: 表 Schema 定义文件

        返回:
            (文件路径, Sheet 名称) 元组，未找到则返回 (None, None)
        """
        # 提取 Sheet 名称
        sheet_name = schema_file.sheet
        if not sheet_name and schema_file.source:
            sheet_name = schema_file.source.sheet

        # 优先级 1：Schema 显式配置了 source 路径
        if schema_file.source:
            src = schema_file.source
            if src.mode == "absolute_file":
                return src.path, sheet_name

            src_path = src.path
            src_path_abs = os.path.normpath(os.path.join(self.project_root, src_path))

            if os.path.isfile(src_path_abs):
                return src_path_abs, sheet_name

            # 处理路径中多余的项目目录前缀（如 data/users.xlsx 中的 data 部分）
            data_dir_basename = os.path.basename(self.project_root)
            src_path_parts = normalize_to_posix(src_path).split("/")
            if len(src_path_parts) > 1 and src_path_parts[0] == data_dir_basename:
                src_path_adjusted = "/".join(src_path_parts[1:])
                adjusted_path = os.path.normpath(os.path.join(self.project_root, src_path_adjusted))
                if os.path.isfile(adjusted_path):
                    return adjusted_path, sheet_name

            final_path = os.path.normpath(os.path.join(self.project_root, src_path))
            return final_path, sheet_name

        # 优先级 2：自动发现数据文件
        table_name = schema_file.name or schema_file.id

        # 如果指定了 Sheet 名称，说明是 Excel 文件，只搜索 Excel 扩展名
        if sheet_name:
            extensions = [".xlsx", ".xls"]
        else:
            extensions = [".xlsx", ".xls", ".csv", ".json", ".jsonl"]

        # 确定搜索目录，优先使用 manifest 中配置的数据源目录
        search_directory = data_directory
        first_data_source = self.resolve_first_data_source()
        if first_data_source:
            search_directory = first_data_source

        # 先在搜索目录根目录中查找
        for ext in extensions:
            file_path = os.path.join(search_directory, f"{table_name}{ext}")
            if os.path.isfile(file_path):
                return file_path, sheet_name

        # 递归搜索子目录，跳过常见非数据目录
        for root, dirs, files in os.walk(search_directory):
            dirs[:] = [
                d for d in dirs if not d.startswith(".") and d not in ["node_modules", "__pycache__", ".git", ".venv"]
            ]

            for ext in extensions:
                file_name = f"{table_name}{ext}"
                if file_name in files:
                    file_path = os.path.join(root, file_name)
                    return file_path, sheet_name

        return None, None
