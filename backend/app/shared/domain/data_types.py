"""
@fileoverview 数据类型统一导出模块

功能概述:
- 聚合导出所有领域数据类型（标量、复合、序列、表达式、提取类型等）
- 为校验引擎和 Schema 解析提供统一的数据类型入口

架构设计:
- 类型注册表驱动: 各类型继承自 DataType 基类
- 扁平化导出: 将分散在 data_types_parts 中的类型集中暴露

输入示例:
    from app.shared.domain.data_types import StringType, IntegerType, ExpressionType

输出示例:
    data_type = StringType()  # 或 IntegerType(), DateType() 等
"""

from __future__ import annotations

# 1. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType
from app.shared.domain.data_types_parts.composite import CompositeConditionType, SpecificCompositeConditionType
from app.shared.domain.data_types_parts.expression import ExpressionType, SpecificExpressionType
from app.shared.domain.data_types_parts.extracted import ExtractedType
from app.shared.domain.data_types_parts.scalars import (
    BooleanType,
    DateType,
    DecimalType,
    FloatType,
    IntegerType,
    StringType,
)
from app.shared.domain.data_types_parts.sequence import SequenceType

__all__ = [
    "BooleanType",
    "CompositeConditionType",
    "DataType",
    "DateType",
    "DecimalType",
    "ExpressionType",
    "ExtractedType",
    "FloatType",
    "IntegerType",
    "SequenceType",
    "SpecificCompositeConditionType",
    "SpecificExpressionType",
    "StringType",
]
