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
"""@fileoverview 无画布环境（canvas_enabled=False）隔离测试

CLI（precis ai）没有画布，画布语义不得从三条通道泄漏：
1. 工具通道：read_canvas 不注册（工具面 9→8）
2. 动作通道：apply_actions 工具定义剔除 canvas 类动作与画布话术，
   ADD_TO_CANVAS 在预验证层被拦截（可读原因回灌 LLM）且不产生 frontend_instructions 信封
3. 提示词通道：agent / legacy JSON 两条路径的系统提示词均无画布字样

同时锁定 canvas_enabled=True（GUI / TUI 默认）的现状零回归：
默认注册表 9 工具、enum 全量、提示词含画布段落。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyActionsTool
from app.shared.services.ai.chat_agent_runner import (
    CHAT_AGENT_SYSTEM_PROMPT,
    ChatAgentRunner,
    build_chat_agent_system_prompt,
)
from app.shared.services.ai.chat_orchestrator import (
    AIChatOrchestrator,
    ChatExecutionResult,
    ChatOptions,
)
from app.shared.services.llm.actions import registry
from app.shared.services.llm.actions.action_validator import ActionValidator
from app.shared.services.llm.chat.chat_system_prompt import (
    SYSTEM_PROMPT_CORE,
    build_json_format_prompt,
    build_system_prompt,
    build_system_prompt_core,
)
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import ChatRequest, ChatResponse

# =============================================================================
# Factory / 守卫断言
# =============================================================================

# 画布语义泄漏检查词：无画布变体中任何一个出现即失败
_CANVAS_WORDS = ("画布", "ADD_TO_CANVAS", "read_canvas", "canvasSpec")


def assert_no_canvas_wording(text: str) -> None:
    """断言文本不含任何画布语义字样（提示词/工具定义共用的守卫断言）。"""
    for word in _CANVAS_WORDS:
        assert word not in text, f"无画布变体不应包含画布字样 {word!r}"


def make_provider_config() -> AIProvider:
    """构造最小 AIProvider 配置（仅用于编排器初始化，不发起真实调用）。"""
    return AIProvider(
        id="fake",
        name="Fake",
        type=ProviderType.OPENAI,
        base_url="http://localhost",
        api_key="",
        model="fake",
    )


def make_runner(canvas_enabled: bool) -> ChatAgentRunner:
    """构造最小 runner（provider mock，不跑真实 LLM 循环）。"""
    return ChatAgentRunner(
        provider=MagicMock(),
        project_path="/fake/project",
        context_nodes=[],
        canvas_enabled=canvas_enabled,
    )


def make_canvas_workspace(tmp_path) -> str:
    """构造含真实 schema 文件的临时项目目录，供 canvas 动作拦截/放行测试。"""
    ws = tmp_path / "project"
    ws.mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: test\n  name: Test\nschemas: []\n", encoding="utf-8"
    )
    schemas_dir = ws / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text(
        "id: sc_users\nname: users\ncolumns:\n  - id: col_email\n    name: email\n    type: string\n",
        encoding="utf-8",
    )
    return str(ws)


def make_canvas_action() -> dict[str, Any]:
    """构造一个目标资源真实存在的 ADD_TO_CANVAS 动作（有画布时本应放行）。"""
    return {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"},
    }


def make_legacy_context() -> dict[str, Any]:
    """构造 legacy 提示词构建的最小上下文数据。"""
    return {
        "message": "hi",
        "context": {"hasContext": False, "selectedNodes": []},
        "projectOverview": {},
    }


class _LegacyJsonProvider:
    """legacy 路径假 Provider：可选捕获系统提示词，返回固定 {reply, actions} JSON。"""

    def __init__(self, content: str = '{"reply": "ok", "actions": []}'):
        self._content = content
        self.system_prompt = ""

    async def chat(self, req: ChatRequest) -> ChatResponse:
        self.system_prompt = req.messages[0].content
        return ChatResponse(content=self._content, model="fake")


# =============================================================================
# 提示词通道：registry 派生文本
# =============================================================================


def test_filter_action_types_excludes_canvas_by_category():
    """filter_action_types 按 category 排除（不硬编码动作名），缺省全量。"""
    excluded = registry.filter_action_types(exclude_categories={"canvas"})
    assert "ADD_TO_CANVAS" not in excluded
    # 排除集与全量集合互补（不多不少）
    assert set(excluded) | set(registry.CANVAS_ACTION_TYPES) == set(registry.ALL_ACTION_TYPES)
    # 缺省全量（默认行为不变）
    assert registry.filter_action_types() == registry.ALL_ACTION_TYPES


def test_action_list_text_without_canvas_omits_canvas_actions():
    """动作清单排除 canvas 后无 ADD_TO_CANVAS 与画布话术；默认变体保留。"""
    text = registry.build_action_type_list_text(exclude_categories={"canvas"})
    assert "ADD_TO_CANVAS" not in text
    assert "显示到画布" not in text
    # 默认变体回归锁定
    assert "ADD_TO_CANVAS" in registry.build_action_type_list_text()


def test_spec_field_mapping_without_canvas_omits_canvas_spec():
    """spec 映射排除 canvas 后无 canvasSpec 行；默认变体保留。"""
    text = registry.build_spec_field_mapping_text(exclude_categories={"canvas"})
    assert "canvasSpec" not in text
    assert "canvasSpec" in registry.build_spec_field_mapping_text()


def test_canvas_action_types_derived_from_registry_category():
    """CANVAS_ACTION_TYPES 别名与 BY_CATEGORY['canvas'] 单一事实源一致。"""
    assert registry.CANVAS_ACTION_TYPES == registry.BY_CATEGORY["canvas"]


# =============================================================================
# 提示词通道：legacy JSON 直出路径
# =============================================================================


def test_prompt_constants_default_to_canvas_enabled_variants():
    """模块常量保持有画布默认（既有导入方零回归），构建器 False 变体无画布字样。"""
    assert SYSTEM_PROMPT_CORE == build_system_prompt_core(True)
    assert "把 users 表拖到画布" in SYSTEM_PROMPT_CORE
    assert_no_canvas_wording(build_system_prompt_core(False))
    assert "ADD_TO_CANVAS" in build_json_format_prompt(True)
    assert_no_canvas_wording(build_json_format_prompt(False))


def test_legacy_prompt_default_contains_canvas_wording():
    """legacy 提示词默认含画布 Q&A 与 ADD_TO_CANVAS 动作说明（GUI 零回归）。"""
    prompt = build_system_prompt(make_legacy_context())
    assert "把 users 表拖到画布" in prompt
    assert "ADD_TO_CANVAS" in prompt


def test_legacy_prompt_without_canvas_has_no_canvas_wording():
    """legacy 提示词无画布变体：无任何画布字样，共享基底其余内容不受影响。"""
    prompt = build_system_prompt(make_legacy_context(), canvas_enabled=False)
    assert_no_canvas_wording(prompt)
    # 共享基底核心内容保持（约束类型 / regex_nodes 特征字样不受隔离影响）
    assert "NotNull" in prompt
    assert "regex_nodes" in prompt


# =============================================================================
# 提示词通道：agent 路径
# =============================================================================


def test_agent_prompt_default_contains_canvas_sections():
    """默认（有画布）agent 提示词保留全部画布段落——GUI 路径零回归。"""
    assert "### 7. read_canvas" in CHAT_AGENT_SYSTEM_PROMPT
    assert "## ADD_TO_CANVAS vs ADD_* 的关键区分" in CHAT_AGENT_SYSTEM_PROMPT
    assert "你有以下 9 个工具可用" in CHAT_AGENT_SYSTEM_PROMPT
    assert f"（{registry.ACTION_COUNT}种）" in CHAT_AGENT_SYSTEM_PROMPT


def test_agent_prompt_without_canvas_has_no_canvas_wording():
    """agent 提示词无画布变体：无画布字样，工具数/小节编号/动作计数同步收紧。"""
    prompt = build_chat_agent_system_prompt(canvas_enabled=False)
    assert_no_canvas_wording(prompt)
    # read_canvas 节缺失后 read_config_file 前移为 §7，工具数 9→8
    assert "你有以下 8 个工具可用" in prompt
    assert "### 7. read_config_file" in prompt
    # 动作计数与过滤后清单同源收紧（当前 15-1=14，由注册表推导而非硬编码）
    assert f"（{registry.ACTION_COUNT - len(registry.CANVAS_ACTION_TYPES)}种）" in prompt


def test_runner_system_prompt_follows_canvas_flag():
    """runner 实例的系统提示词按 canvas_enabled 取对应变体。"""
    assert_no_canvas_wording(make_runner(canvas_enabled=False).system_prompt)
    assert "### 7. read_canvas" in make_runner(canvas_enabled=True).system_prompt


# =============================================================================
# 工具通道：read_canvas 注册
# =============================================================================


def test_runner_registry_default_keeps_nine_tools_with_read_canvas():
    """默认注册表 9 工具含 read_canvas（GUI 零回归）。"""
    definitions = make_runner(canvas_enabled=True)._create_registry().get_definitions()
    names = {d["function"]["name"] for d in definitions}
    assert len(definitions) == 9
    assert "read_canvas" in names


def test_runner_registry_without_canvas_omits_read_canvas():
    """无画布注册表 8 工具，read_canvas 不出现。"""
    definitions = make_runner(canvas_enabled=False)._create_registry().get_definitions()
    names = {d["function"]["name"] for d in definitions}
    assert "read_canvas" not in names
    assert len(definitions) == 8


# =============================================================================
# 动作通道：apply_actions 工具定义
# =============================================================================


def test_apply_actions_definition_default_keeps_canvas_actions():
    """默认工具定义：enum 全量含 ADD_TO_CANVAS，描述含 canvasSpec 引导（GUI 零回归）。"""
    tool = ApplyActionsTool(project_path="/fake", collected_instructions=[])
    definition = tool.get_definition()
    enum_values = definition["function"]["parameters"]["properties"]["actions"]["items"]["properties"]["actionType"][
        "enum"
    ]
    assert "ADD_TO_CANVAS" in enum_values
    assert len(enum_values) == registry.ACTION_COUNT
    assert "canvasSpec" in str(definition)


def test_apply_actions_definition_without_canvas_excludes_canvas_wording():
    """无画布工具定义：enum 无 canvas 类动作、计数收紧、描述无任何画布话术。"""
    tool = ApplyActionsTool(project_path="/fake", collected_instructions=[], canvas_enabled=False)
    definition = tool.get_definition()
    action_type_schema = definition["function"]["parameters"]["properties"]["actions"]["items"]["properties"][
        "actionType"
    ]
    enum_values = action_type_schema["enum"]
    assert "ADD_TO_CANVAS" not in enum_values
    assert len(enum_values) == registry.ACTION_COUNT - len(registry.CANVAS_ACTION_TYPES)
    assert f"{len(enum_values)} 种" in action_type_schema["description"]
    # 顶层 description 与 actions 参数描述均无画布话术
    assert_no_canvas_wording(definition["function"]["description"])
    assert_no_canvas_wording(definition["function"]["parameters"]["properties"]["actions"]["description"])


# =============================================================================
# 动作通道：ADD_TO_CANVAS 拦截（校验层 + 执行层）
# =============================================================================


def test_validator_without_canvas_rejects_add_to_canvas_with_readable_error(tmp_path):
    """无画布校验器对真实存在的资源也拒绝 ADD_TO_CANVAS，错误可读且带改用建议。"""
    ws = make_canvas_workspace(tmp_path)
    result = ActionValidator(ws, canvas_enabled=False).validate([make_canvas_action()])

    assert result.has_errors
    err = result.errors[0]
    assert err.error_type == "canvas_unavailable"
    assert "当前环境无画布" in err.message
    assert err.suggestion  # 建议非空，LLM 可据此改用查询/写动作


def test_validator_with_canvas_still_accepts_existing_resource(tmp_path):
    """对照：有画布（默认）时同一动作对已存在资源放行——GUI 零回归。"""
    ws = make_canvas_workspace(tmp_path)
    result = ActionValidator(ws).validate([make_canvas_action()])

    assert not result.has_errors


@pytest.mark.asyncio
async def test_apply_actions_without_canvas_rejects_canvas_action_without_envelope(tmp_path):
    """无画布 apply_actions：ADD_TO_CANVAS 整批拒绝，错误含"无画布"原因，不产信封不执行。"""
    ws = make_canvas_workspace(tmp_path)
    collected: list[Any] = []
    tool = ApplyActionsTool(project_path=ws, collected_instructions=collected, canvas_enabled=False)

    with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
        result = await tool.run({"actions": [make_canvas_action()]})

    assert result["success"] is False
    assert "当前环境无画布" in result["error"]
    assert collected == []  # 无 frontend_instructions 信封
    mock_proc.assert_not_called()  # 执行层未触碰（不写盘、不生成指令）


@pytest.mark.asyncio
async def test_apply_actions_with_canvas_still_collects_canvas_envelope(tmp_path):
    """对照：有画布（默认）时同一动作正常执行并旁路收集信封——GUI 零回归。"""
    ws = make_canvas_workspace(tmp_path)
    collected: list[Any] = []
    tool = ApplyActionsTool(project_path=ws, collected_instructions=collected)

    result = await tool.run({"actions": [make_canvas_action()]})

    assert result["success"] is True
    assert len(collected) == 1


# =============================================================================
# 工具轨迹：画布标签只在有画布环境出现
# =============================================================================


def test_audit_trail_canvas_label_only_when_canvas_enabled():
    """ "显示到画布"轨迹标签仅在有画布环境出现；无画布时 canvas 批次回退通用"查询操作"。"""
    from app.shared.services.ai.agent.types import AgentResult, AgentTurn, ToolCall, ToolResult

    def _collect_labels(canvas_enabled: bool) -> list[str]:
        runner = make_runner(canvas_enabled)
        agent_result = AgentResult(
            success=True,
            turns=[
                AgentTurn(
                    turn=1,
                    tool_calls=[
                        ToolCall(
                            id="c1",
                            name="apply_actions",
                            arguments={"actions": [make_canvas_action()]},
                        )
                    ],
                    tool_results=[
                        ToolResult(
                            call_id="c1",
                            name="apply_actions",
                            success=False,
                            observation={},
                            error="当前环境无画布，该动作不可用",
                        )
                    ],
                )
            ],
        )
        _executed, tool_steps = runner._collect_audit_trail(agent_result)
        return [s["label"] for s in tool_steps]

    assert _collect_labels(True) == ["显示到画布"]
    assert _collect_labels(False) == ["查询操作"]


# =============================================================================
# 开关透传：ChatOptions → ChatAgentRunner / legacy 提示词
# =============================================================================


def test_chat_options_canvas_enabled_defaults_true():
    """ChatOptions 缺省 canvas_enabled=True（GUI/TUI 走 HTTP 无需显式传参）。"""
    assert ChatOptions().canvas_enabled is True


def _make_run_result() -> Any:
    """构造 ChatAgentRunner.run 的最小返回对象（duck-typed，同 test_chat_agent_runner 模式）。"""
    return type(
        "FakeRunResult",
        (),
        {
            "reply": "已处理",
            "frontend_instructions": [],
            "actions": [],
            "tool_steps": [],
            "iterations": 1,
            "success": True,
            "error": None,
        },
    )()


@pytest.mark.asyncio
@pytest.mark.parametrize("canvas_enabled,expected", [(False, False), (True, True)])
async def test_orchestrator_passes_canvas_flag_to_runner(canvas_enabled: bool, expected: bool):
    """agent 路径：ChatOptions.canvas_enabled 原样透传到 ChatAgentRunner 构造。"""
    orchestrator = AIChatOrchestrator(provider=make_provider_config())
    fake_runner = MagicMock()
    fake_runner.run = AsyncMock(return_value=_make_run_result())

    with (
        patch("app.shared.services.llm.providers.create", return_value=MagicMock()),
        patch(
            "app.shared.services.ai.chat_agent_runner.ChatAgentRunner",
            return_value=fake_runner,
        ) as mock_runner_cls,
    ):
        await orchestrator.execute_chat(
            message="有哪些表",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=True, canvas_enabled=canvas_enabled),
        )

    assert mock_runner_cls.call_args.kwargs["canvas_enabled"] is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("canvas_enabled,expect_canvas", [(False, False), (True, True)])
async def test_orchestrator_legacy_prompt_follows_canvas_flag(canvas_enabled: bool, expect_canvas: bool):
    """legacy 路径：系统提示词按 canvas_enabled 取对应变体（发给 LLM 的首条消息）。"""
    provider = _LegacyJsonProvider()
    orchestrator = AIChatOrchestrator(provider=make_provider_config())

    with (
        patch("app.shared.services.llm.providers.create", return_value=provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
    ):
        await orchestrator.execute_chat(
            message="有哪些表",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False, canvas_enabled=canvas_enabled, max_history_tokens=512),
        )

    assert ("画布" in provider.system_prompt) is expect_canvas
    assert ("ADD_TO_CANVAS" in provider.system_prompt) is expect_canvas


# =============================================================================
# 开关透传：legacy 执行链守卫
# =============================================================================


@pytest.mark.asyncio
async def test_orchestrator_process_actions_guard_blocks_canvas_action_without_canvas():
    """无画布 legacy 路径：canvas 动作在执行前被拒（兜底 skip_action_validation 直通入口），
    不写盘、不生成前端信封。"""
    provider = _LegacyJsonProvider(
        '{"reply": "我将显示到画布", "actions": ['
        '{"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceId": "users"}}]}'
    )
    orchestrator = AIChatOrchestrator(provider=make_provider_config())

    with (
        patch("app.shared.services.llm.providers.create", return_value=provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
        patch("app.shared.services.ai.chat_orchestrator.process_actions") as mock_proc,
    ):
        result = await orchestrator.execute_chat(
            message="把 users 拖到画布",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False, canvas_enabled=False, skip_action_validation=True),
        )

    assert result.success is False
    assert "当前环境无画布" in (result.error or "")
    assert result.frontend_instructions == []
    mock_proc.assert_not_called()


@pytest.mark.asyncio
async def test_orchestrator_process_actions_guard_does_not_affect_canvas_enabled():
    """对照：canvas_enabled=True 时画布守卫不触发（走原有 fail-closed 确认门语义）。"""
    provider = _LegacyJsonProvider(
        '{"reply": "我将显示到画布", "actions": ['
        '{"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceId": "users"}}]}'
    )
    orchestrator = AIChatOrchestrator(provider=make_provider_config())

    with (
        patch("app.shared.services.llm.providers.create", return_value=provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
        patch("app.shared.services.ai.chat_orchestrator.process_actions") as mock_proc,
    ):
        result = await orchestrator.execute_chat(
            message="把 users 拖到画布",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False, skip_action_validation=True),
        )

    # 默认（有画布）不被画布守卫拦截：非交互环境落在 fail-closed 确认门
    assert "当前环境无画布" not in (result.error or "")
    assert result.success is False
    assert "无确认门" in (result.error or "")
    mock_proc.assert_not_called()


@pytest.mark.asyncio
async def test_canvas_action_rejection_skips_confirm_box_without_canvas():
    """无画布 legacy 交互路径：canvas 动作的拒绝先于确认框——CLI 用户不会看到"显示到画布"话术。"""
    provider = _LegacyJsonProvider(
        '{"reply": "我将显示", "actions": ['
        '{"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceId": "users"}}]}'
    )
    orchestrator = AIChatOrchestrator(provider=make_provider_config())
    confirm_callback = MagicMock(return_value=True)

    with (
        patch("app.shared.services.llm.providers.create", return_value=provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
    ):
        result = await orchestrator.execute_chat(
            message="把 users 拖到画布",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(
                agent_mode=False,
                canvas_enabled=False,
                enable_interactive=True,
                confirm_callback=confirm_callback,
                max_history_tokens=512,
            ),
        )

    assert result.success is False
    assert "当前环境无画布" in (result.error or "")
    # 拒绝发生在确认门之前：确认框（含画布话术）不出现
    confirm_callback.assert_not_called()


@pytest.mark.asyncio
async def test_validation_errors_skip_confirm_box_before_user_prompt():
    """预校验失败的批次不再先弹确认框：用户直接看到拒绝原因，不为注定失败的批次确认。"""
    provider = _LegacyJsonProvider(
        '{"reply": "我将添加约束", "actions": ['
        '{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {'
        '"type": "NotNull", "tableName": "ghost_table", "targetColumn": "x"}}]}'
    )
    orchestrator = AIChatOrchestrator(provider=make_provider_config())
    confirm_callback = MagicMock(return_value=True)

    with (
        patch("app.shared.services.llm.providers.create", return_value=provider),
        patch(
            "app.shared.services.ai.utils.get_project_overview",
            return_value={"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}},
        ),
    ):
        result = await orchestrator.execute_chat(
            message="给 ghost_table 加约束",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(
                agent_mode=False,
                enable_interactive=True,
                confirm_callback=confirm_callback,
                max_history_tokens=512,
            ),
        )

    assert result.success is False
    confirm_callback.assert_not_called()


# =============================================================================
# CLI 接线：execute_ai_chat 构造 ChatOptions
# =============================================================================


def test_cli_execute_ai_chat_sets_canvas_enabled_false(tmp_path):
    """CLI 执行器构造 ChatOptions 时显式关画布——CLI 用户路径的隔离接线保障。"""
    from app.cli.shell.commands.ai import executor as ai_executor
    from app.cli.shell.commands.ai.executor import execute_ai_chat
    from app.cli.shell.commands.base import ProjectContext

    context = ProjectContext()
    context.project_path = str(tmp_path)

    captured: dict[str, Any] = {}
    fake_orchestrator = MagicMock()

    async def fake_execute_chat(**kwargs: Any) -> ChatExecutionResult:
        captured.update(kwargs)
        return ChatExecutionResult(success=True, reply="ok")

    fake_orchestrator.execute_chat = fake_execute_chat
    fake_cfg = make_provider_config()

    with (
        patch.object(ai_executor, "_get_provider_display", return_value=fake_cfg),
        patch.object(ai_executor, "_get_provider_with_key", return_value=fake_cfg),
        patch.object(ai_executor, "resolve_context_window", return_value=128000),
        patch.object(ai_executor, "AIChatOrchestrator", return_value=fake_orchestrator),
        patch(
            "app.cli.shell.commands.ai.interaction.build_context_data",
            return_value={
                "message": "有哪些表",
                "context": {"hasContext": False, "selectedNodes": []},
                "projectOverview": {},
            },
        ),
    ):
        result = execute_ai_chat("有哪些表", context, interactive=False)

    assert result.success
    options = captured["options"]
    assert isinstance(options, ChatOptions)
    # CLI 无画布：agent 与 legacy 两条路径共用此开关
    assert options.canvas_enabled is False
