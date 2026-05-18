"""
@fileoverview 领域模型包入口

功能概述:
- 统一导出数据校验相关的领域业务模型
- 提供数据集结构定义、数据类型系统、验证约束系统、表达式系统、数据处理引擎的集中入口
- 降低外部调用方的导入成本

架构设计:
- 聚合导出模式: 通过 __init__.py 将各子模块的核心符号集中暴露
- 模块间关系: 各子模块独立实现，通过本入口统一对外

输入示例:
    from app.shared.domain import DataSetSchema, StringType, NotNullConstraint

输出示例:
    # 可直接使用 ColumnSchema、process_dataframe、ExpressionRegistry 等核心类型和函数
"""

# 1. 项目内部导入
from app.shared.domain.data_engine import (
    process_dataframe,
)
from app.shared.domain.data_types import (
    CompositeConditionType,
    DataType,
    DecimalType,
    ExpressionType,
    FloatType,
    IntegerType,
    SequenceType,
    SpecificCompositeConditionType,
    SpecificExpressionType,
    StringType,
)
from app.shared.domain.dataset_schema import (
    CONSTRAINT_REGISTRY,
    TYPE_REGISTRY,
    ColumnSchema,
    DataSetSchema,
    TableSchema,
    build_type_from_config,
)
from app.shared.domain.expression_system import (
    TYPE_CASTERS,
    ExpressionPattern,
    ExpressionRegistry,
    create_tempated_parser,
)
from app.shared.domain.validation_constraints import (
    CONDITION_REGISTRY,
    AllowedValuesConstraint,
    CharsetConstraint,
    CompositeConstraint,
    ConditionalConstraint,
    Constraint,
    DateLogicConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    ScriptedConstraint,
    UniqueConstraint,
    register_condition,
)

__all__ = [
    "DataSetSchema",
    "TableSchema",
    "ColumnSchema",
    "build_type_from_config",
    "CONSTRAINT_REGISTRY",
    "TYPE_REGISTRY",
    "DataType",
    "IntegerType",
    "StringType",
    "FloatType",
    "DecimalType",
    "SequenceType",
    "ExpressionType",
    "SpecificExpressionType",
    "CompositeConditionType",
    "SpecificCompositeConditionType",
    "CharsetConstraint",
    "CompositeConstraint",
    "Constraint",
    "NotNullConstraint",
    "UniqueConstraint",
    "ForeignKeyConstraints",
    "AllowedValuesConstraint",
    "ConditionalConstraint",
    "RangeConstraint",
    "ScriptedConstraint",
    "DateLogicConstraint",
    "CONDITION_REGISTRY",
    "register_condition",
    "ExpressionRegistry",
    "ExpressionPattern",
    "create_tempated_parser",
    "TYPE_CASTERS",
    "process_dataframe",
]
