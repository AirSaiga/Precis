"""
@fileoverview AI 动作解析与执行子包

功能概述:
- registry: 动作类型与约束别名的单一事实源（无依赖叶子模块）
- action_parser: 动作类型映射 + 向后兼容导出
- action_processor: process_actions() 批量处理
- action_handlers: update_yaml_config() + 协调函数
- action_validator: ActionValidator 预验证器

架构设计:
- 管道模式: 解析 → 验证 → 执行
- 批量优化: 内联约束按 schema 分组合并 IO

导入说明:
本 __init__.py 故意不做包级 re-export。原因：action_handlers 依赖
constraints.constraint_builder/frontend_instructions，而这些模块从 registry 派生常量——
若在此处包级 import 会形成循环（actions/__init__ → action_handlers →
constraint_builder → actions 包），导致 test_constraint_builder_behavior.py 等独立
运行时 ImportError。

调用方请直接 import 具体子模块，例如:
    from app.shared.services.llm.actions.action_processor import process_actions
    from app.shared.services.llm.actions.action_handlers import update_yaml_config
    from app.shared.services.llm.actions.action_parser import CONSTRAINT_TYPE_MAP
    from app.shared.services.llm.actions.registry import CONSTRAINT_TYPE_ALIASES
"""
