"""
@fileoverview AI 路由懒加载测试

验证 app.api.routers 中的 ai_router 在未被访问属性前不会触发
app.api.routers.ai 模块的实际导入。

由于其他测试可能已经加载过 app.api.routers.ai，本测试在独立子进程中运行，
确保 sys.modules 初始状态干净。
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest


class TestAiRouterLazyLoading:
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

    def test_ai_module_not_loaded_on_package_import(self, python: str, project_root: Path):
        """导入 routers 包后，ai 子模块不应被加载。"""
        code = """
import sys
import app.api.routers
assert "app.api.routers.ai" not in sys.modules, "ai module loaded too early"
print("ok")
"""
        result = self._run_in_subprocess(python, project_root, code)
        assert result.returncode == 0, result.stderr

    def test_ai_module_loaded_after_accessing_routes(self, python: str, project_root: Path):
        """访问 ai_router.routes 后，ai 子模块应被加载。"""
        code = """
import sys
import app.api.routers
assert "app.api.routers.ai" not in sys.modules, "ai module loaded too early"
_ = app.api.routers.ai_router.routes
assert "app.api.routers.ai" in sys.modules, "ai module not loaded after accessing routes"
print("ok")
"""
        result = self._run_in_subprocess(python, project_root, code)
        assert result.returncode == 0, result.stderr
