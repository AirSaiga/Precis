"""
@fileoverview 项目加载器统一入口

功能概述:
- 聚合导出项目加载的核心类型与入口函数
- 对外提供统一的 load_project 加载接口
- 作为 app.shared.core.project.loader 包的门面（Facade），封装底层实现

架构设计:
- 门面模式: 将 loader.py（入口函数实现）和 types.py（数据模型）等
  子模块的细节隐藏在本模块之后，调用方无需关心内部文件结构。
- 类型重导出: LoadedProject、LoadedRegexNode、LoadingError 等核心类型
  从底层子模块重新导出，确保调用方只需导入本模块即可获得完整类型支持。

导入路径示例:
    >>> from app.shared.core.project.loader import load_project, LoadedProject
    >>> project = load_project(Path("project.precis.yaml"))
    >>> print(project.schemas)

注意事项:
- 若需新增对外暴露的类型，应在本模块执行重导出，
  并在 __all__ 中补充名称以维持显式控制。
- 禁止在本模块编写具体业务逻辑，所有实现应下沉到 loader.py 或 types.py。
"""

# 从 loader 子模块导入项目加载入口函数
# load_project 是项目加载流程的顶层编排函数，负责协调解析、校验和组装
from .loader import load_project

# 从 types 子模块导入核心数据类型
# 这些类型定义了加载结果的数据结构，供上层服务和 API 路由使用
from .types import LoadedProject, LoadedRegexNode, LoadingError

# 控制 `from module import *` 时导出的公开名称
# 显式列出公开 API，防止内部辅助函数或子模块被意外暴露
__all__ = [
    "LoadedProject",
    "LoadedRegexNode",
    "LoadingError",
    "load_project",
]
