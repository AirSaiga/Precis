"""测试 CLI AI 命令上下文类型使用 ProjectContext"""

from __future__ import annotations

import pytest

from app.cli.shell.commands.ai import AICommand
from app.cli.shell.commands.ai.chat import AIChatCommand
from app.cli.shell.commands.base import ProjectContext


@pytest.fixture
def project_context(tmp_path):
    """构造一个已打开项目的 ProjectContext"""
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "TestProject"}}
    return ctx


class TestAICommandContext:
    def test_ai_command_execute_accepts_project_context(self, project_context, monkeypatch):
        """AICommand.execute 接受 ProjectContext 并能进入交互式菜单分支"""
        cmd = AICommand()

        # 拦截交互式菜单，避免真实终端输入
        menu_called = []

        def fake_show_menu(ctx):
            menu_called.append(ctx)
            return cmd._cli_config  # 任意非 None 返回值即可

        monkeypatch.setattr(cmd, "_show_interactive_menu", fake_show_menu)

        result = cmd.execute([], project_context)
        assert result is not None
        assert len(menu_called) == 1
        assert menu_called[0] is project_context

    def test_ai_command_ask_direct_with_project_context(self, project_context, monkeypatch):
        """AICommand.execute 接受 ProjectContext 并能进入直接询问分支"""
        cmd = AICommand()

        ask_called = []

        def fake_ask_direct(args, ctx):
            ask_called.append((args, ctx))
            from app.cli.shell.commands.base import CommandResult

            return CommandResult.ok("fake reply")

        monkeypatch.setattr(cmd, "_ask_direct", fake_ask_direct)

        result = cmd.execute(["ask", "测试"], project_context)
        assert result is not None
        assert len(ask_called) == 1
        assert ask_called[0][0] == ["测试"]
        assert ask_called[0][1] is project_context


class TestAIChatCommandContext:
    def test_chat_command_execute_accepts_project_context(self, project_context, monkeypatch):
        """AIChatCommand.execute 接受 ProjectContext 并检查项目已打开"""
        chat_cmd = AIChatCommand()

        # 模拟无 provider，直接返回错误，验证上下文类型正确即可
        monkeypatch.setattr(
            chat_cmd._cli_config,
            "get_active_provider",
            lambda: None,
        )

        result = chat_cmd.execute([], project_context)
        assert not result.success
        assert "LLM Provider" in result.message
