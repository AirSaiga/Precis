"""
@fileoverview 非空校验器 - Not Null Validator

功能概述:
- 验证指定列的数据是否为非空值(NULL/NaN)
- 支持检测空字符串、None、NaN 等多种空值类型
- 标识所有包含空值的行位置

架构设计:
- 委托模式: 将校验逻辑委托给 NotNullConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用

输入示例:
    df = pd.DataFrame({
        "name": ["张三", None, "李四", "", "王五"]
    })

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=5,
        error_rows=[
            {"row_index": 1, "cell_value": None, "error_message": "值为空"},
            {"row_index": 3, "cell_value": None, "error_message": "值为空"}
        ],
        validation_time="0.001s"
    )
"""

import pandas as pd

from app.shared.domain import NotNullConstraint

from ..types import ValidationResult
from .base import BaseValidator


class NotNullValidator(BaseValidator):
    """
    @classdesc 非空校验器

    继承自 BaseValidator，提供列数据非空校验功能。
    验证指定列中是否存在空值（NULL/NaN），并将空值行的信息返回。

    为什么需要这个校验器？
    - 用于验证必填字段，确保数据完整性
    - 常见场景：姓名、邮箱、手机号等不能为空的字段
    - 支持检测 None、NaN、空字符串等多种空值类型

    设计原则：
    - 委托设计：核心校验逻辑委托给 NotNullConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    - 错误标准化：复用基类的错误格式化逻辑

    示例：
        validator = NotNullValidator()
        result = validator.validate(
            df,
            column="email",
            # 无额外参数，NotNullConstraint 使用默认配置
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行非空校验

        校验 DataFrame 中指定列的数据是否为非空，
        返回包含所有空值行的标准化校验结果。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 预留参数（当前版本无额外参数）

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过（无非空即为通过）
            - error_count: 空值行数量
            - total_rows: 总行数
            - match_count: 非空行数
            - error_rows: 空值行详情列表
            - validation_time: 校验耗时

        @sideeffect:
            - 无持久化副作用
            - 内部使用 time.time() 记录校验耗时

        @raises ValueError: 列不存在或数据类型错误

        校验流程:
            Step 1: 记录校验开始时间
            Step 2: 创建非空约束对象并执行校验
            Step 3: 格式化错误结果为标准格式
            Step 4: 返回标准化校验结果
        """
        constraint = NotNullConstraint(table="temp", column=column)
        return self._delegate_validation(
            df,
            column,
            constraint,
            error_formatter=lambda err: {
                "row_index": err.get("row_index"),
                "cell_value": None,
                "error_message": err.get("message"),
            },
        )
