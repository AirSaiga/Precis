"""
@fileoverview 数据 Schema 统一导出入口模块

功能概述:
- 作为 dataset_schema 包的统一导出入口
- 聚合导出 schema/builder.py 中的类型构建器和注册表
- 聚合导出 schema/models.py 中的 Schema 模型类
- 降低外部调用方的导入成本，只需从一个入口导入所有 Schema 相关符号

架构设计:
- 代理导出模式: 实际实现已拆分为 builder.py 和 models.py
- 本模块仅做 re-export，无独立业务逻辑
- 保持向后兼容，避免导入路径变更

输入示例:
    from app.shared.domain.dataset_schema import DataSetSchema, TableSchema, ColumnSchema
    from app.shared.domain.dataset_schema import build_type_from_config, TYPE_REGISTRY

输出示例:
    # 可直接使用 ColumnSchema、TableSchema、DataSetSchema 等核心类型
    # 以及 build_type_from_config 工厂函数和 TYPE_REGISTRY 注册表
"""

# 1. 项目内部导入
from .schema.builder import (
    CONSTRAINT_REGISTRY,
    TYPE_REGISTRY,
    build_type_from_config,
)
from .schema.models import ColumnSchema, DataSetSchema, TableSchema

__all__ = [
    "ColumnSchema",
    "TableSchema",
    "DataSetSchema",
    "build_type_from_config",
    "TYPE_REGISTRY",
    "CONSTRAINT_REGISTRY",
]
