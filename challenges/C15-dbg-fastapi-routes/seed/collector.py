"""
路由收集器。

collect_paths(app) 收集 FastAPI app 的所有路由路径，
包括通过 include_router 引入的子路由。

任务：修复 collect_paths，使其返回 app 的全部路由路径。
"""

from __future__ import annotations

from fastapi import FastAPI


def collect_paths(app: FastAPI) -> set[str]:
    """收集 app 的所有路由路径。"""
    paths: set[str] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        if path is not None:
            paths.add(path)
    return paths
