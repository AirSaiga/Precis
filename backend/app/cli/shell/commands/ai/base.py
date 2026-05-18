# backend/app/cli/shell/commands/ai/base.py
"""
@fileoverview AI CLI 命令基础模块 - 统一导出入口

功能概述:
- 提供 AI 交互的辅助函数统一导出入口
- 实际实现已拆分到子模块（utils.py、interaction.py、resolver.py 等）
- 其他模块通过本模块导入所需的工具函数

架构设计:
- 本模块为 re-export 入口，集中暴露 AI 子命令所需的共享工具
- 具体实现分散在 utils.py（API Key 脱敏、错误重试判断）
- interaction.py（操作确认、上下文构建、Spinner 动画）
- resolver.py（表名歧义解析、模糊匹配）

输入示例:
    from app.cli.shell.commands.ai.base import build_context_data

输出示例:
    导入后可直接使用 build_context_data() 等函数
"""

from __future__ import annotations

from app.cli.shell.commands.ai.interaction import build_context_data
from app.cli.shell.commands.ai.utils import mask_api_key

__all__ = ["build_context_data", "mask_api_key"]
