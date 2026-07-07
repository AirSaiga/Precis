"""@fileoverview ChatService 单元测试（P4 AI 对话）

验证 ``app.cli.tui.services.ai_service.ChatService`` 的行为：
- ``chat()`` 返回结构正确（reply/actions/tool_steps/error 透传自 orchestrator 结果）
- confirm/ambiguity/progress 回调被注入 ChatOptions 并被 orchestrator 调用
- 回调返回 False 时 service 仍正常透传 orchestrator 的终止结果
- provider 缺失时 ``get_active_provider`` 返回 None
- ``compute_history_budget`` 按 context_window 计算（下限保护）
- ``build_context_nodes`` 复用 CLI 的 build_context_data（读 schemas）

Mock 边界：``AIChatOrchestrator.execute_chat``（AsyncMock）—— service 是它之上的
薄包装，测试只验证 service 的装配与透传，不验证 orchestrator 内部逻辑（那由
shared 层测试覆盖）。
"""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.tui.services.ai_service import (  # noqa: E402
    ChatService,
    build_context_nodes,
    compute_history_budget,
    get_active_provider,
)
from app.shared.services.ai.chat_orchestrator import ChatExecutionResult  # noqa: E402
from app.shared.services.llm.config.models import AIProvider  # noqa: E402


def _make_provider() -> AIProvider:
    """构造测试用 AIProvider（context_window 显式给定，便于预算断言）。"""
    return AIProvider(
        id="test",
        name="test",
        type="openai",
        base_url="http://localhost",
        model="m",
        api_key="k",
        context_window=16000,
    )


def _make_result(
    success: bool = True,
    reply: str = "好的",
    actions: list[dict[str, Any]] | None = None,
    tool_steps: list[dict[str, Any]] | None = None,
    error: str | None = None,
    updated_history: list[dict[str, str]] | None = None,
) -> ChatExecutionResult:
    """构造 orchestrator 返回结果。"""
    return ChatExecutionResult(
        success=success,
        reply=reply,
        actions=actions or [],
        tool_steps=tool_steps or [],
        error=error,
        updated_history=updated_history or [],
    )


@pytest.fixture
def captured_options() -> dict[str, Any]:
    """捕获传给 execute_chat 的 ChatOptions，便于断言回调注入。"""
    return {}


def _patch_orchestrator(result: ChatExecutionResult, captured: dict[str, Any]) -> Any:
    """patch AIChatOrchestrator.execute_chat 为 AsyncMock，记录 options。

    返回 patcher（调用方负责 enter/exit 或用 with）。捕获的 options 存入
    ``captured['options']``，便于测试断言回调被正确注入。
    """

    async def _fake_execute(self, message, project_path, context_nodes, options):  # noqa: ANN001
        captured["options"] = options
        captured["message"] = message
        captured["project_path"] = project_path
        captured["context_nodes"] = context_nodes
        # 模拟 orchestrator 调用注入的回调（验证回调可被调用且返回值被尊重）
        if options.confirm_callback and options.enable_interactive:
            options.confirm_callback(options.history and [{"actionType": "ADD_SCHEMA"}] or [], "reply")
        if options.ambiguity_resolver and options.enable_interactive:
            options.ambiguity_resolver([], project_path or "")
        if options.progress_callback:
            options.progress_callback("llm_calling", "正在调用 AI...", None)
        return result

    return patch(
        "app.cli.tui.services.ai_service.AIChatOrchestrator.execute_chat",
        new=_fake_execute,
    )


# --------------------------------------------------------------------------- #
# chat() 返回结构
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_chat_returns_reply_and_actions():
    """chat() 应把 orchestrator 结果的 reply/actions 透传到返回 dict。"""
    actions = [{"actionType": "ADD_SCHEMA", "schemaSpec": {"name": "users"}}]
    result = _make_result(reply="已创建", actions=actions)
    service = ChatService(_make_provider())

    with _patch_orchestrator(result, {}):
        out = await service.chat("建表", "/proj", [], [])

    assert out["success"] is True
    assert out["reply"] == "已创建"
    assert out["actions"] == actions
    assert out["error"] is None


@pytest.mark.asyncio
async def test_chat_returns_tool_steps():
    """chat() 应透传 agent 模式的 tool_steps（工具轨迹）。"""
    tool_steps = [
        {"tool": "read_project", "label": "读取项目", "status": "success", "action_count": 0},
        {"tool": "apply_actions", "label": "修改配置", "status": "success", "action_count": 1},
    ]
    result = _make_result(reply="done", tool_steps=tool_steps)
    service = ChatService(_make_provider())

    with _patch_orchestrator(result, {}):
        out = await service.chat("go", "/proj", [], [], agent_mode=True)

    assert out["tool_steps"] == tool_steps


@pytest.mark.asyncio
async def test_chat_returns_error_on_failure():
    """orchestrator 失败时 chat() 应返回 success=False 与 error。"""
    result = _make_result(success=False, reply="", error="AI 服务调用失败: boom")
    service = ChatService(_make_provider())

    with _patch_orchestrator(result, {}):
        out = await service.chat("hi", "/proj")

    assert out["success"] is False
    assert out["error"] == "AI 服务调用失败: boom"
    assert out["reply"] == ""


@pytest.mark.asyncio
async def test_chat_passes_message_project_history_context():
    """chat() 应把 message/project_path/history/context_nodes 正确传给 orchestrator。"""
    history = [{"role": "user", "content": "前一轮"}]
    nodes = [{"id": "s1", "type": "schema"}]
    captured: dict[str, Any] = {}
    result = _make_result()
    service = ChatService(_make_provider())

    with _patch_orchestrator(result, captured):
        await service.chat("继续", "/proj/x", history, nodes)

    assert captured["message"] == "继续"
    assert captured["project_path"] == "/proj/x"
    assert captured["context_nodes"] == nodes
    assert captured["options"].history == history


# --------------------------------------------------------------------------- #
# 回调注入
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_confirm_callback_injected_into_options():
    """on_confirm 应作为 confirm_callback 注入 ChatOptions。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())
    called: list[tuple] = []
    service_cb = lambda actions, reply: called.append((actions, reply)) or True  # noqa: E731

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [], on_confirm=service_cb)

    assert captured["options"].confirm_callback is service_cb
    assert captured["options"].enable_interactive is True


@pytest.mark.asyncio
async def test_ambiguity_callback_injected_into_options():
    """on_ambiguity 应作为 ambiguity_resolver 注入 ChatOptions。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())
    ambi = lambda actions, path: True  # noqa: E731

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [], on_ambiguity=ambi)

    assert captured["options"].ambiguity_resolver is ambi
    assert captured["options"].enable_interactive is True


@pytest.mark.asyncio
async def test_progress_callback_injected_and_called():
    """on_progress 应作为 progress_callback 注入并被 orchestrator 调用。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())
    progress: list[tuple] = []
    prog_cb = lambda stage, msg, data=None: progress.append((stage, msg, data))  # noqa: E731

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [], on_progress=prog_cb)

    assert captured["options"].progress_callback is prog_cb
    # _patch_orchestrator 内模拟 orchestrator 调用了一次 progress_callback
    assert progress and progress[0][0] == "llm_calling"
    assert progress[0][1] == "正在调用 AI..."


@pytest.mark.asyncio
async def test_no_callbacks_disables_interactive():
    """未传任何交互回调时 enable_interactive 应为 False（orchestrator 不弹交互）。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [])

    assert captured["options"].confirm_callback is None
    assert captured["options"].ambiguity_resolver is None
    assert captured["options"].enable_interactive is False


@pytest.mark.asyncio
async def test_confirm_callback_returning_false_propagates():
    """confirm 回调返回 False 时，service 应透传 orchestrator 的终止结果。

    用真实 orchestrator 路径验证：mock execute_chat 返回一个"未执行"的结果
    （模拟 orchestrator 在 confirm=False 时的行为），service 应原样透传。
    """
    result = _make_result(success=True, reply="已取消", actions=[])
    service = ChatService(_make_provider())

    async def _execute_returning(self, message, project_path, context_nodes, options):  # noqa: ANN001
        # 模拟 orchestrator：confirm 返回 False → 直接返回未执行结果
        if options.confirm_callback:
            options.confirm_callback([], result.reply)
        return result

    with patch(
        "app.cli.tui.services.ai_service.AIChatOrchestrator.execute_chat",
        new=_execute_returning,
    ):
        out = await service.chat("m", "/p", [], [], on_confirm=lambda a, r: False)

    assert out["success"] is True
    assert out["reply"] == "已取消"
    assert out["actions"] == []


# --------------------------------------------------------------------------- #
# agent_mode 与历史预算
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_agent_mode_passed_to_options():
    """agent_mode 应透传到 ChatOptions.agent_mode。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [], agent_mode=False)

    assert captured["options"].agent_mode is False


@pytest.mark.asyncio
async def test_default_agent_mode_is_true():
    """默认 agent_mode 应为 True（与 CLI 一致）。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [])

    assert captured["options"].agent_mode is True


def test_compute_history_budget_uses_context_window():
    """history budget = context_window - RESERVED_OUTPUT_TOKENS。"""
    provider = _make_provider()  # context_window=16000
    # RESERVED_OUTPUT_TOKENS=8000 → 16000-8000=8000
    assert compute_history_budget(provider) == 8000


def test_compute_history_budget_enforces_minimum():
    """context_window 过小时应回退到 MIN_HISTORY_TOKENS=4096 下限。"""
    provider = AIProvider(
        id="t",
        name="t",
        type="openai",
        base_url="http://x",
        model="m",
        api_key="k",
        context_window=4096,  # 4096-8000 < 4096 → 取 4096
    )
    assert compute_history_budget(provider) == 4096


@pytest.mark.asyncio
async def test_explicit_max_history_tokens_used():
    """显式传入 max_history_tokens 时应覆盖自动计算。"""
    captured: dict[str, Any] = {}
    service = ChatService(_make_provider())

    with _patch_orchestrator(_make_result(), captured):
        await service.chat("m", "/p", [], [], max_history_tokens=12345)

    assert captured["options"].max_history_tokens == 12345


# --------------------------------------------------------------------------- #
# get_active_provider
# --------------------------------------------------------------------------- #


def test_get_active_provider_returns_none_when_unconfigured(monkeypatch):
    """无 provider 配置时 get_active_provider 返回 None。"""
    fake_storage = MagicMock()
    fake_storage.get_active_provider.return_value = None
    monkeypatch.setattr("app.cli.shell.config_storage.get_cli_config", lambda: fake_storage)

    assert get_active_provider() is None


def test_get_active_provider_returns_provider(monkeypatch):
    """有配置时 get_active_provider 返回当前活动 provider。"""
    provider = _make_provider()
    fake_storage = MagicMock()
    fake_storage.get_active_provider.return_value = provider
    monkeypatch.setattr("app.cli.shell.config_storage.get_cli_config", lambda: fake_storage)

    assert get_active_provider() is provider


# --------------------------------------------------------------------------- #
# build_context_nodes
# --------------------------------------------------------------------------- #


def test_build_context_nodes_reads_schemas(tmp_path, monkeypatch):
    """build_context_nodes 应复用 CLI 的 build_context_data 读 schemas/*.yaml。"""
    # 构造一个含一张表的 schema 文件
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text(
        "name: users\nid: tbl_users\ncolumns:\n  - name: id\n    id: col_id\n",
        encoding="utf-8",
    )

    nodes = build_context_nodes("建表", str(tmp_path))

    assert len(nodes) == 1
    node = nodes[0]
    assert node["type"] == "schema"
    assert node["id"] == "tbl_users"
    assert node["data"]["label"] == "users"
    assert node["data"]["columns"] == [{"id": "col_id", "name": "id"}]


def test_build_context_nodes_empty_when_no_schemas(tmp_path):
    """无 schemas 目录时返回空列表（不抛异常）。"""
    nodes = build_context_nodes("hi", str(tmp_path))
    assert nodes == []


def test_build_context_nodes_empty_when_no_project():
    """project_path 为 None 时返回空列表。"""
    assert build_context_nodes("hi", None) == []


# --------------------------------------------------------------------------- #
# orchestrator 被正确构造（service 持有 provider）
# --------------------------------------------------------------------------- #


def test_service_holds_provider():
    """ChatService 应把传入的 provider 绑定到内部 orchestrator。"""
    provider = _make_provider()
    service = ChatService(provider)
    assert service._provider is provider
    assert service._orchestrator is not None
