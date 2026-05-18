"""
@fileoverview 项目配置模块（V2）

功能概述:
- 聚合导出项目加载的核心类型与入口函数
- 对外提供统一的 load_project 加载接口

架构设计:
- 门面模式: 隐藏 loader_parts 内部实现细节
- 类型重导出: LoadedProject、LoadingError 等核心类型直接暴露

输入示例:
    from app.shared.core.project import load_project, LoadedProject

输出示例:
    project = load_project(Path("project.precis.yaml"))
"""

# 从 loader 子模块导入核心类型和入口函数
from .loader import LoadedProject, load_project

# __all__ 控制 `from app.shared.core.project import *` 时导出的名称列表
__all__ = ["load_project", "LoadedProject"]
