"""
@fileoverview 基础校验器抽象类 - Base Validator

功能概述:
- 定义所有具体校验器的通用接口和基础功能
- 提供校验结果的标准格式化和错误处理
- 采用抽象基类模式（Abstract Base Class），定义校验器的标准行为

架构设计:
- 抽象基类模式: 所有具体校验器继承 BaseValidator
- 模板方法模式: 定义 validate 方法的标准校验流程
- 静态方法封装: 错误格式化逻辑复用

继承体系:
    BaseValidator (抽象基类)
        ├── RegexValidator
        ├── UniqueValidator
        ├── NotNullValidator
        ├── AllowedValuesValidator
        ├── RangeValidator
        ├── ForeignKeyValidator
        ├── ConditionalValidator
        ├── ScriptedValidator
        ├── CharsetValidator
        └── DateLogicValidator

数据流:
    UnifiedValidationService.validate()
        ↓ [调用]
    具体校验器.validate(df, column, **kwargs)
        ↓ [执行]
    返回错误列表 errors
        ↓ [格式化]
    BaseValidator._format_errors(errors, total_rows, time)
        ↓ [返回]
    ValidationResult 对象

输入示例:
    class CustomValidator(BaseValidator):
        def validate(self, df, column, **kwargs):
            errors = []
            for idx, value in df[column].items():
                if not self._custom_check(value):
                    errors.append({"row_index": idx, "value": value, "message": "..."})
            return self._format_errors(errors, len(df), time.time() - start_time)

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=1,
        error_rows=[{"row_index": 0, "value": "xxx", "message": "..."}]
    )
"""

import logging
from abc import ABC, abstractmethod

import pandas as pd

from ..types import ValidationResult

logger = logging.getLogger(__name__)


class BaseValidator(ABC):
    """
    @classdesc 基础校验器抽象基类

    所有具体校验器（如 RangeValidator、RegexValidator 等）必须继承此类，
    并实现 validate 方法定义具体的校验逻辑。

    设计原则：
    - 统一接口：所有校验器提供相同的 validate 方法签名
    - 结果标准化：校验结果统一格式化为 ValidationResult
    - 错误格式化：提供通用的错误格式化逻辑
    - 异常处理：统一的异常捕获和日志记录

    示例：
        class RangeValidator(BaseValidator):
            def validate(self, df, column, **kwargs):
                # 具体校验逻辑
                return ValidationResult(...)
    """

    def validate_with_error_handling(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        带异常处理的校验方法包装器

        捕获并记录校验过程中的异常，返回标准化的错误结果。
        子类应重写 validate 方法，而不是此方法。

        Args:
            df: 待校验的 DataFrame
            column: 待校验的列名
            **kwargs: 校验参数

        Returns:
            ValidationResult: 校验结果（成功或失败）
        """
        try:
            return self.validate(df, column, **kwargs)
        except Exception as e:
            logger.error(f"Validation error in {self.__class__.__name__}: {e}", exc_info=True)
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {
                        "row_index": 0,
                        "cell_value": None,
                        "error_message": f"\u6821\u9a8c\u6267\u884c\u5931\u8d25: {str(e)}",
                    }
                ],
                validation_time="0.000s",
            )

    @abstractmethod
    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行数据校验

        校验 DataFrame 中指定列的数据,返回标准化的校验结果。
        子类必须实现此方法定义具体的校验逻辑。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 子类特定的校验参数(如 min、max、pattern 等)

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过
            - error_count: 错误行数
            - total_rows: 总行数
            - match_count: 匹配行数
            - error_rows: 错误详情列表
            - validation_time: 校验耗时

        @sideeffect:
            - 可能读取 DataFrame 数据
            - 可能抛出 ValueError(列不存在等)

        @raises ValueError: 列名不存在或数据类型错误
        """
        pass

    def _delegate_validation(
        self,
        df: pd.DataFrame,
        column: str,
        constraint,
        error_formatter: callable = None,
        datasets: dict | None = None,
        constraint_kwargs: dict | None = None,
    ) -> ValidationResult:
        """
        委托校验通用模板

        将单列 DataFrame 校验委托给 Domain Constraint 的通用流程。
        适用于大多数通过 table="temp" 技巧委托给 Constraint 的 Validator。

        Args:
            df: 待校验的 DataFrame
            column: 待校验的列名
            constraint: Domain Constraint 实例
            error_formatter: 可选的错误格式化回调函数(err -> dict)
            datasets: 可选的自定义数据集字典，默认 {"temp": df}
            constraint_kwargs: 可选的额外参数传递给 constraint.validate()

        Returns:
            ValidationResult: 标准化校验结果
        """
        import time

        start_time = time.time()
        if datasets is None:
            datasets = {"temp": df}
        if constraint_kwargs is None:
            constraint_kwargs = {}
        result = constraint.validate(datasets, **constraint_kwargs)
        errors = result.get("errors", [])

        formatted_errors = []
        for err in errors:
            if error_formatter:
                formatted_errors.append(error_formatter(err))
            else:
                formatted_err = {
                    "row_index": err.get("row_index"),
                    "cell_value": err.get("value"),
                    "error_message": err.get("message"),
                }
                # 透传 table/column/error_type 上下文
                for extra_key in ("table", "column", "error_type"):
                    if extra_key in err:
                        formatted_err[extra_key] = err[extra_key]
                formatted_errors.append(formatted_err)

        return self._format_errors(formatted_errors, len(df), time.time() - start_time)

    @staticmethod
    def _format_errors(errors: list[dict], total_rows: int, validation_time: float) -> ValidationResult:
        """
        @methoddesc 格式化校验错误为标准结果

        将校验过程中收集的错误信息转换为标准化的 ValidationResult 对象。
        处理数据类型转换(浮点数、None 值等)并生成可读的错误详情。

        @param errors: 原始错误列表,每个元素包含:
            - value 或 cell_value: 单元格原始值
            - message 或 error_message: 错误描述
            - row_index: 行索引(可选)
        @param total_rows: 校验的总行数
        @param validation_time: 校验耗时(秒)

        @return ValidationResult: 标准化校验结果

        @sideeffect:
            - 数值类型转换(浮点数转整数或保留6位小数)
            - 行索引类型转换(支持字符串和数值)

        处理逻辑:
            Step 1: 计算错误数量和匹配数量
            Step 2: 遍历错误列表,格式化每个错误:
                - 浮点数处理: 整数转为 int,小数保留6位
                - 行索引处理: 转换为 int,无效值默认为 0
                - 错误消息: 兼容多种字段名
            Step 3: 构建 ValidationResult 对象并返回
        """
        # Step 1: 计算校验统计
        # 计算错误行数
        error_count = len(errors)
        # 判断校验是否通过(无错误即为通过)
        is_valid = error_count == 0
        # 计算匹配行数(总行数 - 错误行数)
        match_count = total_rows - error_count

        # Step 2: 格式化错误列表
        formatted_errors = []
        for err in errors:
            # 获取单元格值,兼容多种字段名
            # 【关键数据流】err 可能是 {"value": ...} 或 {"cell_value": ...}
            cell_value = err.get("value") if "value" in err else err.get("cell_value")

            # 浮点数特殊处理:避免科学计数法显示
            # 【副作用】将浮点数转换为可读格式
            if isinstance(cell_value, float):
                # 整数浮点数(如 1.0)转为整数
                if cell_value.is_integer():
                    cell_value = int(cell_value)
                else:
                    # 小数保留6位有效数字
                    cell_value = round(cell_value, 6)

            # 处理行索引:支持字符串和数值类型
            # 【副作用】统一行索引为整数类型
            row_index = err.get("row_index")
            # None 值默认为 0
            if row_index is None:
                row_index = 0
            try:
                # 尝试转换为整数
                row_index = int(row_index)
            except (TypeError, ValueError):
                # 转换失败时默认为 0
                row_index = 0

            # 格式化单个错误记录
            # 【关键数据流】统一错误格式，便于前端展示
            formatted_err = {
                "row_index": row_index,
                "cell_value": cell_value,
                "error_message": err.get("message", err.get("error_message")),
            }
            # 透传 table/column/error_type 上下文（对跨表约束如 ForeignKey 至关重要）
            for extra_key in ("table", "column", "error_type"):
                if extra_key in err:
                    formatted_err[extra_key] = err[extra_key]
            formatted_errors.append(formatted_err)

        # Step 3: 构建并返回校验结果
        # 【副作用】创建 ValidationResult 对象
        return ValidationResult(
            is_valid=is_valid,
            error_count=error_count,
            total_rows=total_rows,
            match_count=match_count,
            error_rows=formatted_errors,
            validation_time=f"{validation_time:.3f}s",
        )


# ==============================================================================
# _format_errors 使用示例
# ==============================================================================
# # 原始错误列表
# errors = [
#     {"row_index": 0, "value": "invalid@email", "message": "邮箱格式错误"},
#     {"row_index": 3, "cell_value": "bad@format", "error_message": "格式不正确"},
#     {"row_index": 5, "value": 1.5, "message": "数值超范围"}  # 浮点数会被处理
# ]
#
# # 调用格式化方法
# result = BaseValidator._format_errors(errors, total_rows=100, validation_time=0.025)
#
# # 返回结果
# # ValidationResult(
# #     is_valid=False,
# #     error_count=3,
# #     total_rows=100,
# #     match_count=97,
# #     error_rows=[
# #         {"row_index": 0, "cell_value": "invalid@email", "error_message": "邮箱格式错误"},
# #         {"row_index": 3, "cell_value": "bad@format", "error_message": "格式不正确"},
# #         {"row_index": 5, "cell_value": 1.5, "error_message": "数值超范围"}
# #     ],
# #     validation_time="0.025s"
# # )
# ==============================================================================
