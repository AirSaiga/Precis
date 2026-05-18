"""
@fileoverview 约束适配器模块

功能概述:
- 提供 ConstraintAdapter，将任意 Domain Constraint 包装为 Service Validator
- 统一委托模式，消除简单 Validator 文件中的重复模板代码
- 支持自定义 error_formatter 和 kwargs 映射

架构设计:
- 继承 BaseValidator，实现 validate() 接口
- 内部创建 Domain Constraint 实例并通过 _delegate_validation 委托
- kwargs 透传机制：从 Validator kwargs 映射到 Constraint 构造参数
"""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from app.shared.domain.constraints.base import Constraint

from ..types import ValidationResult
from .base import BaseValidator


class ConstraintAdapter(BaseValidator):
    """
    @classdesc 通用约束适配器

    将任意 Domain Constraint 包装为 Service Validator，
    自动处理 datasets 映射和错误格式转换。

    使用示例:
        # 简单约束（无额外参数）
        adapter = ConstraintAdapter(
            constraint_cls=UniqueConstraint,
            column_param="column",
        )
        result = adapter.validate(df, column="user_id")

        # 带参数映射的约束
        adapter = ConstraintAdapter(
            constraint_cls=RangeConstraint,
            column_param="column",
            kwargs_mapping={"min_value": "min_value", "max_value": "max_value"},
        )
        result = adapter.validate(df, column="age", min_value=0, max_value=150)

        # 带自定义错误格式化
        adapter = ConstraintAdapter(
            constraint_cls=NotNullConstraint,
            column_param="column",
            error_formatter=lambda err: {"row_index": err.get("row_index"), "cell_value": None, "error_message": err.get("message")},
        )
    """

    def __init__(
        self,
        constraint_cls: type[Constraint],
        column_param: str = "column",
        extra_params: dict[str, Any] | None = None,
        kwargs_mapping: dict[str, str] | None = None,
        error_formatter: Callable[[dict], dict] | None = None,
    ):
        """
        参数:
            constraint_cls: Domain Constraint 类
            column_param: Constraint 构造函数中接收列名的参数名
            extra_params: 传递给 Constraint 构造函数的固定参数
            kwargs_mapping: Validator kwargs 到 Constraint 构造参数的映射
            error_formatter: 可选的错误格式化回调函数，用于自定义错误字段
        """
        self.constraint_cls = constraint_cls
        self.column_param = column_param
        self.extra_params = extra_params or {}
        self.kwargs_mapping = kwargs_mapping or {}
        self.error_formatter = error_formatter

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """执行校验：创建 Constraint 实例并委托。"""
        # 构建 Constraint 构造参数
        params: dict[str, Any] = {
            "table": "temp",
            self.column_param: column,
        }
        params.update(self.extra_params)

        # 从 kwargs 中提取映射的参数
        for validator_kwarg, constraint_param in self.kwargs_mapping.items():
            if validator_kwarg in kwargs:
                params[constraint_param] = kwargs[validator_kwarg]

        constraint = self.constraint_cls(**params)
        return self._delegate_validation(df, column, constraint, error_formatter=self.error_formatter)
