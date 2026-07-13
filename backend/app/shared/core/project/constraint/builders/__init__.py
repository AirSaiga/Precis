"""@fileoverview 约束构建器子包

通过 side-effect import 触发各 builder 的 @register_builder 注册。
新增约束类型时，新建 builder 文件并在本文件 import 即可自动注册。

注册清单：
- single_column: NotNull / AllowedValues / DateLogic / Range / Charset
- unique: Unique（多列 list 语义）
- foreign_key: ForeignKey（双向引用）
- conditional: Conditional（IF 条件列表）
- scripted: Scripted（可选列）
- composite: Composite（递归子约束）
"""

from __future__ import annotations

# side-effect import：触发各模块顶层的 @register_builder 调用
from . import (  # noqa: F401
    composite,
    conditional,
    foreign_key,
    scripted,
    single_column,
    unique,
)
from .base import BuilderInput, BuilderResult
from .registry import CONSTRAINT_BUILDERS, build_kwargs, register_builder

__all__ = [
    "BuilderInput",
    "BuilderResult",
    "CONSTRAINT_BUILDERS",
    "build_kwargs",
    "register_builder",
]
