"""
@fileoverview 统一校验服务模块

功能概述:
- 提供所有数据校验的统一入口 UnifiedValidationService
- 采用注册表模式管理校验器,支持动态注册和获取
- 模块加载时自动注册所有内置校验器
- 支持 REGEX、UNIQUE、NOT_NULL、ALLOWED_VALUES、RANGE、FOREIGN_KEY 等校验类型
- 统一的 ValidationResult 返回格式简化调用方处理

架构设计:
- 注册表模式(Registry Pattern): 解耦校验器与调用方
- 类方法实现: register_validator、get_validator、validate 均为类方法
- 校验器在模块导入时自动注册,服务立即可用
- 新增校验器只需注册,无需修改核心服务代码

输入示例:
    import pandas as pd
    df = pd.DataFrame({
        "email": ["test@example.com", "invalid-email", "user@domain.com"]
    })
    result = UnifiedValidationService.validate(
        validation_type="regex",
        df=df,
        column="email",
        regex_pattern=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    )

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=1,
        total_rows=3,
        error_rows=[
            {"row_index": 1, "cell_value": "invalid-email",
             "error_message": "值不符合正则表达式模式"}
        ],
        validation_time="0.015s"
    )
"""

import logging
from typing import Optional

import pandas as pd

from .types import ValidationResult, ValidationType

logger = logging.getLogger(__name__)

from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint
from app.shared.domain.constraints.not_null import NotNullConstraint
from app.shared.domain.constraints.range import RangeConstraint
from app.shared.domain.constraints.unique import UniqueConstraint

from .validators.adapter import ConstraintAdapter
from .validators.base import BaseValidator
from .validators.charset import CharsetValidator
from .validators.conditional import ConditionalValidator
from .validators.date_logic import DateLogicValidator
from .validators.foreign_key import ForeignKeyValidator
from .validators.regex import RegexValidator
from .validators.scripted import ScriptedValidator


class UnifiedValidationService:
    r"""
    @classdesc 统一校验服务类 - 提供所有数据校验的统一入口

    本服务采用注册表模式（Registry Pattern）：
    - _validators: 校验器注册表，键为校验类型，值为校验器实例
    - register_validator: 动态注册新的校验器
    - get_validator: 根据校验类型获取对应的校验器
    - validate: 执行校验的核心方法

    为什么采用注册表模式？
    1. 解耦：新增校验器不需要修改核心服务代码
    2. 可扩展：运行时可以动态注册新的校验器
    3. 可测试：可以轻松替换为 Mock 对象进行单元测试

    使用示例：
        # 正则表达式校验
        result = UnifiedValidationService.validate(
            validation_type="regex",
            df=dataframe,
            column="email",
            regex_pattern=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
        )

        # 唯一性校验
        result = UnifiedValidationService.validate(
            validation_type="unique",
            df=dataframe,
            column="user_id"
        )

        # 非空校验
        result = UnifiedValidationService.validate(
            validation_type="not_null",
            df=dataframe,
            column="name"
        )
    """

    # _validators: 校验器注册表
    # 键：校验类型字符串（如 "regex", "unique"）
    # 值：对应的校验器实例（BaseValidator 子类）
    # 生命周期：应用启动时注册（模块底部），验证时查询
    # 【关键数据流】所有校验请求都通过此字典路由到具体校验器
    _validators: dict[str, BaseValidator] = {}

    @classmethod
    def register_validator(cls, validation_type: str, validator: BaseValidator):
        """
        @methoddesc 注册校验器到统一服务

        允许在运行时动态添加新的校验器，支持插件化扩展，
        便于测试时替换为 Mock 对象。

        参数:
            validation_type: 校验类型标识符（对应 ValidationType 常量）
            validator: 校验器实例（需继承自 BaseValidator）

        副作用:
            将校验器添加到 _validators 字典
        """
        cls._validators[validation_type] = validator

    @classmethod
    def get_validator(cls, validation_type: str) -> Optional[BaseValidator]:
        """
        @methoddesc 获取指定类型的校验器

        本方法是校验流程的路由核心，根据 validation_type 查找对应校验器。

        参数:
            validation_type: 校验类型标识符

        返回:
            校验器实例，未找到返回 None
        """
        return cls._validators.get(validation_type)

    @classmethod
    def validate(cls, validation_type: str, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行数据校验 - 统一入口方法

        调用方无需关心具体校验器的实现细节，只需传入校验类型和相关参数，
        返回结果格式统一，便于处理。

        参数:
            validation_type: 校验类型（如 "regex", "unique", "range"）
            df: 待校验的 DataFrame
            column: 待校验的列名
            **kwargs: 校验器所需的额外参数
                - regex: regex_pattern, regex_flags, match_mode
                - range: min_value, max_value, boundary_mode
                - allowed_values: allowed_values
                - foreign_key: target_table, target_column, target_values
                - 等等...

        返回:
            ValidationResult: 包含校验是否通过、错误数量、错误详情等信息

        错误处理:
            如果校验器不存在，返回 is_valid=False 的结果

        性能考虑:
            校验器从注册表获取是 O(1) 操作
        """
        # Step 1: 获取校验器
        # 【关键路由】根据 validation_type 从注册表获取对应校验器
        validator = cls.get_validator(validation_type)

        # Step 2: 校验器不存在时返回错误结果
        # 【副作用】返回错误结果，调用方可通过 is_valid=False 判断
        if not validator:
            logger.warning(f"不支持的校验类型: {validation_type}")
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {"row_index": 0, "cell_value": None, "error_message": f"不支持的校验类型: {validation_type}"}
                ],
                validation_time="0.000s",
            )

        # Step 3: 执行实际校验
        # 【核心逻辑】调用具体校验器的 validate 方法
        # 传入 df, column 和 kwargs（包含各类校验参数）
        logger.debug(f"执行校验: type={validation_type}, column={column}, rows={len(df)}")
        result = validator.validate(df, column, **kwargs)
        logger.debug(f"校验完成: is_valid={result.is_valid}, errors={result.error_count}")
        return result


# 模块初始化时注册所有内置校验器
# 【副作用】模块导入时自动执行，完成后服务即可用
#
# 注册策略:
# - 独立类: 有额外服务层逻辑的校验器（预检、自定义数据集等）
# - ConstraintAdapter: 纯委托型校验器，通过适配器消除模板代码

# 独立类注册（有额外服务层逻辑）
UnifiedValidationService.register_validator(ValidationType.REGEX, RegexValidator())
UnifiedValidationService.register_validator(ValidationType.FOREIGN_KEY, ForeignKeyValidator())
UnifiedValidationService.register_validator(ValidationType.CONDITIONAL, ConditionalValidator())
UnifiedValidationService.register_validator(ValidationType.SCRIPTED, ScriptedValidator())
UnifiedValidationService.register_validator(ValidationType.CHARSET, CharsetValidator())
UnifiedValidationService.register_validator(ValidationType.DATE_LOGIC, DateLogicValidator())

# ConstraintAdapter 注册（纯委托型，消除独立 Validator 文件）


def _not_null_formatter(err: dict) -> dict:
    """非空校验专用错误格式化：cell_value 强制为 None（空值不应展示原始内容）"""
    return {
        "row_index": err.get("row_index"),
        "cell_value": None,
        "error_message": err.get("message"),
    }


UnifiedValidationService.register_validator(
    ValidationType.UNIQUE, ConstraintAdapter(UniqueConstraint, column_param="column")
)
UnifiedValidationService.register_validator(
    ValidationType.NOT_NULL,
    ConstraintAdapter(NotNullConstraint, column_param="column", error_formatter=_not_null_formatter),
)
UnifiedValidationService.register_validator(
    ValidationType.ALLOWED_VALUES,
    ConstraintAdapter(
        AllowedValuesConstraint, column_param="column", kwargs_mapping={"allowed_values": "allowed_values"}
    ),
)
UnifiedValidationService.register_validator(
    ValidationType.RANGE,
    ConstraintAdapter(
        RangeConstraint,
        column_param="column",
        kwargs_mapping={"min_value": "min_value", "max_value": "max_value", "boundary_mode": "boundary_mode"},
    ),
)
