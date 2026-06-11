"""
@fileoverview 约束适配器模块

功能概述:
- 提供 ConstraintAdapter，将任意 Domain Constraint 包装为 Service Validator
- 统一委托模式，消除简单 Validator 文件中的重复模板代码
- 支持预检、参数映射、自定义 datasets 构建、错误格式化

架构设计:
- 继承 BaseValidator，实现 validate() 接口
- 内部创建 Domain Constraint 实例并通过 _delegate_validation 委托
- kwargs 透传机制：从 Validator kwargs 映射到 Constraint 构造参数
"""

from __future__ import annotations

import time
from typing import Any, Callable

import pandas as pd

from app.shared.domain.constraints.base import Constraint

from ..types import ValidationResult
from .base import BaseValidator

PreCheckFn = Callable[[pd.DataFrame, str, dict], str | None]
KwargsBuilderFn = Callable[[str, dict], dict[str, Any]]
DatasetsBuilderFn = Callable[[pd.DataFrame, str, dict], dict[str, pd.DataFrame]]


class ConstraintAdapter(BaseValidator):
    """
    @classdesc 通用约束适配器

    将任意 Domain Constraint 包装为 Service Validator，
    自动处理 datasets 映射、预检、参数构建和错误格式转换。

    使用示例:
        # 简单约束（无额外参数）
        adapter = ConstraintAdapter(
            constraint_cls=UniqueConstraint,
            column_param="column",
        )

        # 带参数映射和预检
        adapter = ConstraintAdapter(
            constraint_cls=RegexConstraint,
            column_param="column",
            kwargs_mapping={"regex_pattern": "pattern", ...},
            pre_checks=[PreCheck.column_exists(), PreCheck.param_required("regex_pattern")],
        )

        # 带自定义 datasets 构建（如外键双表）
        adapter = ConstraintAdapter(
            constraint_cls=ForeignKeyConstraints,
            column_param="from_column",
            datasets_builder=PreCheck.build_fk_datasets,
            ...
        )
    """

    def __init__(
        self,
        constraint_cls: type[Constraint],
        column_param: str = "column",
        extra_params: dict[str, Any] | None = None,
        kwargs_mapping: dict[str, str] | None = None,
        error_formatter: Callable[[dict], dict] | None = None,
        pre_checks: list[PreCheckFn] | None = None,
        kwargs_builder: KwargsBuilderFn | None = None,
        datasets_builder: DatasetsBuilderFn | None = None,
        constraint_kwargs_keys: list[str] | None = None,
    ):
        self.constraint_cls = constraint_cls
        self.column_param = column_param
        self.extra_params = extra_params or {}
        self.kwargs_mapping = kwargs_mapping or {}
        self.error_formatter = error_formatter
        self.pre_checks = pre_checks or []
        self.kwargs_builder = kwargs_builder
        self.datasets_builder = datasets_builder
        self.constraint_kwargs_keys = constraint_kwargs_keys or []

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        start_time = time.time()

        for check in self.pre_checks:
            error_msg = check(df, column, kwargs)
            if error_msg:
                return ValidationResult(
                    is_valid=False,
                    error_count=1,
                    total_rows=len(df),
                    error_rows=[{"row_index": 0, "cell_value": None, "error_message": error_msg}],
                    validation_time=f"{time.time() - start_time:.3f}s",
                )

        if self.kwargs_builder:
            params = self.kwargs_builder(column, kwargs)
        else:
            params: dict[str, Any] = {"table": "temp", self.column_param: column}
            params.update(self.extra_params)
            for validator_kwarg, constraint_param in self.kwargs_mapping.items():
                if validator_kwarg in kwargs:
                    params[constraint_param] = kwargs[validator_kwarg]

        constraint = self.constraint_cls(**params)

        constraint_kwargs = {}
        for key in self.constraint_kwargs_keys:
            if key in kwargs:
                constraint_kwargs[key] = kwargs[key]

        if self.datasets_builder:
            datasets = self.datasets_builder(df, column, kwargs)
            return self._delegate_validation(
                df,
                column,
                constraint,
                error_formatter=self.error_formatter,
                datasets=datasets,
                constraint_kwargs=constraint_kwargs or None,
            )

        return self._delegate_validation(
            df,
            column,
            constraint,
            error_formatter=self.error_formatter,
            constraint_kwargs=constraint_kwargs or None,
        )


class PreCheck:
    """内置预检工厂方法"""

    @staticmethod
    def column_exists() -> PreCheckFn:
        def check(df: pd.DataFrame, column: str, kwargs: dict) -> str | None:
            if column not in df.columns:
                return f"列 '{column}' 不存在"
            return None

        return check

    @staticmethod
    def param_required(*keys: str) -> PreCheckFn:
        def check(df: pd.DataFrame, column: str, kwargs: dict) -> str | None:
            for key in keys:
                if not kwargs.get(key):
                    return f"参数 '{key}' 不能为空"
            return None

        return check

    @staticmethod
    def param_required_any(*key_groups: tuple[str, ...]) -> PreCheckFn:
        def check(df: pd.DataFrame, column: str, kwargs: dict) -> str | None:
            for group in key_groups:
                if any(kwargs.get(k) for k in group):
                    return None
            return "校验配置不完整"

        return check
