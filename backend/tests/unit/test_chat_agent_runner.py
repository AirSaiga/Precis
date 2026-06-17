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
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse

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

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[str]:
        yield ""

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
    """修改路径：apply_actions 后收尾，frontend_instructions 正确旁路累积。"""
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
    )

    process_result = {
        "success": True,
        "results": [
            {
                "action": {"actionType": "ADD_CONSTRAINT_NODE"},
                "success": True,
                "message": "ok",
                "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull"}},
            }
        ],
    }

    with patch(
        "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions",
        return_value=process_result,
    ):
        result = await runner.run("给 email 加非空约束")

    assert result.success is True
    assert "非空" in result.reply
    # 关键断言：frontend_instructions 被旁路累积到结果
    assert len(result.frontend_instructions) == 1
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
    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    # mock 旧路径的 ChatLLMService，避免真实 HTTP 请求
    fake_chat_service = type(
        "FakeChatService", (), {"chat": lambda self, messages, temperature=None: '{"reply": "有3张表", "actions": []}'}
    )()
    with (
        patch.object(orchestrator, "_get_chat_service", return_value=fake_chat_service),
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
async def test_orchestrator_agent_mode_without_project_falls_back():
    """agent_mode=true 但无 project_path 时回退到旧路径（runner 需要项目路径）。"""
    provider = FakeProvider(responses=[])
    orchestrator = AIChatOrchestrator(provider=provider.cfg)

    fake_chat_service = type(
        "FakeChatService",
        (),
        {"chat": lambda self, messages, temperature=None: '{"reply": "请先打开项目", "actions": []}'},
    )()
    with (
        patch.object(orchestrator, "_get_chat_service", return_value=fake_chat_service),
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
