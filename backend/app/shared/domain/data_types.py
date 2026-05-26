"""
@fileoverview 数据类型统一导出模块

功能概述:
- 聚合导出所有领域数据类型（标量、复合、序列、表达式、提取类型等）
- 为校验引擎和 Schema 解析提供统一的数据类型入口
- 作为 app.shared.domain.data_types 包的门面（Facade），隐藏 data_types_parts 内部结构

架构设计:
- 类型注册表驱动: 各类型继承自 DataType 基类，通过统一的 process_column / validate / parse 接口工作
- 扁平化导出: 将分散在 data_types_parts 子目录中的类型集中暴露，降低调用方的认知负担
- 开闭原则: 新增数据类型时只需在对应子模块中实现，并在本模块重导出，不影响现有代码

类型分类说明:
- 标量类型 (scalars): StringType、IntegerType、DecimalType、FloatType、BooleanType、DateType
  用于表示单一值的基本数据类型，是最常用的类型。
- 复合类型 (composite): CompositeConditionType、SpecificCompositeConditionType
  用于表示由多个条件组合而成的复杂校验规则。
- 表达式类型 (expression): ExpressionType、SpecificExpressionType
  用于表示需要动态求值的表达式列，支持 JSON 展开。
- 提取类型 (extracted): ExtractedType
  用于表示从其他列派生计算得到的虚拟列，不存在于原始数据中。
- 序列类型 (sequence): SequenceType
  用于表示数组或列表类型的数据。

输入示例:
    >>> from app.shared.domain.data_types import StringType, IntegerType, ExpressionType
    >>> string_type = StringType()
    >>> int_type = IntegerType()

输出示例:
    >>> data_type = StringType()  # 或 IntegerType(), DateType() 等
    >>> parsed, errors = data_type.process_column(series, "column_name", nullable=True)

注意事项:
- 所有具体类型必须继承自 DataType 基类，并实现 process_column 方法。
- 若需新增数据类型，应在 data_types_parts 的对应子模块中实现，
  然后在本模块导入并重导出，同时更新 __all__ 列表。
"""

from __future__ import annotations

# 1. 项目内部导入 —— 从 data_types_parts 各子模块聚合类型
# 基类：所有数据类型的抽象基类，定义统一的 process_column / validate / parse 接口
from app.shared.domain.data_types_parts.base import DataType

# 复合类型：支持多条件组合校验的复合条件类型
from app.shared.domain.data_types_parts.composite import CompositeConditionType, SpecificCompositeConditionType

# 表达式类型：支持 JSONPath 等动态表达式求值的列类型，可配置展开为多个子列
from app.shared.domain.data_types_parts.expression import ExpressionType, SpecificExpressionType

# 提取类型：派生列类型，表示由正则提取或其他计算逻辑生成的虚拟列
from app.shared.domain.data_types_parts.extracted import ExtractedType

# 标量类型：基本数据类型，覆盖数值、字符串、布尔、日期等常见类型
from app.shared.domain.data_types_parts.scalars import (
    BooleanType,  # 布尔类型：True / False
    DateType,  # 日期类型：datetime.date 或 datetime.datetime
    DecimalType,  # 高精度小数类型：Decimal，适用于财务计算
    FloatType,  # 浮点类型：float，适用于科学计算
    IntegerType,  # 整数类型：int
    StringType,  # 字符串类型：str，最通用的数据类型
)

# 序列类型：数组/列表类型，表示同一类型的多个值集合
from app.shared.domain.data_types_parts.sequence import SequenceType

# 控制 `from module import *` 时导出的公开名称
# 按类型类别分组排列，便于开发者快速定位所需类型
__all__ = [
    # 基类
    "DataType",
    # 标量类型
    "BooleanType",
    "DateType",
    "DecimalType",
    "FloatType",
    "IntegerType",
    "StringType",
    # 复合类型
    "CompositeConditionType",
    "SpecificCompositeConditionType",
    # 表达式类型
    "ExpressionType",
    "SpecificExpressionType",
    # 提取类型
    "ExtractedType",
    # 序列类型
    "SequenceType",
]
