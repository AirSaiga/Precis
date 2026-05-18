"""
@fileoverview 项目加载器代理模块

功能概述:
- 从 loader_parts.main 代理导出 load_project 入口函数
- 保持向后兼容的导入路径
"""

from __future__ import annotations

# 从主加载逻辑模块导入唯一的入口函数
from app.shared.core.project.loader.loader_parts.main import load_project

# 限定模块的公开接口，仅暴露 load_project
__all__ = ["load_project"]
