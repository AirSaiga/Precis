"""
@fileoverview ValidationExecutor 脚本安全策略解析测试

验证 _resolve_allow_unsafe_eval 的优先级：
1. ValidationOptions.allow_unsafe_eval
2. ValidationExecutor.allow_unsafe_eval
3. 项目配置 settings.script_security.allow_eval and not sandbox_mode
"""

from unittest.mock import MagicMock, patch

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class TestExecutorScriptSecurity:
    def _make_executor(self, tmp_path, allow_unsafe_eval=None, allow_eval=False, sandbox_mode=True):
        """构造一个使用 mock 项目配置的 ValidationExecutor。"""
        manifest_path = tmp_path / "project.precis.yaml"
        manifest_path.write_text("version: 2\nproject:\n  id: p1\n  name: Test\n", encoding="utf-8")

        settings = MagicMock()
        settings.script_security = MagicMock(allow_eval=allow_eval, sandbox_mode=sandbox_mode)

        loaded_project = MagicMock()
        loaded_project.dataset_schema = MagicMock()
        loaded_project.dataset_schema.tables = {}
        loaded_project.manifest.settings = settings
        loaded_project.manifest.project = MagicMock(id="p1", name="Test")
        loaded_project.schema_files = {}
        loaded_project.constraint_files = {}
        loaded_project.regex_node_files = {}
        loaded_project.transform_files = {}
        loaded_project.warnings = []
        loaded_project.loading_errors = []

        with patch("app.shared.services.validation.executor.load_project", return_value=loaded_project):
            return ValidationExecutor(str(manifest_path), allow_unsafe_eval=allow_unsafe_eval)

    def test_options_override_wins(self, tmp_path):
        """options.allow_unsafe_eval 优先级最高。"""
        executor = self._make_executor(tmp_path, allow_unsafe_eval=False, allow_eval=True, sandbox_mode=False)
        options = ValidationOptions(allow_unsafe_eval=True)
        assert executor._resolve_allow_unsafe_eval(options) is True

        options = ValidationOptions(allow_unsafe_eval=False)
        assert executor._resolve_allow_unsafe_eval(options) is False

    def test_executor_override_fallback(self, tmp_path):
        """options 未指定时，使用执行器级别的 allow_unsafe_eval。"""
        executor = self._make_executor(tmp_path, allow_unsafe_eval=True, allow_eval=False, sandbox_mode=True)
        options = ValidationOptions(allow_unsafe_eval=None)
        assert executor._resolve_allow_unsafe_eval(options) is True

    def test_settings_default(self, tmp_path):
        """两者都未指定时，使用项目配置推导默认值。"""
        executor = self._make_executor(tmp_path, allow_unsafe_eval=None, allow_eval=True, sandbox_mode=False)
        options = ValidationOptions(allow_unsafe_eval=None)
        assert executor._resolve_allow_unsafe_eval(options) is True

    def test_settings_default_sandbox_disables_eval(self, tmp_path):
        """沙箱模式会禁用 eval，即使 allow_eval 为 True。"""
        executor = self._make_executor(tmp_path, allow_unsafe_eval=None, allow_eval=True, sandbox_mode=True)
        options = ValidationOptions(allow_unsafe_eval=None)
        assert executor._resolve_allow_unsafe_eval(options) is False

    def test_settings_default_allow_eval_false(self, tmp_path):
        """allow_eval 为 False 时默认返回 False。"""
        executor = self._make_executor(tmp_path, allow_unsafe_eval=None, allow_eval=False, sandbox_mode=False)
        options = ValidationOptions(allow_unsafe_eval=None)
        assert executor._resolve_allow_unsafe_eval(options) is False


class TestScriptedServerGate:
    """B-sec6: scripted 约束的服务端总开关门禁。

    请求体的 allow_unsafe_eval 不再单独决定执行权——叠加服务端总开关
    PRECIS_ALLOW_UNSAFE_EVAL（默认 False）。只有"服务端允许 AND 请求体也开启"才执行。
    """

    def test_server_off_client_true_still_skipped(self, monkeypatch):
        """服务端开关未设置（默认关闭），即便请求体 allow_unsafe_eval=True 也跳过。"""
        import pandas as pd

        from app.shared.domain.constraints import scripted as mod
        from app.shared.domain.constraints.scripted import ScriptedConstraint

        monkeypatch.delenv("PRECIS_ALLOW_UNSAFE_EVAL", raising=False)
        monkeypatch.setattr(mod, "_SERVER_ALLOW_UNSAFE_EVAL", mod._resolve_server_allow_unsafe_eval())
        assert mod._SERVER_ALLOW_UNSAFE_EVAL is False

        c = ScriptedConstraint(table="t", name="n", expression="value > 0", column="v")
        result = c.validate({"t": pd.DataFrame({"v": [1, 2]})}, allow_unsafe_eval=True)
        assert any("跳过" in e.get("message", "") for e in result["errors"])

    def test_server_on_client_true_executes(self, monkeypatch):
        """服务端开关开启 且 请求体 allow_unsafe_eval=True，约束正常执行。"""
        import pandas as pd

        from app.shared.domain.constraints import scripted as mod
        from app.shared.domain.constraints.scripted import ScriptedConstraint

        monkeypatch.setenv("PRECIS_ALLOW_UNSAFE_EVAL", "true")
        monkeypatch.setattr(mod, "_SERVER_ALLOW_UNSAFE_EVAL", mod._resolve_server_allow_unsafe_eval())
        assert mod._SERVER_ALLOW_UNSAFE_EVAL is True

        c = ScriptedConstraint(table="t", name="n", expression="value > 0", column="v")
        result = c.validate({"t": pd.DataFrame({"v": [1, 2]})}, allow_unsafe_eval=True)
        # 无跳过错误，且无违规（1, 2 都 > 0）
        assert not any("跳过" in e.get("message", "") for e in result["errors"])
        assert result["errors"] == []
