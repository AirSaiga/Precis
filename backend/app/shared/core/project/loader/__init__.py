"""
@fileoverview 项目加载器统一入口

功能概述:
- 聚合导出项目加载的核心类型与入口函数
- 对外提供统一的 load_project 加载接口

架构设计:
- 门面模式: 隐藏 loader_parts 内部实现细节
- 类型重导出: LoadedProject、LoadingError 等核心类型直接暴露

输入示例:
    from app.shared.core.project.loader import load_project, LoadedProject

输出示例:
    project = load_project(Path("project.precis.yaml"))
"""

# 从 loader 子模块导入入口函数
from .loader import load_project

# 从 types 子模块导入核心数据类型
from .types import LoadedProject, LoadedRegexNode, LoadingError

# 控制 `from module import *` 时导出的公开名称
__all__ = [
    "LoadedProject",
    "LoadedRegexNode",
    "LoadingError",
    "load_project",
]
