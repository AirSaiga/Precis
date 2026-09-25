# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview CLI AI 流式渲染单元测试

覆盖三层：
1. ChatStreamRenderer 直接驱动：chunk 增量打印、spinner 停启时机（等待窗口重启）、
   工具行/轮次分隔/失败状态渲染、流末收尾、最终回复去重判定
2. SpinnerController 幂等性：重复 stop 无二次清行、重启可用、未启动时 stop 无副作用
3. 编排器注入：ChatOptions.agent_stream_callbacks 经 _execute_with_agent
   转交 runner.configure_callbacks（on_chunk 逐段触发）
4. execute_ai_chat 端到端（ProviderType.FAKE 确定性剧本）：终端输出包含
   流式内容而非仅最终 reply，工具回调被触发，最终回复不重复打印
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch

import pytest

from app.cli.shell.commands.ai import executor as executor_mod
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.ai.executor_utils import SpinnerController
from app.cli.shell.commands.ai.stream_renderer import ChatStreamRenderer
from app.cli.shell.commands.base import ProjectContext
from app.shared.services.ai.agent.types import ToolResult
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import ChatRequest, StreamChunk
from app.shared.services.llm.providers.fake import AGENT_FINAL_REPLY, FakeProvider


class _MidStreamFailureProvider(FakeProvider):
    """流式中途故障剧本：yield 一个 delta 后抛指定异常（模拟 LLM 断流 / 用户中断）。"""

    def __init__(self, config: AIProvider, exc: BaseException) -> None:
        super().__init__(config)
        self._exc = exc

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(type="delta", text="流式开头还没写完")
        raise self._exc


def _make_tool_result(name: str, success: bool = True, error: str | None = None) -> ToolResult:
    """构造工具结果（observation 形态不影响渲染，固定给空串）。"""
    return ToolResult(call_id=f"call_{name}", name=name, success=success, observation="", error=error)


class TestChatStreamRendererUnit:
    def test_chunk_stops_spinner_and_prints_incrementally(self, capsys):
        """chunk 到达即停 spinner 并逐字打印；重复停无二次清行序列。"""
        spinner = SpinnerController()
        spinner.start()  # executor 在对话开始时启动
        renderer = ChatStreamRenderer(spinner=spinner, interactive=True)

        renderer.on_chunk("你好")
        assert not spinner.is_running
        renderer.on_chunk("，世界")

        out = capsys.readouterr().out
        assert "你好，世界" in out
        assert not spinner.is_running
        # 清行序列（\r + 空格覆盖 + \r）只出现一次——后续 chunk 的 stop 无副作用
        assert out.count("\r" + " " * 20 + "\r") == 1

    def test_spinner_restarts_for_tool_and_turn_wait_windows(self, capsys):
        """工具执行与轮间 LLM 等待窗口 spinner 动画回归，结果/文本到达即停。"""
        spinner = SpinnerController()
        spinner.start()  # executor 在对话开始时启动
        renderer = ChatStreamRenderer(spinner=spinner, interactive=True)
        try:
            renderer.on_chunk("先看看项目")
            assert not spinner.is_running

            renderer.on_tool_call("read_project", "call_1", 1)
            assert spinner.is_running  # 工具执行等待窗口

            renderer.on_tool_result(_make_tool_result("read_project"))
            assert not spinner.is_running

            renderer.on_turn(2)
            assert spinner.is_running  # 下一轮 LLM 响应等待窗口

            renderer.on_chunk("第二轮回复")
            assert not spinner.is_running
        finally:
            spinner.stop()  # 收尾，确保后台线程不泄漏

    def test_spinner_covers_whole_tool_batch(self, capsys):
        """批量工具调用（call 全部先触发、结果批量返回）：动画覆盖整个执行窗口。"""
        spinner = SpinnerController()
        spinner.start()
        renderer = ChatStreamRenderer(spinner=spinner, interactive=True)
        try:
            renderer.on_chunk("x")  # 停掉初始 spinner
            renderer.on_tool_call("read_project", "c1", 1)
            renderer.on_tool_call("read_table", "c2", 1)
            assert spinner.is_running

            renderer.on_tool_result(_make_tool_result("read_project"))
            renderer.on_tool_result(_make_tool_result("read_table"))
            assert not spinner.is_running

            out = capsys.readouterr().out
            assert "→ 调用工具 读取项目..." in out
            assert "→ 调用工具 查看数据..." in out
            assert "✓ 读取项目 完成" in out
            assert "✓ 查看数据 完成" in out
        finally:
            spinner.stop()

    def test_tool_call_terminates_pending_stream_line(self, capsys):
        """工具行出现前流式文本已换行收尾，不粘连。"""
        spinner = MagicMock()
        renderer = ChatStreamRenderer(spinner=spinner, interactive=True)

        renderer.on_chunk("我先看一下项目结构")
        renderer.on_tool_call("read_project", "call_1", 1)

        out = capsys.readouterr().out
        assert "我先看一下项目结构\n" in out
        assert "→ 调用工具 读取项目..." in out

    def test_tool_result_success_and_failure_lines(self, capsys):
        """工具结果单行成败状态，失败附截断错误信息。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True)

        renderer.on_tool_call("read_project", "call_1", 1)
        renderer.on_tool_result(_make_tool_result("read_project"))
        renderer.on_tool_call("apply_actions", "call_2", 1)
        renderer.on_tool_result(_make_tool_result("apply_actions", success=False, error="字段不存在"))

        out = capsys.readouterr().out
        assert "✓ 读取项目 完成" in out
        assert "✗ 修改配置 失败 — 字段不存在" in out

    def test_error_truncation_marker_and_non_interactive_full(self, capsys):
        """交互模式超长错误截断并补 … 标记；非交互模式不截断（stderr 是唯一诊断通道）。"""
        long_error = "很长的错误信息" * 20  # 140 字符，远超交互模式 60 字符上限

        interactive_renderer = ChatStreamRenderer(spinner=None, interactive=True)
        interactive_renderer.on_tool_result(_make_tool_result("apply_actions", success=False, error=long_error))
        out = capsys.readouterr().out
        assert long_error[:60] in out
        assert "…" in out
        assert long_error not in out  # 未全量展示

        non_interactive_renderer = ChatStreamRenderer(spinner=None, interactive=False)
        non_interactive_renderer.on_tool_result(_make_tool_result("apply_actions", success=False, error=long_error))
        err = capsys.readouterr().err
        assert long_error in err  # 完整保留
        assert "…" not in err

    def test_turn_separator_only_after_content(self, capsys):
        """轮次分隔克制使用：首轮不打、无内容前不打、有内容后的轮前打空行。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True)

        renderer.on_turn(1)
        renderer.on_turn(2)  # 尚无任何内容输出（started=False），不打
        assert capsys.readouterr().out == ""

        renderer.on_chunk("第一轮文本")
        renderer.on_tool_call("read_project", "call_1", 1)
        renderer.on_turn(2)
        out = capsys.readouterr().out
        assert "第一轮文本\n" in out
        assert "→ 调用工具 读取项目..." in out
        assert out.endswith("\n\n")  # 工具行后接轮次空行分隔

    def test_finish_terminates_pending_line(self, capsys):
        """finish 保证末行换行，后续输出不与流式文本同行。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True)
        renderer.on_chunk("回复结尾没有换行")
        renderer.finish()
        out = capsys.readouterr().out
        assert out.endswith("回复结尾没有换行\n")

    def test_final_reply_already_shown_requires_last_turn_match(self):
        """判定只比对最后一轮：多轮中间文本不干扰，最后一轮全文一致才算已上屏。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True)

        renderer.on_turn(1)
        renderer.on_chunk("中间轮说明文本")
        renderer.on_tool_call("read_project", "call_1", 1)
        renderer.on_turn(2)
        renderer.on_chunk(AGENT_FINAL_REPLY[:10])
        renderer.on_chunk(AGENT_FINAL_REPLY[10:])

        assert renderer.final_reply_already_shown(AGENT_FINAL_REPLY) is True
        assert renderer.final_reply_already_shown("另一段总结") is False
        assert renderer.final_reply_already_shown("") is False

    def test_non_interactive_status_to_stderr(self, capsys):
        """ai ask 非交互：回复正文走 stdout，工具状态走 stderr（管道场景正文不被污染）。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=False)

        renderer.on_chunk("回复正文")
        renderer.on_tool_call("read_project", "call_1", 1)
        renderer.on_tool_result(_make_tool_result("read_project"))
        renderer.finish()

        captured = capsys.readouterr()
        assert captured.out == "回复正文\n"
        assert "→ 调用工具 读取项目..." in captured.err
        assert "✓ 读取项目 完成" in captured.err

    def test_print_fallback_on_unencodable_chars(self):
        """GBK 等本地编码管道下不可编码字符（✓/✗）降级替换，渲染不中断。"""
        import io

        from app.cli.shell.commands.ai.stream_renderer import _print_to

        stream = io.TextIOWrapper(io.BytesIO(), encoding="gbk", newline="\n")
        _print_to(stream, "✓ 完成")  # 不应抛 UnicodeEncodeError
        stream.flush()
        content = stream.buffer.getvalue().decode("gbk")
        assert content == "? 完成\n"


class TestSpinnerController:
    def test_stop_without_start_is_noop(self, capsys):
        """未启动时 stop 不输出清行序列（避免误抹行首的流式文本）。"""
        spinner = SpinnerController()
        spinner.stop()
        assert capsys.readouterr().out == ""
        assert not spinner.is_running

    def test_double_stop_clears_line_once(self, capsys):
        """重复 stop 幂等：清行序列只输出一次。"""
        spinner = SpinnerController()
        spinner.start()
        spinner.stop()
        first_out = capsys.readouterr().out
        spinner.stop()
        assert capsys.readouterr().out == ""
        assert ("\r" + " " * 20 + "\r") in first_out

    def test_restart_after_stop(self, capsys):
        """stop 后可重新 start（等待窗口重启动画的前提）。"""
        spinner = SpinnerController()
        try:
            spinner.start()
            spinner.stop()
            assert not spinner.is_running
            spinner.start()
            assert spinner.is_running
        finally:
            spinner.stop()
        assert not spinner.is_running

    def test_pause_resume_when_not_running_is_noop(self, capsys):
        """未运行时 pause/resume 无副作用（不输出清行序列）。"""
        spinner = SpinnerController()
        spinner.pause()
        spinner.resume()
        assert capsys.readouterr().out == ""


class TestOrchestratorCallbackInjection:
    def test_agent_stream_callbacks_forwarded_to_runner(self, tmp_path):
        """ChatOptions.agent_stream_callbacks 经编排器转交 configure_callbacks，on_chunk 逐段触发。"""
        from app.shared.services.ai.chat_orchestrator import AIChatOrchestrator, ChatOptions

        chunks: list[str] = []
        options = ChatOptions(
            history=[],
            agent_mode=True,
            max_agent_iterations=5,
            agent_stream_callbacks={
                "on_chunk": lambda text: chunks.append(text),
                "on_turn": lambda turn: None,
                "on_tool_call": lambda name, call_id, turn: None,
                "on_tool_result": lambda tr: None,
            },
        )

        result = asyncio.run(
            AIChatOrchestrator(_fake_provider_config()).execute_chat(
                message="给昵称加字符集约束",
                project_path=str(tmp_path),
                context_nodes=[],
                options=options,
            )
        )

        assert result.success
        # fake 剧本第二轮把最终回复拆成两个 delta，on_chunk 应逐段触发
        assert "".join(chunks) == AGENT_FINAL_REPLY
        assert len(chunks) >= 2


def _fake_provider_config() -> AIProvider:
    return AIProvider(
        id="fake-e2e",
        name="fake-e2e",
        type=ProviderType.FAKE,
        base_url="http://localhost/fake",
        api_key="fake-key",
        model="fake-1",
    )


def _make_context(tmp_path) -> ProjectContext:
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "P", "id": "p"}}
    return ctx


def _make_fake_project(tmp_path) -> None:
    """最小 V2 项目（users 表 + 数据文件），让 fake 剧本的 apply_actions 成功写盘。"""
    (tmp_path / "schemas").mkdir(exist_ok=True)
    (tmp_path / "constraints").mkdir(exist_ok=True)
    (tmp_path / "data").mkdir(exist_ok=True)
    (tmp_path / "project.precis.yaml").write_text(
        "\n".join(
            [
                "version: 2",
                "project:",
                "  id: fake-stream-test",
                "  name: fake-stream-test",
                "schemas:",
                "  - id: users",
                "    path: schemas/users.schema.yaml",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "schemas" / "users.schema.yaml").write_text(
        "\n".join(
            [
                "version: 2",
                "id: users",
                "name: users",
                "source:",
                "  mode: relative_file",
                "  path: data/users.csv",
                "columns:",
                "  - id: id",
                "    name: id",
                "    type: integer",
                "    primary_key: true",
                "    nullable: false",
                "  - id: name",
                "    name: name",
                "    type: string",
                "  - id: nickname",
                "    name: nickname",
                "    type: string",
                "constraints: []",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "data" / "users.csv").write_text("id,name,nickname\n1,张三,小明\n2,李四,阿杰88\n", encoding="utf-8")


def _executor_patches() -> list:
    """屏蔽 CLI 配置与上下文构建等外部边界，Provider 指向确定性 fake。"""
    return [
        patch.object(executor_mod, "_get_provider_display", return_value={"id": "x"}),
        patch.object(executor_mod, "_get_provider_with_key", return_value=_fake_provider_config()),
        patch.object(executor_mod, "resolve_context_window", return_value=32000),
        patch(
            "app.cli.shell.commands.ai.interaction.build_context_data",
            return_value={"context": {"selectedNodes": []}},
        ),
    ]


class TestExecuteAIChatStreaming:
    def test_non_interactive_ask_streams_reply_and_tool_status(self, tmp_path, capsys):
        """ai ask：stdout 流式输出最终回复（不重复），工具状态走 stderr。"""
        _make_fake_project(tmp_path)
        patches = _executor_patches()
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("给昵称加字符集约束", _make_context(tmp_path), interactive=False)
        finally:
            for p in patches:
                p.stop()

        captured = capsys.readouterr()
        # 回复已随流逐字打到 stdout，且不重复出现（message 置空不再由调用方打印）
        assert AGENT_FINAL_REPLY in captured.out
        assert captured.out.count(AGENT_FINAL_REPLY) == 1
        # 工具回调被触发：调用状态行 + 失败状态行（ai ask 无确认门，写盘 fail-closed 属既有语义）
        assert "→ 调用工具 修改配置..." in captured.err
        assert "✗ 修改配置 失败 — 此环境不支持自动写盘" in captured.err
        assert result.success
        assert result.data["reply"] == AGENT_FINAL_REPLY
        assert result.message == ""

    def test_interactive_chat_streams_without_duplicate_reply(self, tmp_path, capsys, monkeypatch):
        """ai chat 交互模式：流式上屏后不再整段重复打印最终回复，spinner 被停掉。"""
        _make_fake_project(tmp_path)
        # 屏蔽真实 spinner 线程；交互 agent 模式的两阶段确认自动 y
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)
        monkeypatch.setattr("builtins.input", lambda *a, **k: "y")

        patches = _executor_patches()
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("给昵称加字符集约束", _make_context(tmp_path), interactive=True)
        finally:
            for p in patches:
                p.stop()

        captured = capsys.readouterr()
        assert AGENT_FINAL_REPLY in captured.out
        assert captured.out.count(AGENT_FINAL_REPLY) == 1
        # 首个流式事件到达后 spinner 被停掉；工具状态行与两阶段确认摘要同屏且不粘连
        spinner_stub.stop.assert_called()
        assert "→ 调用工具 修改配置..." in captured.out
        assert "✓ 修改配置 完成" in captured.out
        assert "AI 请求写入" in captured.out
        assert result.success

    def test_legacy_mode_keeps_buffered_behavior(self, tmp_path, capsys, monkeypatch):
        """--no-agent-mode 路径无流式管道：不注册流式回调，最终回复仍整段打印。"""
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)

        fake_result = MagicMock()
        fake_result.success = True
        fake_result.reply = "好的，已完成"
        fake_result.actions = []
        fake_result.frontend_instructions = None
        fake_result.tool_steps = []

        orch = MagicMock()
        captured: dict[str, object] = {}

        async def _capture_chat(**kwargs):
            captured.update(kwargs)
            return fake_result

        orch.execute_chat = _capture_chat

        patches = _executor_patches() + [
            patch.object(executor_mod, "AIChatOrchestrator", return_value=orch),
        ]
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=True, agent_mode=False)
        finally:
            for p in patches:
                p.stop()

        # legacy 路径不注册流式回调，回复仍由 executor 整段打印一次
        assert captured["options"].agent_stream_callbacks is None
        out = capsys.readouterr().out
        assert out.count("好的，已完成") == 1
        assert result.success

    def test_agent_budget_left_unspecified_for_config_resolution(self, tmp_path):
        """agent 预算接线：CLI 构建的 ChatOptions 不再硬编码轮数（旧实现固定 5），
        交由 ChatAgentRunner 统一回退到用户级 chat.max_agent_iterations 配置。"""
        fake_result = MagicMock()
        fake_result.success = True
        fake_result.reply = "好的，已完成"
        fake_result.actions = []
        fake_result.frontend_instructions = None
        fake_result.tool_steps = []

        orch = MagicMock()
        captured: dict[str, object] = {}

        async def _capture_chat(**kwargs):
            captured.update(kwargs)
            return fake_result

        orch.execute_chat = _capture_chat

        patches = _executor_patches() + [
            patch.object(executor_mod, "AIChatOrchestrator", return_value=orch),
        ]
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=False, agent_mode=True)
        finally:
            for p in patches:
                p.stop()

        assert result.success
        options = captured["options"]
        assert options.agent_mode is True
        # 未显式指定预算：None 交给 ChatAgentRunner 按用户级配置回退解析
        assert options.max_agent_iterations is None

    def test_provider_runtime_error_mid_stream(self, tmp_path, capsys, monkeypatch):
        """provider 流式中途 RuntimeError：已上屏片段换行收尾、错误呈现一次、无重复 reply、spinner 停止。"""
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)

        provider = _MidStreamFailureProvider(_fake_provider_config(), RuntimeError("模拟流式中断"))
        patches = _executor_patches() + [
            patch("app.shared.services.llm.providers.create", return_value=provider),
        ]
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=True)
        finally:
            for p in patches:
                p.stop()

        captured = capsys.readouterr()
        # 已上屏的流式片段换行收尾（不残留半行）
        assert "流式开头还没写完\n" in captured.out
        assert captured.out.endswith("\n")
        # 错误只呈现一次；runner 的兜底 reply 不整段重复输出
        assert captured.out.count("模拟流式中断") == 1
        assert "抱歉，我在处理时遇到了问题" not in captured.out
        # 失败路径 spinner 也被停止
        spinner_stub.stop.assert_called()
        assert not result.success

    def test_keyboard_interrupt_mid_stream_still_finishes(self, tmp_path, capsys, monkeypatch):
        """流式中途 Ctrl+C（BaseException）：finally 先 finish 再 stop，异常原样向上传播。"""
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)

        provider = _MidStreamFailureProvider(_fake_provider_config(), KeyboardInterrupt())
        patches = _executor_patches() + [
            patch("app.shared.services.llm.providers.create", return_value=provider),
        ]
        for p in patches:
            p.start()
        try:
            with pytest.raises(KeyboardInterrupt):
                execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=True)
        finally:
            for p in patches:
                p.stop()

        captured = capsys.readouterr()
        # Ctrl+C 退出路径同样换行收尾 + spinner 停止，不残留半行/动画
        assert "流式开头还没写完\n" in captured.out
        spinner_stub.stop.assert_called()
