"""@fileoverview V2 项目加载器兼容层模块

功能概述:
- 作为兼容层入口，保持原有 API 导入路径稳定
- 重新导出项目加载相关接口（load_project、LoadedProject 等）
"""

# 从 loader 包内部重新导出类型和函数，保持外部导入路径不变
from app.shared.core.project.loader import (
    LoadedProject,
    LoadedRegexNode,
    load_project,
)

# 定义该模块对外暴露的公开接口
__all__ = [
    "LoadedProject",
    "LoadedRegexNode",
    "load_project",
]
