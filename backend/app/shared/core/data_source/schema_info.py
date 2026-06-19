"""
@fileoverview 数据源 Schema 信息 DTO

功能概述:
- 为 core 层数据加载器提供与 domain 解耦的最小 Schema 信息
- 仅包含加载数据文件所需的字段，避免 core.data_source.loader 直接依赖 domain.TableSchema

架构设计:
- 纯数据 DTO: 使用 dataclass，只读语义，无业务逻辑
- 上层服务负责将 domain.TableSchema 或 core.TableSchemaFile 转换为 DataSourceInfo
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class DataSourceInfo:
    """@classdesc 数据加载器使用的 Schema 信息 DTO

    字段说明:
        - schema_id: 表/Schema 的唯一标识，作为加载结果字典的键
        - name: 表名（可选，用于日志展示）
        - sheet_name: Excel 工作表名（可选）
        - header_row: 表头行索引，默认 0
        - source_config: 加载器相关配置（如 delimiter、encoding、format 等）
    """

    schema_id: str
    name: str | None = None
    sheet_name: str | None = None
    header_row: int = 0
    source_config: dict[str, Any] = field(default_factory=dict)
