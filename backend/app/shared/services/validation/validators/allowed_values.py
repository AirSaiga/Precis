"""
@fileoverview 允许值校验器 - Allowed Values Validator

功能概述:
- 验证指定列的数据是否在允许的值列表中
- 支持白名单校验,仅允许预定义的值通过
- 支持任意类型(字符串、数字、布尔等)的值校验

架构设计:
- 委托模式: 将校验逻辑委托给 AllowedValuesConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用

输入示例:
    df = pd.DataFrame({
        "status": ["active", "inactive", "pending", "unknown", "active"]
    })
    allowed_values = ["active", "inactive", "pending"]

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=1,
        total_rows=5,
        error_rows=[
            {"row_index": 3, "cell_value": "unknown",
             "error_message": "值 'unknown' 不在允许值列表中"}
        ],
        validation_time="0.001s"
    )
"""

import pandas as pd

from app.shared.domain import AllowedValuesConstraint

from ..types import ValidationResult
from .base import BaseValidator


class AllowedValuesValidator(BaseValidator):
    """
    @classdesc 允许值校验器

    继承自 BaseValidator，提供列数据允许值校验功能。
    验证指定列中的所有值是否都在预定义的允许值列表中。

    为什么需要这个校验器？
    - 用于验证数据是否在允许的取值范围内
    - 常见场景：状态字段、类型字段等有限取值
    - 支持任意类型：字符串、数字、布尔等

    设计原则：
    - 委托设计：核心校验逻辑委托给 AllowedValuesConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    - 错误标准化：复用基类的错误格式化逻辑
    - 集合高效：使用 set 数据结构存储允许值，提高查找效率

    示例：
        validator = AllowedValuesValidator()
        result = validator.validate(
            df,
            column="status",
            allowed_values=["active", "inactive", "pending"]
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行允许值校验

        校验 DataFrame 中指定列的数据是否都在允许值列表中，
        返回包含所有不在允许列表中的值的标准化校验结果。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 校验参数，包含:
            - allowed_values: 允许值列表（必填）

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过（所有值都在允许列表中即为通过）
            - error_count: 不在允许列表中的行数量
            - total_rows: 总行数
            - match_count: 在允许列表中的行数
            - error_rows: 非法值行详情列表
            - validation_time: 校验耗时

        @sideeffect:
            - 无持久化副作用
            - 内部使用 time.time() 记录校验耗时

        @raises ValueError: 列不存在或数据类型错误

        校验流程:
            Step 1: 记录校验开始时间
            Step 2: 提取允许值列表并创建约束对象
            Step 3: 执行校验并获取非法值错误列表
            Step 4: 格式化错误结果为标准格式
            Step 5: 返回标准化校验结果
        """
        constraint = AllowedValuesConstraint(
            table="temp", column=column, allowed_values=kwargs.get("allowed_values", [])
        )
        return self._delegate_validation(df, column, constraint)
