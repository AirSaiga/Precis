"""
@fileoverview AI 动作解析与执行子包

功能概述:
- action_parser: 动作类型映射 + 向后兼容导出
- action_processor: process_actions() 批量处理
- action_handlers: update_yaml_config() + 协调函数
- action_validator: ActionValidator 预验证器

架构设计:
- 管道模式: 解析 → 验证 → 执行
- 批量优化: 内联约束按 schema 分组合并 IO
"""

from app.shared.services.llm.actions.action_handlers import update_yaml_config
from app.shared.services.llm.actions.action_parser import (
    CONSTRAINT_TYPE_MAP,
    ActionParseError,
    ActionParser,
    process_actions,
)
from app.shared.services.llm.actions.action_validator import ActionValidator, ValidationResult

__all__ = [
    "ActionParseError",
    "ActionParser",
    "ActionValidator",
    "CONSTRAINT_TYPE_MAP",
    "ValidationResult",
    "process_actions",
    "update_yaml_config",
]
