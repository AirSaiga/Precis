"""
路由收集器（C15 seed —— 有 bug）。

任务：修复 collect_paths，使其能返回 app 的所有路由路径，
包括通过 include_router 引入的子路由。

当前 bug：只遍历 app.routes 的顶层，拿不到 include_router 引入的子路由。
在 FastAPI 0.138+ 下，include_router 的结果被封装为 _IncludedRouter 对象，
子路由藏在 route.original_router.routes 里。
"""

from __future__ import annotations

from fastapi import FastAPI


def collect_paths(app: FastAPI) -> set[str]:
    """收集 app 的所有路由路径。

    当前实现（有 bug）：只遍历 app.routes 顶层。
    """
    paths: set[str] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        if path is not None:
            paths.add(path)
    return paths
