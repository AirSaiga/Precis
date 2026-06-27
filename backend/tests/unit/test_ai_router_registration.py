"""
@fileoverview AI 路由注册确定性测试

验证 `app.api.routers.ai_router` 在包导入时即完成全部子模块端点注册，
确保 `app.include_router(ai_router)` 在任意环境（Linux/Windows、Py3.12/3.13）
下都能拷贝到完整路由集。

背景:
此前用 `_LazyAIRouter` 代理延迟加载 AI 路由，其 `__getattr__` 转发在 CI(Linux)
环境下会不稳定地漏注册 stream.py 的端点（/ai/jobs/{id}/cancel、
/ai/chat/{id}/confirm 返回 404）。改为直接导入后，注册时机确定，本测试锁定该契约。

测试在独立子进程中运行，确保 sys.modules 初始状态干净，复刻 CI 的隔离环境。
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest


class TestAiRouterRegistration:
    @pytest.fixture
    def python(self):
        return sys.executable

    @pytest.fixture
    def project_root(self):
        return Path(__file__).resolve().parents[3]

    def _run_in_subprocess(self, python: str, project_root: Path, code: str) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["PYTHONPATH"] = str(project_root)
        return subprocess.run(
            [python, "-c", code],
            cwd=str(project_root),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_ai_router_is_real_apirouter(self, python: str, project_root: Path):
        """ai_router 是真正的 APIRouter 实例（而非代理）。"""
        code = """
from fastapi import APIRouter
from app.api.routers import ai_router
assert isinstance(ai_router, APIRouter), f"ai_router 不是 APIRouter: {type(ai_router)}"
print("ok")
"""
        result = self._run_in_subprocess(python, project_root, code)
        assert result.returncode == 0, result.stderr

    def test_all_ai_submodule_routes_registered(self, python: str, project_root: Path):
        """包导入后，stream.py 的 3 个端点必须已注册到 ai_router.routes。

        这是回归测试：此前懒加载代理在 CI 漏注册这些端点，导致 404。
        """
        code = """
from app.api.routers import ai_router
paths = {getattr(r, 'path', None) for r in ai_router.routes}
required = {
    '/api/latest/ai/chat/stream',
    '/api/latest/ai/jobs/{job_id}/cancel',
    '/api/latest/ai/chat/{job_id}/confirm',
    '/api/latest/ai/chat',
    '/api/latest/ai/providers',
}
missing = required - paths
assert not missing, f"未注册的 AI 路由: {missing}"
print("ok")
"""
        result = self._run_in_subprocess(python, project_root, code)
        assert result.returncode == 0, result.stderr

    def test_routes_mounted_on_app(self, python: str, project_root: Path):
        """app.include_router 后，stream.py 端点可被 app 服务（HTTP 可达）。

        注意：FastAPI >= 0.138 将 include_router 的结果封装为 _IncludedRouter，
        子路由不再平铺到 app.routes 列表中，而是通过 original_router.routes 持有。
        因此需要递归收集路径，确保该测试在新旧 FastAPI 版本下均有效。
        """
        code = """
from app.api.main import app


def _collect_paths(routes):
    paths = set()
    for route in routes:
        path = getattr(route, "path", None)
        if path:
            paths.add(path)
        # FastAPI >= 0.138 将 include_router 的结果封装为 _IncludedRouter
        original = getattr(route, "original_router", None)
        if original is not None:
            paths.update(_collect_paths(original.routes))
    return paths


paths = _collect_paths(app.routes)
for required in (
    '/api/latest/ai/jobs/{job_id}/cancel',
    '/api/latest/ai/chat/{job_id}/confirm',
):
    assert required in paths, f"{required} 未挂载到 app"
print("ok")
"""
        result = self._run_in_subprocess(python, project_root, code)
        assert result.returncode == 0, result.stderr
