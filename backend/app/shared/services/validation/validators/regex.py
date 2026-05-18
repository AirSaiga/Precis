"""
@fileoverview 正则表达式校验器 - Regex Validator

功能概述:
- 验证数据是否符合指定的正则表达式模式
- 支持全匹配(full)和搜索(search)两种匹配模式
- 支持正则表达式标志配置(i/m/s)和大小写控制
- 对空值(NaN/None)跳过校验,不计入错误

架构设计:
- 委托模式: 将校验逻辑委托给 RegexConstraint 域约束处理
- 预检验证: 在委托前检查列存在性和正则表达式非空
- 防御式编程: 正则语法错误由 Constraint 层捕获

输入示例:
    df = pd.DataFrame({
        "email": ["test@example.com", "invalid-email",
                  "user@domain.com", None, "bad_format"]
    })
    regex_pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    match_mode = "full"
    regex_flags = "i"

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=5,
        error_rows=[
            {"row_index": 1, "cell_value": "invalid-email",
             "error_message": "值不符合正则表达式模式"},
            {"row_index": 4, "cell_value": "bad_format",
             "error_message": "值不符合正则表达式模式"}
        ],
        validation_time="0.002s"
    )
"""

import time

import pandas as pd

from app.shared.domain.constraints.regex import RegexConstraint

from ..types import ValidationResult
from .base import BaseValidator


class RegexValidator(BaseValidator):
    r"""
    @classdesc 正则表达式校验器

    继承自 BaseValidator，提供正则表达式格式校验功能。
    验证数据是否符合指定的正则表达式模式，通过委托 RegexConstraint 实现。

    使用示例：
        validator = RegexValidator()
        result = validator.validate(
            df,
            column="email",
            regex_pattern=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            match_mode="full"  # 或 "search"
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行正则表达式校验

        验证 DataFrame 中指定列的数据是否符合指定的正则表达式模式。
        预检列存在性和正则表达式非空，然后委托给 RegexConstraint。

        参数:
            df: 待校验的 DataFrame 对象
            column: 待校验的列名
            **kwargs: 校验参数，包含:
                - regex_pattern: 正则表达式模式（必填）
                - regex_flags: 正则表达式标志字符串（可选，如 "i" 不区分大小写）
                - match_mode: 匹配模式，"full" 为全匹配，"search" 为搜索匹配（默认 "full"）
                - case_sensitive: 是否区分大小写（默认 True）

        返回:
            ValidationResult: 标准化校验结果
        """
        start_time = time.time()

        # Step 1: 验证列存在性
        if column not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": f"列 '{column}' 不存在"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 2: 验证正则表达式非空
        regex_pattern = kwargs.get("regex_pattern", "")
        if not regex_pattern:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": "正则表达式模式不能为空"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 3: 创建 RegexConstraint 并委托校验
        constraint = RegexConstraint(
            table="temp",
            column=column,
            pattern=regex_pattern,
            match_mode=kwargs.get("match_mode", "full"),
            flags=kwargs.get("regex_flags", ""),
            case_sensitive=kwargs.get("case_sensitive", True),
        )
        return self._delegate_validation(df, column, constraint)
