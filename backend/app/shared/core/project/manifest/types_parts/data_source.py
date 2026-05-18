"""
@fileoverview 数据源配置类型定义模块

功能概述:
- 定义项目数据源的引用结构
- 支持多数据源配置，便于扩展

架构设计:
- DataSourceRef: 单个数据源的引用定义
- 支持多种路径模式：相对路径、绝对路径

使用场景:
- 全量校验时，后端根据此配置自动查找数据文件
- 支持多数据源目录配置
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DataSourceRef(BaseModel):
    """@classdesc 数据源引用配置

    用于在 manifest.yaml 中定义数据源的位置。
    支持多种路径模式，方便项目迁移和共享。

    字段说明:
        - id: 数据源唯一标识符
        - path: 数据源目录路径
        - mode: 路径模式，'relative' 表示相对于项目目录，'absolute' 表示绝对路径
        - description: 数据源描述（可选）

    示例:
        # 相对路径模式（推荐，便于项目迁移）
        data_sources:
          - id: primary
            path: data
            mode: relative
            description: 主数据目录

        # 绝对路径模式
        data_sources:
          - id: external
            path: /mnt/data/external
            mode: absolute
            description: 外部数据源
    """

    id: str = Field(..., description="数据源唯一标识符")
    path: str = Field(..., description="数据源目录路径")
    mode: str = Field("relative", description="路径模式: 'relative' 或 'absolute'")
    description: str | None = Field(None, description="数据源描述（可选）")
