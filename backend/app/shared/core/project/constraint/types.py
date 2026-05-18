"""
@fileoverview 约束类型兼容层模块

功能概述:
- 向后兼容的重新导出入口
- 将 constraint.types 子包的内容暴露到 app.shared.core.project.constraint.types 命名空间

架构设计:
- 兼容层模式：保持历史导入路径稳定
- 无逻辑：仅重新导出，不定义新类型
"""

from .types import *  # noqa: F401,F403
