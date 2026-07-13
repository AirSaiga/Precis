"""@fileoverview Composite 复合约束构建器

递归创建子约束（通过 BuilderInput.create_child 回调，避免直接 import factory 形成循环依赖）。
禁止嵌套 Composite；子约束用 model_validate 正常校验；子错误聚合为 warning。
"""

from __future__ import annotations

import logging

from ..registry import normalize_constraint_type
from ..types import ConstraintFile
from .base import BuilderInput, BuilderResult
from .registry import register_builder

logger = logging.getLogger(__name__)


@register_builder("Composite")
def build_composite(inp: BuilderInput) -> BuilderResult:
    """Composite: params {logic, sub_constraints: [ConstraintFile-like dict]}，refs 原样保留。"""
    params = inp.params
    refs = inp.refs
    sub_configs = params.get("sub_constraints", [])
    sub_constraints = []
    sub_errors: list[str] = []

    for sub_cfg in sub_configs:
        sub_type = normalize_constraint_type(sub_cfg.get("type", ""))
        if sub_type == "Composite":
            # 禁止递归嵌套 Composite
            continue
        # 使用 model_validate 正常构造（执行 Pydantic 校验），
        # 过去用 model_construct 跳过校验导致非法子约束被静默接受
        try:
            sub_file = ConstraintFile.model_validate(sub_cfg)
        except Exception as e:
            sub_errors.append(f"子约束 '{sub_cfg.get('id', '?')}' 配置非法: {e}")
            continue
        # 通过依赖注入的回调创建子约束（不直接 import factory.create_constraint）
        sub_constraint, sub_error = inp.create_child(sub_file, inp.schema_files)
        if sub_constraint is not None:
            sub_constraints.append(sub_constraint)
        elif sub_error is not None:
            # 收集子错误而非静默忽略（过去注释"忽略即可"掩盖了真实问题）
            sub_errors.append(f"子约束 '{sub_file.id}' 创建失败: {sub_error}")
        # sub_error 为 None 且 sub_constraint 为 None：未启用，正常跳过

    if sub_errors:
        # 子错误聚合为一条警告，随主约束返回（通过 warnings 机制向上传播）
        logger.warning(f"Composite 约束 '{inp.const_id}' 子约束存在错误: {'; '.join(sub_errors)}")

    return {
        "sub_constraints": sub_constraints,
        "logic": params.get("logic", "all"),
        "refs": refs,
    }, None
