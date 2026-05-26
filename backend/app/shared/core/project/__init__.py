"""
@fileoverview 项目配置模块（V2）统一入口

功能概述:
- 聚合导出项目加载的核心类型与入口函数
- 对外提供统一的 load_project 加载接口
- 作为 app.shared.core.project 包的门面（Facade），隐藏内部子模块细节

架构设计:
- 门面模式: 将 loader、types 等子模块的实现细节封装在内部，
  调用方只需导入本模块即可获得全部所需功能，降低耦合度。
- 类型重导出: LoadedProject、LoadingError 等核心类型从底层子模块
  重新导出，避免调用方直接依赖内部文件路径，便于后续重构。

导入路径简化示例:
    >>> from app.shared.core.project import load_project, LoadedProject
    >>> project = load_project(Path("project.precis.yaml"))
    >>> print(project.schemas)

注意事项:
- 若需新增对外暴露的类型或函数，应在本模块执行重导出，
  并在 __all__ 中补充对应名称以保持显式控制。
- 禁止在本模块编写具体业务逻辑，所有实现应下沉到子模块中。
"""

# 从 loader 子模块导入核心类型和入口函数
# 采用相对导入，保持包内引用的一致性
from .loader import LoadedProject, load_project

# __all__ 控制 `from app.shared.core.project import *` 时导出的名称列表
# 显式列出公开 API，避免意外暴露内部辅助函数或子模块
__all__ = ["load_project", "LoadedProject"]
