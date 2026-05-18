"""
@fileoverview 预览路由模块包入口

功能概述:
- 导出 preview 模块共享的 APIRouter 实例
- 显式导入各子路由模块，确保装饰器在模块加载时完成注册

架构设计:
- `router.py` 只负责创建带 `/preview` 前缀的路由对象
- `path_mode.py`、`content_mode.py`、`header_row.py` 通过副作用方式向同一个 router 挂载端点
- 因此包入口必须导入这些模块，否则 FastAPI 只能拿到一个没有任何子路由的空 router
"""

# 显式导入子模块，触发 `@router.*` 装饰器执行，确保路由被真正注册。
from . import content_mode, header_row, path_mode  # noqa: F401
from .router import router

preview_router = router

__all__ = ["router", "preview_router"]
