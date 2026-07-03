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
    process_actions,
)
from app.shared.services.llm.actions.action_validator import ActionValidator, ValidationResult

# 注意：ActionParser 不在此 re-export。它定义在 chat.response_parser，
# 而 response_parser 依赖 actions.registry，re-export 会形成循环导入。
# 调用方直接 from app.shared.services.llm.chat.response_parser import ActionParser。

__all__ = [
    "ActionParseError",
    "ActionValidator",
    "CONSTRAINT_TYPE_MAP",
    "ValidationResult",
    "process_actions",
    "update_yaml_config",
]
