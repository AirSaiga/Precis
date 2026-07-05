"""@fileoverview ChatAgentRunner 单元测试 + agent_mode 路径测试

覆盖：
1. ChatAgentRunner 的工具循环（FakeProvider 模拟 LLM 的 tool_calls 序列）
2. apply_actions 旁路累积的 frontend_instructions 正确穿透到结果
3. 多轮工具调用后自然语言收尾
4. ChatOrchestrator 在 agent_mode=true 时走 runner、=false 时走旧路径

测试策略：FakeProvider 预设 tool_calls 响应序列，mock 后端入口，
验证最终 ChatAgentRunResult 的字段映射正确。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor  # noqa: F401  确保模块加载
from app.shared.services.ai.chat_agent_runner import ChatAgentRunner
from app.shared.services.ai.chat_orchestrator import (
    AIChatOrchestrator,
    ChatOptions,
)
from app.shared.services.llm.actions.validation_types import ValidationResult
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk

# =============================================================================
# FakeProvider（复用 test_agent_executor 的成熟模式）
# =============================================================================


class FakeProvider(BaseProvider):
    """模拟 Provider，按预设序列返回响应（含 tool_calls）。"""

    def __init__(self, responses: list[dict]):
        super().__init__(
            AIProvider(
                id="fake",
                name="Fake",
                type=ProviderType.OPENAI,
                base_url="http://localhost",
                api_key="",
                model="fake",
            )
        )
        self.responses = responses
        self.call_index = 0

    @property
    def name(self):
        return "Fake"

    async def chat(self, req: ChatRequest) -> ChatResponse:
        response = self.responses[self.call_index]
        self.call_index += 1
        return ChatResponse(
            content=response.get("content"),
            tool_calls=response.get("tool_calls"),
            model="fake",
        )

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """按顺序消费 responses，转为 StreamChunk 序列（与 executor 新契约对齐）。"""
        response = self.responses[self.call_index]
        self.call_index += 1
        content = response.get("content")
        if content:
            yield StreamChunk(type="delta", text=content)
        tool_calls = response.get("tool_calls")
        if tool_calls:
            yield StreamChunk(type="tool_calls", tool_calls=tool_calls)

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


def make_tool_call(call_id: str, name: str, arguments: dict) -> dict:
    """构造一个 OpenAI 格式的 tool_call 响应。"""
    import json

    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


# =============================================================================
# ChatAgentRunner 测试
# =============================================================================


@pytest.mark.asyncio
async def test_runner_query_only_path():
    """纯查询路径：read_project 后自然语言收尾，无 apply_actions。"""
    provider = FakeProvider(
        responses=[
            # 第 1 轮：LLM 调 read_project
            {"content": "", "tool_calls": [make_tool_call("c1", "read_project", {})]},
            # 第 2 轮：LLM 用自然语言回答（无 tool_calls → 终止）
            {"content": "当前项目有 1 张表：users"},
        ]
    )

    runner = ChatAgentRunner(
        provider=provider,
        project_path="/fake/project",
        context_nodes=[],
        max_iterations=3,
    )

    with patch(
        "app.shared.services.ai.agent.chat_tools.read_project.get_project_overview",
        return_value={
            "schemas": [{"id": "users"}],
            "constraints": [],
            "transforms": [],
            "regex_nodes": [],
            "settings": {},
        },
    ):
        result = await runner.run("有哪些表？")

    assert result.success is True
    assert "users" in result.reply
    assert result.frontend_instructions == []  # 无修改，无前端指令
    assert result.actions == []  # 无 apply_actions 调用
    assert result.iterations == 2


@pytest.mark.asyncio
async def test_runner_modify_path_collects_instructions():
    """修改路径：apply_actions 后收尾，frontend_instructions 正确旁路累积。

    写操作须走两阶段确认（fail-closed）：runner 用 dry_run_enabled=True + job_id，
    apply_callbacks 通过 on_apply_pending 自动确认。
    """
    import asyncio

    from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
    from app.shared.services.ai.streaming.pending_interaction_store import get_global_pending_interaction_store
    from app.shared.services.llm.actions.diff_compute import DiffResult, FileDiff

    resolve_tasks: list = []

    def on_apply_pending(payload):
        apply_id = payload.get("apply_id")
        if apply_id:
            ctrl = get_global_pending_interaction_store().get(apply_id)

            async def resolve_later():
                await asyncio.sleep(0.01)
                if ctrl is not None:
                    await ctrl.resolve("confirm")

            resolve_tasks.append(asyncio.create_task(resolve_later()))

    apply_callbacks = ApplyCallbacks(on_apply_pending=on_apply_pending)

    provider = FakeProvider(
        responses=[
            # 第 1 轮：LLM 直接 apply_actions
            {
                "content": "",
                "tool_calls": [
                    make_tool_call(
                        "c1",
                        "apply_actions",
                        {"actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull"}}]},
                    )
                ],
            },
            # 第 2 轮：LLM 自然语言总结
            {"content": "我将为该字段添加非空约束"},
        ]
    )

    runner = ChatAgentRunner(
        provider=provider,
        project_path="/fake/project",
        context_nodes=[],
        max_iterations=3,
        dry_run_enabled=True,
        apply_callbacks=apply_callbacks,
        job_id="test-modify",
    )

    fi = {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull"}}
    write_result = {
        "success": True,
        "results": [
            {
                "action": {"actionType": "ADD_CONSTRAINT_NODE"},
                "success": True,
                "message": "ok",
                "frontendInstructions": fi,
            }
        ],
    }

    # stub 预验证为放行；to_thread 依次返回 dry-run DiffResult（第一次）和写盘结果（第二次）
    dry_run_diff = DiffResult(
        success=True,
        files=[FileDiff(path="schemas/users.schema.yaml", status="modified", diff="fake")],
        frontend_instructions=[fi],
    )
    ok_validation = ValidationResult()
    with (
        patch("app.shared.services.ai.agent.chat_tools.apply_actions.ActionValidator") as mock_validator,
        patch(
            "app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread",
            side_effect=[dry_run_diff, write_result],
        ),
    ):
        mock_validator.return_value.validate.return_value = ok_validation
        result = await runner.run("给 email 加非空约束")

    for t in resolve_tasks:
        await t

    assert result.success is True
    assert "非空" in result.reply
    # 关键断言：frontend_instructions 被旁路累积到结果
    assert len(result.frontend_instructions) >= 1
    assert result.frontend_instructions[0]["actionType"] == "ADD_CONSTRAINT_NODE"
    # actions 审计记录
    assert len(result.actions) == 1


@pytest.mark.asyncio
async def test_runner_multi_tool_loop():
    """多工具循环：read_table → apply_actions → validate_table → 收尾。"""
    provider = FakeProvider(
        responses=[
            {"content": "", "tool_calls": [make_tool_call("c1", "read_table", {"table_name": "users"})]},
            {
                "content": "",
                "tool_calls": [
                    make_tool_call("c2", "apply_actions", {"actions": [{"actionType": "ADD_CONSTRAINT_NODE"}]})
                ],
            },
            {"content": "", "tool_calls": [make_tool_call("c3", "validate_table", {"table_name": "users"})]},
            {"content": "已完成添加约束并校验，无错误"},
        ]
    )

    runner = ChatAgentRunner(
        provider=provider,
        project_path="/fake/project",
        context_nodes=[],
        max_iterations=5,
    )

    with (
        patch(
            "app.shared.services.validation.loader.load_file_data",
            return_value=__import__("pandas").DataFrame({"email": ["a@b.com"]}),
        ),
        patch("os.path.isfile", return_value=True),
        patch(
            "builtins.open",
            __import__("unittest.mock", fromlist=["mock_open"]).mock_open(
                read_data="id: users\nsource:\n  path: data/x.csv\n"
            ),
        ),
        patch(
            "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions",
            return_value={"success": True, "results": [{"action": {}, "success": True, "message": "ok"}]},
        ),
        patch(
            "app.shared.services.ai.agent.chat_tools.validate_table.execute_validate_project",
            return_value={"success": True, "message": "ok", "details": {"error_count": 0, "errors": []}},
        ),
    ):
        result = await runner.run("给 email 加唯一约束并校验")

    assert result.success is True
    assert result.iterations == 4


@pytest.mark.asyncio
async def test_runner_handles_agent_failure():
    """Agent 循环失败时返回兜底回复。"""
    provider = FakeProvider(responses=[])
    runner = ChatAgentRunner(provider=provider, project_path="/fake/project", context_nodes=[])

    # 让 executor.run 抛异常
    with patch.object(AgentExecutor, "run", side_effect=RuntimeError("network down")):
        result = await runner.run("test")

    assert result.success is False
    assert "network down" in result.error
    assert result.reply  # 有兜底文本


def test_registry_includes_ask_user_tool():
    """ask_user 工具应被注册为第 6 个 chat tool。

    覆盖 Task 5 的核心契约：_create_registry 必须注册 ask_user，
    使 LLM 在 loop 中途可调用它向用户提问。
    """
    provider = FakeProvider(responses=[])
    runner = ChatAgentRunner(
        provider=provider,
        project_path="/fake/project",
        context_nodes=[],
        job_id="test-ask",
    )

    registry = runner._create_registry()
    definitions = registry.get_definitions()
    names = {d["function"]["name"] for d in definitions}

    # ask_user 已注册
    assert "ask_user" in names
    # 共 6 个工具：read_project/read_table/apply_actions/validate_table/read_canvas/ask_user
    assert len(definitions) == 6


# =============================================================================
# ChatOrchestrator agent_mode 路径分流测试
# =============================================================================


@pytest.mark.asyncio
async def test_orchestrator_agent_mode_true_uses_runner():
    """agent_mode=true 时走 ChatAgentRunner（验证分流到新路径）。"""
    provider = FakeProvider(responses=[])  # orchestrator 不直接调 provider，runner 会 mock
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    # mock ChatAgentRunner.run 返回固定结果
    fake_result = type(
        "FakeRunResult",
        (),
        {
            "reply": "已处理",
            "frontend_instructions": [{"actionType": "X"}],
            "actions": [],
            "tool_steps": [{"tool": "read_project", "label": "读取项目", "turn": 1}],
            "iterations": 2,
            "success": True,
            "error": None,
        },
    )()

    with (
        patch(
            "app.shared.services.llm.providers.create",
            return_value=MagicMock(),
        ),
        patch(
            "app.shared.services.ai.chat_agent_runner.ChatAgentRunner.run",
            return_value=fake_result,
        ),
    ):
        result = await orchestrator.execute_chat(
            message="test",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=True, max_agent_iterations=3),
        )

    assert result.success is True
    assert result.reply == "已处理"
    assert result.frontend_instructions == [{"actionType": "X"}]
    assert result.iterations == 2
    assert len(result.tool_steps) == 1
    assert result.tool_steps[0]["tool"] == "read_project"


@pytest.mark.asyncio
async def test_orchestrator_agent_mode_false_uses_legacy_path():
    """agent_mode=false 时走旧路径（LLM 直接输出 {reply,actions}），不调 runner。"""
    from app.shared.services.llm.providers.base import ChatResponse

    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    # mock 旧路径的 provider（旧路径直接 await provider.chat()，不再走 ChatLLMService）
    class _FakeLegacyProvider:
        async def chat(self, req):
            return ChatResponse(content='{"reply": "有3张表", "actions": []}', model="fake")

    fake_provider = _FakeLegacyProvider()
    with (
        patch("app.shared.services.llm.providers.create", return_value=fake_provider),
        patch(
            "app.shared.services.ai.chat_agent_runner.ChatAgentRunner.run",
            side_effect=AssertionError("agent_mode=false 不应调用 runner"),
        ),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
    ):
        result = await orchestrator.execute_chat(
            message="有哪些表",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False),
        )

    assert result.success is True
    assert result.reply == "有3张表"
    assert result.actions == []


@pytest.mark.asyncio
async def test_orchestrator_legacy_all_invalid_actions_blocked():
    """#5: 旧路径下当所有动作都非法时，必须拒绝执行（不绕过校验写盘）。

    旧逻辑 `if valid_actions:` 在全部非法时（valid_actions==[]）走 else，
    把原始的全部非法动作交给 process_actions 写盘。修复后 has_errors 即拒绝。
    """
    from app.shared.services.llm.providers.base import ChatResponse

    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    # LLM 返回一个引用不存在表的动作（校验必失败）
    class _FakeLegacyProvider:
        async def chat(self, req):
            return ChatResponse(
                content='{"reply": "我将添加约束", "actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull", "tableName": "ghost_table", "targetColumn": "x"}}]}',
                model="fake",
            )

    fake_provider = _FakeLegacyProvider()
    with (
        patch("app.shared.services.llm.providers.create", return_value=fake_provider),
        patch(
            "app.shared.services.ai.chat_agent_runner.ChatAgentRunner.run", side_effect=AssertionError("不应走 runner")
        ),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
        patch("app.shared.services.ai.chat_orchestrator.process_actions") as mock_proc,
    ):
        result = await orchestrator.execute_chat(
            message="给 ghost_table 加约束",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False, skip_action_validation=False),
        )

    # 关键：校验失败 → 拒绝执行，process_actions 不得被调用
    assert result.success is False
    assert "预校验失败" in (result.reply or "") or "预校验失败" in (result.error or "")
    mock_proc.assert_not_called()


@pytest.mark.asyncio
async def test_orchestrator_agent_mode_without_project_falls_back():
    """agent_mode=true 但无 project_path 时回退到旧路径（runner 需要项目路径）。"""
    from app.shared.services.llm.providers.base import ChatResponse

    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    # mock 旧路径的 provider（旧路径直接 await provider.chat()）
    class _FakeLegacyProvider:
        async def chat(self, req):
            return ChatResponse(content='{"reply": "请先打开项目", "actions": []}', model="fake")

    fake_provider = _FakeLegacyProvider()
    with (
        patch("app.shared.services.llm.providers.create", return_value=fake_provider),
        patch(
            "app.shared.services.ai.chat_agent_runner.ChatAgentRunner.run",
            side_effect=AssertionError("无 project_path 不应调用 runner"),
        ),
    ):
        result = await orchestrator.execute_chat(
            message="test",
            project_path=None,
            context_nodes=[],
            options=ChatOptions(agent_mode=True),
        )

    assert result.success is True
    assert result.reply == "请先打开项目"


@pytest.mark.asyncio
async def test_orchestrator_agent_mode_provider_creation_failure():
    """agent_mode=true 时 create() 抛异常（如 openai 未安装）应返回失败结果，而非 502。"""
    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    with patch(
        "app.shared.services.llm.providers.create",
        side_effect=ImportError("openai 未安装，请运行 pip install openai"),
    ):
        result = await orchestrator.execute_chat(
            message="test",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=True, max_agent_iterations=3),
        )

    # 关键断言：异常被捕获，返回失败结果（而非向上抛出导致 502）
    assert result.success is False
    assert result.error is not None
    assert "openai" in result.error or "初始化" in result.error


# =============================================================================
# 回归测试：旧路径不得开子线程/新 event loop（防 "Event loop is closed" 复发）
# =============================================================================
#
# 历史 bug：旧路径经 ChatLLMService.chat() → _run_async() 调用 LLM。
# _run_async 在"已处于 event loop"时，会开 ThreadPoolExecutor 子线程跑 asyncio.run()，
# 导致 httpx 连接池清理任务绑定到子线程的临时 loop，loop 关闭后泄漏
# "Task exception was never retrieved: RuntimeError: Event loop is closed"。
#
# 修复后旧路径直接 await provider.chat()，provider.chat 在调用方所在的同一 event loop
# 上运行。本测试通过在 fake_chat 内捕获运行 loop，断言它与测试 loop 是同一对象——
# 若 bug 复发（开子线程跑 asyncio.run），fake_chat 会在另一个 loop 上执行。


@pytest.mark.asyncio
async def test_orchestrator_legacy_path_runs_in_caller_event_loop():
    """回归：旧路径必须在调用方的 event loop 上直接 await，不得开子线程/新 loop。

    防止 "Event loop is closed" / "Task exception was never retrieved" 复发。
    """
    import asyncio

    from app.shared.services.llm.providers.base import ChatResponse

    # 测试自身运行的 loop —— provider.chat 应当就在这个 loop 上执行
    test_loop = asyncio.get_running_loop()
    captured_loop = {}

    class _FakeLegacyProvider:
        async def chat(self, req):
            captured_loop["loop"] = asyncio.get_running_loop()
            return ChatResponse(content='{"reply": "ok", "actions": []}', model="fake")

    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)
    fake_provider = _FakeLegacyProvider()

    with (
        patch("app.shared.services.llm.providers.create", return_value=fake_provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
    ):
        result = await orchestrator.execute_chat(
            message="test",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False),
        )

    # 功能正确：旧路径正常返回
    assert result.success is True
    assert result.reply == "ok"

    # 核心回归断言：provider.chat 在调用方（测试）的同一 event loop 上执行，
    # 而非子线程 asyncio.run() 创建的临时 loop。
    assert captured_loop.get("loop") is test_loop


# =============================================================================
# _collect_audit_trail 成败提取测试（B3 路径 A：后端 tool_steps 保留成败）
# =============================================================================


def _build_runner_for_audit() -> ChatAgentRunner:
    """构造一个最小可用的 runner,仅用于调用 _collect_audit_trail。

    不跑真实 LLM/工具循环,直接喂手搓的 AgentResult。
    """
    provider = FakeProvider(responses=[])
    return ChatAgentRunner(provider=provider, project_path="/fake/project", context_nodes=[])


def test_collect_audit_trail_extracts_success_status_from_tool_results():
    """tool_steps 应从同序 tool_results 提取 success,而非缺失或恒为成功。"""
    from app.shared.services.ai.agent.types import AgentResult, AgentTurn, ToolCall, ToolResult

    runner = _build_runner_for_audit()
    agent_result = AgentResult(
        success=True,
        turns=[
            AgentTurn(
                turn=1,
                tool_calls=[
                    ToolCall(id="c1", name="read_project", arguments={}),
                    ToolCall(id="c2", name="apply_actions", arguments={"actions": []}),
                ],
                # tool_results 与 tool_calls 同序
                tool_results=[
                    ToolResult(call_id="c1", name="read_project", success=True, observation={"success": True}),
                    ToolResult(call_id="c2", name="apply_actions", success=True, observation={"success": True}),
                ],
            )
        ],
    )

    _executed, tool_steps = runner._collect_audit_trail(agent_result)

    assert len(tool_steps) == 2
    assert tool_steps[0]["status"] == "success"
    assert tool_steps[1]["status"] == "success"


def test_collect_audit_trail_extracts_failed_status_and_error():
    """失败工具应记 status='failed' 并保留 error 原因。"""
    from app.shared.services.ai.agent.types import AgentResult, AgentTurn, ToolCall, ToolResult

    runner = _build_runner_for_audit()
    agent_result = AgentResult(
        success=True,
        turns=[
            AgentTurn(
                turn=1,
                tool_calls=[
                    ToolCall(id="c1", name="read_project", arguments={}),
                    ToolCall(id="c2", name="apply_actions", arguments={"actions": []}),
                ],
                tool_results=[
                    ToolResult(call_id="c1", name="read_project", success=True, observation={}),
                    ToolResult(
                        call_id="c2",
                        name="apply_actions",
                        success=False,
                        observation="",
                        error="Schema 文件不存在",
                    ),
                ],
            )
        ],
    )

    _executed, tool_steps = runner._collect_audit_trail(agent_result)

    assert tool_steps[0]["status"] == "success"
    assert tool_steps[1]["status"] == "failed"
    assert tool_steps[1]["error"] == "Schema 文件不存在"


def test_collect_audit_trail_handles_missing_tool_results_gracefully():
    """tool_results 数量不足时(如 gather 兜底产生的空 ToolResult),缺失项应回退为 success。"""
    from app.shared.services.ai.agent.types import AgentResult, AgentTurn, ToolCall, ToolResult

    runner = _build_runner_for_audit()
    agent_result = AgentResult(
        success=True,
        turns=[
            AgentTurn(
                turn=1,
                tool_calls=[
                    ToolCall(id="c1", name="read_project", arguments={}),
                    ToolCall(id="c2", name="apply_actions", arguments={"actions": []}),
                ],
                # 仅 1 个 result(对应 c1),c2 的 result 缺失
                tool_results=[
                    ToolResult(call_id="c1", name="read_project", success=True, observation={}),
                ],
            )
        ],
    )

    _executed, tool_steps = runner._collect_audit_trail(agent_result)

    assert tool_steps[0]["status"] == "success"
    # 缺失 result 的步骤回退为 success(避免历史/边界数据因缺字段显示未知)
    assert tool_steps[1]["status"] == "success"
    # action_count 仍应正常提取
    assert tool_steps[1]["action_count"] == 0


# =============================================================================
# P2: 系统提示词内容验证
# =============================================================================


def test_agent_system_prompt_contains_constraint_params_table():
    """H-LLM1: agent 模式系统提示词必须含约束参数表（Range/allowedValues 等），
    否则 LLM 会猜测约束参数结构。"""
    from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT

    # 关键片段：每种约束类型的参数说明
    assert "Range" in CHAT_AGENT_SYSTEM_PROMPT
    assert "allowedValues" in CHAT_AGENT_SYSTEM_PROMPT
    assert "toTableId" in CHAT_AGENT_SYSTEM_PROMPT  # ForeignKey 参数
    # Charset/Composite 必须出现在参数表中（H-LLM3 一致性）
    assert "Charset" in CHAT_AGENT_SYSTEM_PROMPT
    assert "Composite" in CHAT_AGENT_SYSTEM_PROMPT


def test_agent_system_prompt_contains_intent_guardrails():
    """H-LLM2: agent 模式系统提示词必须包含防止越界修改的强约束。"""
    from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT

    # 关键 guardrails：只改用户明确要求、不创建无关约束、不照搬示例参数
    assert "只改用户明确要求的资源" in CHAT_AGENT_SYSTEM_PROMPT
    assert "一次只做一个明确修改" in CHAT_AGENT_SYSTEM_PROMPT
    assert "禁止照搬示例参数" in CHAT_AGENT_SYSTEM_PROMPT
    assert '不要把"拖到画布"误用为 ADD_SCHEMA' in CHAT_AGENT_SYSTEM_PROMPT
    # 明确包含 email 格式校验示例，防止 LLM 混淆
    assert "为 email 添加格式校验" in CHAT_AGENT_SYSTEM_PROMPT
    # P2-1：必须包含 intent_scope 填写引导，让 LLM 自报意图范围
    assert "intent_scope" in CHAT_AGENT_SYSTEM_PROMPT
    assert "写动作必填" in CHAT_AGENT_SYSTEM_PROMPT
