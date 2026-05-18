"""
@fileoverview 范围校验器 - Range Validator

功能概述:
- 验证指定列的数值是否在指定范围内
- 支持数值范围校验(数字、日期等可比较类型)
- 支持边界模式配置(包含边界 inclusive/不包含边界 exclusive)

架构设计:
- 委托模式: 将校验逻辑委托给 RangeConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用

输入示例:
    df = pd.DataFrame({"age": [25, 30, -5, 150, 18]})
    min_value = 0
    max_value = 120
    boundary_mode = "inclusive"

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=5,
        error_rows=[
            {"row_index": 2, "cell_value": -5, "error_message": "值超出范围"},
            {"row_index": 3, "cell_value": 150, "error_message": "值超出范围"}
        ],
        validation_time="0.001s"
    )
"""

import pandas as pd

from app.shared.domain import RangeConstraint

from ..types import ValidationResult
from .base import BaseValidator


class RangeValidator(BaseValidator):
    """
    @classdesc 范围校验器

    继承自 BaseValidator，提供列数据范围校验功能。
    验证指定列中的数值是否在指定的最小值和最大值范围内。

    为什么需要这个校验器？
    - 用于验证数值是否在合理范围内
    - 常见场景：年龄、分数、百分比等边界值验证
    - 支持包含和不包含边界的校验模式

    设计原则：
    - 委托设计：核心校验逻辑委托给 RangeConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    - 错误标准化：复用基类的错误格式化逻辑
    - 边界灵活：支持包含和不包含边界的校验模式

    示例：
        validator = RangeValidator()
        result = validator.validate(
            df,
            column="age",
            min_value=0,
            max_value=150,
            boundary_mode="inclusive"  # 或 "exclusive"
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行范围校验

        校验 DataFrame 中指定列的数值是否在指定范围内，
        返回包含所有超出范围的值 的标准化校验结果。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 校验参数，包含:
            - min_value: 最小值（可选，设为 None 表示无下限）
            - max_value: 最大值（可选，设为 None 表示无上限）
            - boundary_mode: 边界模式，"inclusive" 为包含边界，"exclusive" 为不包含边界（默认 "inclusive"）

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过（所有值都在范围内即为通过）
            - error_count: 超出范围的行数量
            - total_rows: 总行数
            - match_count: 在范围内的行数
            - error_rows: 超出范围的行详情列表
            - validation_time: 校验耗时

        @sideeffect:
            - 无持久化副作用
            - 内部使用 time.time() 记录校验耗时

        @raises ValueError: 列不存在或数据类型错误

        校验流程:
            Step 1: 记录校验开始时间
            Step 2: 提取范围参数并创建约束对象
            Step 3: 执行校验并获取超出范围的错误列表
            Step 4: 格式化错误结果为标准格式
            Step 5: 返回标准化校验结果
        """
        # Step 2: 提取范围参数并创建约束对象
        # min_value: 允许的最小值，None 表示无下限
        min_value = kwargs.get("min_value")
        # max_value: 允许的最大值，None 表示无上限
        max_value = kwargs.get("max_value")
        # boundary_mode: 边界模式，inclusive 表示包含边界，exclusive 表示不包含边界
        boundary_mode = kwargs.get("boundary_mode", "inclusive")

        # 创建范围约束对象
        # constraint: 范围约束模型，负责检测超出范围的数值
        constraint = RangeConstraint(
            table="temp", column=column, min_value=min_value, max_value=max_value, boundary_mode=boundary_mode
        )

        # 委托给基类的通用委托方法执行校验
        return self._delegate_validation(df, column, constraint)
