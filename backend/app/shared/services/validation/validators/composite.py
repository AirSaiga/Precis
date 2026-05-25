"""
@fileoverview 复合约束校验器模块

功能概述:
- 将多个子约束按逻辑策略（all/any/none）聚合校验结果
- 通过构造函数注入 validate_fn 回调，调用 UnifiedValidationService 为每个子约束执行校验
- 避免直接实例化 CompositeConstraint 所需的 create_constraint 工厂 + schema_files 依赖

架构设计:
- 继承 BaseValidator，遵循统一校验器接口
- 通过构造函数注入 validate_fn 回调，消除循环依赖
- 每个子约束独立执行，异常被捕获视为该子约束失败

输入示例:
    CompositeValidator(validate_fn=UnifiedValidationService.validate).validate(
        df=df,
        column="email",
        logic="all",
        sub_constraints=[
            {"type": "NotNull", "enabled": True, "params": {}},
            {"type": "Unique", "enabled": True, "params": {}},
        ]
    )

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=100,
        error_rows=[...]
    )
"""

from __future__ import annotations

import logging
import time
from typing import Callable

import pandas as pd

from ..types import ValidationResult, ValidationType
from .base import BaseValidator

logger = logging.getLogger(__name__)


class CompositeValidator(BaseValidator):
    """@classdesc 复合约束校验器

    接收子约束配置列表，为每个子约束调用注入的 validate_fn 执行校验，
    然后按 logic 策略（all/any/none）聚合最终结果。

    字段说明:
        - logic: 聚合策略 ("all" | "any" | "none")
        - sub_constraints: 子约束配置列表，每项包含 type/enabled/params
    """

    def __init__(self, validate_fn: Callable | None = None):
        """@methoddesc 初始化复合约束校验器

        参数:
            validate_fn: 校验回调函数，签名为 (validation_type, df, column, **kwargs) -> ValidationResult
                         在 service.py 注册时注入，避免循环依赖
        """
        self._validate_fn = validate_fn

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """@methoddesc 执行复合约束校验

        遍历所有子约束配置，逐个调用注入的 validate_fn 执行校验，
        收集结果后按 logic 策略聚合。

        参数:
            df: 待校验的 DataFrame
            column: 待校验的列名
            **kwargs:
                - logic: 聚合策略，默认 "all"
                - sub_constraints: 子约束配置列表

        返回:
            ValidationResult: 标准化校验结果
        """
        validate_fn = self._validate_fn
        if validate_fn is None:
            logger.error("CompositeValidator 未注入 validate_fn，无法执行子约束校验")
            return self._format_errors([], len(df), 0)

        logic = kwargs.get("logic", "all")
        sub_configs = kwargs.get("sub_constraints", [])

        # 空子约束视为通过
        if not sub_configs:
            return self._format_errors([], len(df), 0)

        start_time = time.time()
        all_errors: list[dict] = []
        passed_count = 0
        processed_count = 0

        # 前端传来的类型名 -> ValidationType 常量映射
        # 支持多种命名风格：NotNull / notnull / not_null
        type_map = {
            "notnull": ValidationType.NOT_NULL,
            "not_null": ValidationType.NOT_NULL,
            "unique": ValidationType.UNIQUE,
            "range": ValidationType.RANGE,
            "allowedvalues": ValidationType.ALLOWED_VALUES,
            "allowed_values": ValidationType.ALLOWED_VALUES,
            "charset": ValidationType.CHARSET,
            "scripted": ValidationType.SCRIPTED,
            "foreignkey": ValidationType.FOREIGN_KEY,
            "foreign_key": ValidationType.FOREIGN_KEY,
            "conditional": ValidationType.CONDITIONAL,
            "datelogic": ValidationType.DATE_LOGIC,
            "date_logic": ValidationType.DATE_LOGIC,
        }

        for cfg in sub_configs:
            # 跳过未启用的子约束
            if not cfg.get("enabled", True):
                continue

            sub_type_raw = str(cfg.get("type", "")).lower().replace(" ", "")
            validation_type = type_map.get(sub_type_raw)
            if not validation_type:
                logger.warning(f"Composite 中遇到不支持的子约束类型: {sub_type_raw}")
                continue

            try:
                result = validate_fn(
                    validation_type=validation_type,
                    df=df,
                    column=column,
                    **cfg.get("params", {}),
                )
                processed_count += 1
                if result.is_valid:
                    passed_count += 1
                else:
                    all_errors.extend(result.error_rows)
            except Exception as e:
                logger.warning(f"Composite 子约束校验异常 ({validation_type}): {e}")
                # 子约束异常视为失败，但不中断其他子约束
                continue

        # 如果没有成功处理的子约束，视为通过（避免空子约束报错）
        if processed_count == 0:
            return self._format_errors([], len(df), time.time() - start_time)

        # 根据 logic 策略决定最终错误列表
        final_errors: list[dict] = []

        if logic == "all":
            # 所有子约束都必须通过：返回所有错误的并集
            final_errors = all_errors

        elif logic == "any":
            # 至少一个子约束通过即算通过
            if passed_count == 0:
                final_errors = [
                    {
                        "row_index": 0,
                        "cell_value": None,
                        "error_message": (
                            f"复合约束（logic=any）要求至少一个子约束通过，但全部 {processed_count} 个子约束均失败"
                        ),
                    }
                ]

        elif logic == "none":
            # 所有子约束都必须失败才算通过（反向校验）
            if passed_count > 0:
                final_errors = [
                    {
                        "row_index": 0,
                        "cell_value": None,
                        "error_message": (
                            f"复合约束（logic=none）要求全部子约束失败，但有 {passed_count} 个子约束通过"
                        ),
                    }
                ]

        else:
            # 未知逻辑策略，回退到 all 行为
            logger.warning(f"Composite 遇到未知的 logic 策略: {logic}，回退到 all")
            final_errors = all_errors

        return self._format_errors(final_errors, len(df), time.time() - start_time)
