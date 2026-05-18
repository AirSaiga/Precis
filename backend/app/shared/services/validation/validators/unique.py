"""
@fileoverview 唯一性校验器 - Unique Validator

功能概述:
- 验证指定列的数据是否唯一(无重复值)
- 支持跨行重复检测,标识所有重复行的位置和值
- 常用于主键、用户名、订单号等必须唯一的字段

架构设计:
- 委托模式: 将校验逻辑委托给 UniqueConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用

输入示例:
    df = pd.DataFrame({
        "user_id": [1, 2, 3, 2, 5]
    })

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=1,
        total_rows=5,
        error_rows=[
            {"row_index": 3, "cell_value": 2, "error_message": "值重复"}
        ],
        validation_time="0.001s"
    )
"""

import pandas as pd

from app.shared.domain import UniqueConstraint

from ..types import ValidationResult
from .base import BaseValidator


class UniqueValidator(BaseValidator):
    """
    @classdesc 唯一性校验器

    继承自 BaseValidator，提供列数据唯一性校验功能。
    验证指定列中是否存在重复值，并将重复行的信息返回。

    为什么需要这个校验器？
    - 用于验证数据唯一性，确保没有重复记录
    - 常见场景：主键、用户名、订单号等必须唯一的字段
    - 自动识别所有重复值的位置

    设计原则：
    - 委托设计：核心校验逻辑委托给 UniqueConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    - 错误标准化：复用基类的错误格式化逻辑

    示例：
        validator = UniqueValidator()
        result = validator.validate(
            df,
            column="user_id",
            # 无额外参数，UniqueConstraint 使用默认配置
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行唯一性校验

        校验 DataFrame 中指定列的数据是否全部唯一，
        返回包含所有重复行的标准化校验结果。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 预留参数（当前版本无额外参数）

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过（无重复即为通过）
            - error_count: 重复行数量
            - total_rows: 总行数
            - match_count: 唯一行数
            - error_rows: 重复行详情列表
            - validation_time: 校验耗时

        @sideeffect:
            - 无持久化副作用
            - 内部使用 time.time() 记录校验耗时

        @raises ValueError: 列不存在或数据类型错误

        校验流程:
            Step 1: 记录校验开始时间
            Step 2: 创建唯一性约束对象并执行校验
            Step 3: 格式化错误结果为标准格式
            Step 4: 返回标准化校验结果
        """
        constraint = UniqueConstraint(table="temp", column=column)
        return self._delegate_validation(df, column, constraint)
