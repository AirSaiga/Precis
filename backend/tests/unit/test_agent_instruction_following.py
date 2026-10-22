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
"""@fileoverview AI Agent 指令遵循强化测试

指令遵循 = 提示词"教"的与校验器"罚"的必须一致 + 执行器对不合规 LLM 行为有确定性处置。
三个维度：
- 提示词-校验器-注册表三方契约：系统提示词列出的每个动作/约束类型，校验器必须受理；
  未教过的动作（幻觉 actionType）必须被拒；有画布/无画布两态计数与清单一致
- 执行器对不合规 LLM 输出的强制：畸形 tool_call 条目、流式整体僵死超时、
  checkpoint 回调异常、空轮次续跑——不崩溃且有可观测的错误回灌
- 指令上下文渲染质量：legacy 聊天提示词的项目概览/选中节点/用户需求渲染不丢信息
  （上下文丢信息 = LLM 无法遵循指令）
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator

import pytest

from app.shared.services.ai.agent.executor import (
    AgentExecutor,
    _cross_turn_signature,
    _tool_call_signature,
)
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.agent.types import AgentResult
from app.shared.services.llm.actions.registry import (
    ACTION_COUNT,
    ALL_ACTION_TYPES,
    CANVAS_ACTION_TYPES,
    CONSTRAINT_TYPES,
    SPEC_FIELD_FOR,
)
from app.shared.services.llm.chat.response_parser import ActionParser

# =============================================================================
# 维度一：提示词-校验器-注册表三方契约
# =============================================================================


def _minimal_action(action_type: str) -> dict:
    """按注册表构造某动作类型的最小合法形态（spec 字段与内容按类型补齐）。"""
    action: dict = {"actionType": action_type}
    spec_field = SPEC_FIELD_FOR.get(action_type)
    if action_type in ("VALIDATE_PROJECT", "UPDATE_SETTINGS"):
        return action  # spec 可选（校验可不带 tableName，设置可空壳）
    if spec_field is None:
        return action
    if spec_field == "constraintSpec":
        action[spec_field] = {"type": "NotNull"}
    else:
        action[spec_field] = {}
    return action


def _canvas_prompt() -> str:
    from app.shared.services.ai.chat_agent_runner import build_chat_agent_system_prompt

    return build_chat_agent_system_prompt(canvas_enabled=True)


def _cli_prompt() -> str:
    from app.shared.services.ai.chat_agent_runner import build_chat_agent_system_prompt

    return build_chat_agent_system_prompt(canvas_enabled=False)


class TestPromptValidatorContract:
    """教学（提示词）与执法（校验器）一致性——漂移会让"照提示词办事的 LLM"被误拒。"""

    def test_every_registry_action_taught_and_accepted(self):
        """注册表的每个动作：提示词必须教、校验器必须受理（最小合法形态）。"""
        prompt = _canvas_prompt()
        for action_type in ALL_ACTION_TYPES:
            assert action_type in prompt, f"提示词未教动作 {action_type}"
            assert ActionParser._validate_action(_minimal_action(action_type)) is True, (
                f"校验器拒绝提示词所教动作 {action_type}"
            )

    def test_canvas_prompt_claimed_count_matches_registry(self):
        match = re.search(r"actionType 可选值（(\d+)种）", _canvas_prompt())
        assert match is not None, "提示词必须声明动作数量"
        assert int(match.group(1)) == ACTION_COUNT

    def test_cli_prompt_omits_canvas_actions(self):
        prompt = _cli_prompt()
        for action_type in CANVAS_ACTION_TYPES:
            assert action_type not in prompt, f"无画布提示词泄漏画布动作 {action_type}"
        for action_type in ALL_ACTION_TYPES:
            if action_type not in CANVAS_ACTION_TYPES:
                assert action_type in prompt, f"无画布提示词漏教非画布动作 {action_type}"

    def test_cli_prompt_claimed_count_excludes_canvas(self):
        match = re.search(r"actionType 可选值（(\d+)种）", _cli_prompt())
        assert match is not None
        assert int(match.group(1)) == ACTION_COUNT - len(CANVAS_ACTION_TYPES)

    def test_all_constraint_types_taught_and_accepted(self):
        """10 种约束类型：提示词参数文档必须覆盖、校验器必须受理。"""
        prompt = _canvas_prompt()
        for ctype in CONSTRAINT_TYPES:
            assert ctype in prompt, f"提示词未教约束类型 {ctype}"
            ok = ActionParser._validate_action({"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": ctype}})
            assert ok is True, f"校验器拒绝约束类型 {ctype}"

    def test_fabricated_action_types_rejected(self):
        """幻觉动作（提示词从未教过的 actionType）必须被校验器拒绝。"""
        for fabricated in ["ADD_INDEX", "DROP_TABLE", "add_schema", "EXECUTE_SQL", "ADD_CONSTRAINT"]:
            assert ActionParser._validate_action({"actionType": fabricated}) is False

    def test_apply_actions_enum_matches_prompt_action_set(self):
        """apply_actions 工具 schema 的 enum 与注册表派生集一致（两态）。"""
        from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyActionsTool
        from app.shared.services.llm.actions.registry import filter_action_types

        for canvas_enabled in (True, False):
            tool = ApplyActionsTool(project_path="/fake", collected_instructions=[], canvas_enabled=canvas_enabled)
            params = tool.get_definition()["function"]["parameters"]
            enum: list[str] = params["properties"]["actions"]["items"]["properties"]["actionType"]["enum"]
            expected = filter_action_types(exclude_categories=None if canvas_enabled else {"canvas"})
            assert enum == expected, f"canvas_enabled={canvas_enabled} 时 enum 与注册表派生集不一致"


# =============================================================================
# 维度二：执行器对不合规 LLM 行为的强制
# =============================================================================


class _ScriptedStreamProvider:
    """按剧本吐流的假 provider：每个元素是一个 StreamChunk 列表（一轮一剧本）。"""

    def __init__(self, turns: list[list[dict]]) -> None:
        # 每个剧本元素直接是 chunk 描述：{"type": "delta", "text": ...} 或
        # {"type": "tool_calls", "tool_calls": [...]}；非 dict 元素原样透传以模拟畸形
        self.turns = turns
        self.index = 0
        self.all_messages: list = []
        from app.shared.services.llm.providers.base import StreamChunk

        self._chunk_cls = StreamChunk

    async def chat_stream(self, req) -> AsyncIterator:
        from app.shared.services.llm.providers.base import StreamChunk

        self.all_messages.append(list(req.messages))
        script = self.turns[self.index]
        self.index += 1
        for item in script:
            if item.get("type") == "delta":
                yield StreamChunk(type="delta", text=item.get("text", ""))
            elif item.get("type") == "tool_calls":
                yield StreamChunk(type="tool_calls", tool_calls=item.get("tool_calls"))

    # executor 依赖的 provider 属性
    model = "scripted"
    timeout_seconds = 30


def _noop_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        name="noop_tool",
        description="测试工具",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "echo": args},
    )
    return registry


def _tc(call_id: str, name: str, arguments: dict) -> dict:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json_dumps(arguments)}}


def json_dumps(obj) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)


class TestMalformedToolCallEnforcement:
    """provider 返回畸形 tool_call 条目时的确定性处置。"""

    @pytest.mark.asyncio
    async def test_non_dict_entries_dropped_task_survives(self):
        # 同轮流里混入字符串/None 畸形条目：被丢弃并留日志，合法调用正常执行，任务不中止
        provider = _ScriptedStreamProvider(
            turns=[
                [
                    {"type": "tool_calls", "tool_calls": [_tc("c1", "noop_tool", {"x": 1}), "garbage-string", None]},
                ],
                [{"type": "delta", "text": "最终回复"}],
            ]
        )
        executor = AgentExecutor(provider=provider, registry=_noop_registry(), max_iterations=5)
        result = await executor.run("task")
        assert result.success is True
        assert result.content == "最终回复"
        # 第二轮请求中只有一个工具结果消息（畸形条目未产生 tool 消息）
        tool_msgs = [m for m in provider.all_messages[1] if m.role == "tool"]
        assert len(tool_msgs) == 1

    @pytest.mark.asyncio
    async def test_non_dict_function_field_degrades_to_unknown_tool(self):
        # function 字段非 dict：解析为不可分发调用，execute 以"未知工具"错误回灌，
        # memory 的 token 估算/配对修正也不得对其抛异常（此前会 AttributeError 中止任务）
        provider = _ScriptedStreamProvider(
            turns=[
                [{"type": "tool_calls", "tool_calls": [{"id": "c1", "function": "not-a-dict"}]}],
                [{"type": "delta", "text": "收到失败反馈"}],
            ]
        )
        executor = AgentExecutor(provider=provider, registry=_noop_registry(), max_iterations=5)
        result = await executor.run("task")
        assert result.success is True
        tool_msgs = [m for m in provider.all_messages[1] if m.role == "tool"]
        assert tool_msgs and "未知工具" in (tool_msgs[0].content or "")

    def test_parse_tool_call_non_dict_returns_undispatchable(self):
        registry = _noop_registry()
        call = registry.parse_tool_call("garbage")  # type: ignore[arg-type]
        assert call.name == ""
        assert call.arguments == {}


class TestExecutorStreamRobustness:
    """流式调用的整体僵死防护与回调异常容错。"""

    @pytest.mark.asyncio
    async def test_hanging_stream_times_out_gracefully(self, monkeypatch):
        # provider 流永不结束：整体防僵死超时后以明确错误失败，而不是永久挂起

        class _HangingProvider:
            model = "hang"
            timeout_seconds = 30

            async def chat_stream(self, req) -> AsyncIterator:
                await asyncio.sleep(999)
                yield  # pragma: no cover

        import app.shared.services.ai.agent.executor as executor_module

        monkeypatch.setattr(executor_module, "stream_guard_timeout", lambda v: 0.05)
        executor = AgentExecutor(provider=_HangingProvider(), registry=_noop_registry(), max_iterations=3)
        result = await executor.run("task")
        assert result.success is False
        assert "超时" in (result.error or "")

    @pytest.mark.asyncio
    async def test_checkpoint_callback_exception_does_not_abort(self):
        # checkpoint 回调抛异常只影响检查点落盘，不得中断正常任务
        provider = _ScriptedStreamProvider(turns=[[{"type": "delta", "text": "直接答复"}]])

        def bad_checkpoint(_cp) -> None:
            raise RuntimeError("checkpoint 存储故障")

        executor = AgentExecutor(
            provider=provider,
            registry=_noop_registry(),
            max_iterations=3,
            checkpoint_callback=bad_checkpoint,
        )
        result = await executor.run("task")
        assert result.success is True
        assert result.content == "直接答复"

    @pytest.mark.asyncio
    async def test_checkpoint_callback_exception_on_final_config_path(self):
        # final_output_tool 产出最终配置后的 checkpoint 异常同样不得吞掉任务结果
        provider = _ScriptedStreamProvider(
            turns=[[{"type": "tool_calls", "tool_calls": [_tc("c1", "generate_config", {})]}]]
        )
        registry = _noop_registry()
        registry.register(
            name="generate_config",
            description="最终输出工具",
            parameters={"type": "object", "properties": {}},
            handler=lambda args: {"success": True, "config": {"final": True}},
        )

        def bad_checkpoint(_cp) -> None:
            raise RuntimeError("checkpoint 存储故障")

        executor = AgentExecutor(
            provider=provider,
            registry=registry,
            max_iterations=3,
            checkpoint_callback=bad_checkpoint,
        )
        result = await executor.run("task")
        assert result.success is True
        assert result.config == {"final": True}

    @pytest.mark.asyncio
    async def test_text_reply_config_extracted_from_content(self):
        # 纯文本回复中含配置 JSON → 一并提取为 result.config（generation 兜底路径）
        provider = _ScriptedStreamProvider(
            turns=[[{"type": "delta", "text": '结果：```json\n{"schemas": [{"id": "users"}]}\n```'}]]
        )
        executor = AgentExecutor(provider=provider, registry=_noop_registry(), max_iterations=3)
        result = await executor.run("task")
        assert result.success is True
        assert result.config == {"schemas": [{"id": "users"}]}

    @pytest.mark.asyncio
    async def test_empty_chunk_turn_continues_to_next_turn(self):
        # 收到空 delta（无文本无 tool_calls）不算空流：记录空轮后继续，最终文本收敛
        provider = _ScriptedStreamProvider(
            turns=[
                [{"type": "delta", "text": ""}],
                [{"type": "delta", "text": "第二轮回复"}],
            ]
        )
        executor = AgentExecutor(provider=provider, registry=_noop_registry(), max_iterations=5)
        result = await executor.run("task")
        assert result.success is True
        assert result.content == "第二轮回复"
        assert result.iterations == 2


class TestExecutorContractGuards:
    """执行器契约守卫的直接单测。"""

    def test_extract_final_config_skipped_when_tool_none(self):
        # chat agent（final_output_tool=None）即使 generate_config 成功也不提取配置
        from app.shared.services.ai.agent.types import ToolResult

        executor = AgentExecutor(provider=object(), registry=_noop_registry(), final_output_tool=None)
        results = [
            ToolResult(
                call_id="c1", name="generate_config", success=True, observation={"success": True, "config": {"a": 1}}
            )
        ]
        assert executor._extract_final_config(results) is None

    def test_extract_final_config_from_successful_tool(self):
        from app.shared.services.ai.agent.types import ToolResult

        executor = AgentExecutor(provider=object(), registry=_noop_registry())
        results = [
            ToolResult(
                call_id="c1", name="other_tool", success=True, observation={"success": True, "config": {"wrong": 1}}
            ),
            ToolResult(
                call_id="c2",
                name="generate_config",
                success=True,
                observation={"success": True, "config": {"right": 1}},
            ),
            ToolResult(call_id="c3", name="generate_config", success=False, observation={}),
        ]
        assert executor._extract_final_config(results) == {"right": 1}

    def test_check_repeated_tool_calls_without_memory_is_noop(self):
        executor = AgentExecutor(provider=object(), registry=_noop_registry())
        executor._check_repeated_tool_calls([_tc("c1", "t", {})])  # 未 run 过，memory 为 None，不得抛异常

    def test_tool_call_signature_guards_non_dict(self):
        assert _tool_call_signature("garbage") == ""
        assert _tool_call_signature({"id": "", "function": "not-a-dict"}) == ""
        assert _tool_call_signature({"id": "abc"}) == "abc"
        assert _cross_turn_signature("garbage") == ""
        assert _cross_turn_signature({"function": {"name": "n", "arguments": "{}"}}) == "n:{}"


# =============================================================================
# 维度三：指令上下文渲染质量（legacy 聊天提示词）
# =============================================================================


def _rendered_overview() -> str:
    """构造覆盖全部渲染分支的项目概览并渲染为提示词段落。"""
    from app.shared.services.llm.chat.chat_system_prompt import build_project_overview_section

    overview = {
        "schemas": [
            {
                "name": "users",
                "id": "uuid-1",
                "columns": [{"name": "id"}, {"name": "email"}],
                "source": {
                    "path": "data/users.json",
                    "options": {"format": "object", "json_path": "$.data.items", "record_path": "records"},
                },
            }
        ],
        "constraints": [
            # 内联约束：Range 带参数 + AllowedValues 带参数
            {
                "is_inline": True,
                "table_id": "uuid-1",
                "type": "Range",
                "column_name": "age",
                "params": {"min": 1, "max": 100},
            },
            {
                "is_inline": True,
                "table_id": "uuid-1",
                "type": "AllowedValues",
                "column_name": "status",
                "params": {"allowed_values": ["active", "frozen"]},
            },
            # 独立约束：多列 + 禁用态 + 说明
            {
                "is_inline": False,
                "type": "Unique",
                "table_id": "uuid-1",
                "column_ids": ["order_id", "line_no"],
                "description": "订单行唯一",
                "enabled": False,
            },
        ],
        "regex_nodes": [
            {"name": "邮箱格式", "pattern": "a" * 100, "match_mode": "full", "enabled": True},
        ],
        "transforms": [
            {
                "type": "CastType",
                "id": "tf-1",
                "input_column": "price",
                "output_columns": ["price_num"],
                "enabled": True,
            },
        ],
        "settings": {
            "validation": {"auto_validate": False},
            "file_processing": {"default_encoding": "gbk"},
            "script_security": {"allow_eval": True},
        },
    }
    return build_project_overview_section(overview)


class TestLegacyPromptContextRendering:
    """legacy（JSON 直出）路径的上下文渲染——丢信息会让 LLM 无法遵循指令。"""

    def test_source_options_rendered(self):
        out = _rendered_overview()
        assert "data/users.json" in out
        assert "格式: object" in out
        assert "JSONPath: $.data.items" in out
        assert "记录路径: records" in out

    def test_inline_constraint_params_rendered(self):
        out = _rendered_overview()
        assert "范围: 1 - 100" in out
        assert "允许值: active, frozen" in out

    def test_standalone_constraint_multi_column_and_state(self):
        out = _rendered_overview()
        assert "order_id, line_no" in out
        assert "禁用" in out
        assert "订单行唯一" in out

    def test_regex_pattern_truncated_at_80_chars(self):
        out = _rendered_overview()
        assert "a" * 80 + "..." in out
        assert "a" * 81 not in out

    def test_transform_rendered(self):
        out = _rendered_overview()
        assert "CastType" in out
        assert "price" in out
        assert "price_num" in out

    def test_settings_sections_rendered(self):
        out = _rendered_overview()
        assert "auto_validate=False" in out
        assert "encoding=gbk" in out
        assert "allow_eval=True" in out

    def test_empty_overview_returns_empty(self):
        from app.shared.services.llm.chat.chat_system_prompt import build_project_overview_section

        assert build_project_overview_section({}) == ""
        assert build_project_overview_section({"schemas": [], "constraints": []}) == ""

    def test_parse_error_only_project_still_renders(self):
        from app.shared.services.llm.chat.chat_system_prompt import build_project_overview_section

        out = build_project_overview_section(
            {"parse_errors": [{"path": "schemas/bad.schema.yaml", "error": "缺必填字段"}]}
        )
        assert "bad.schema.yaml" in out
        assert "缺必填字段" in out

    def test_context_section_columns_both_shapes(self):
        from app.shared.services.llm.chat.chat_system_prompt import build_context_section

        out = build_context_section(
            [
                {"id": "n1", "type": "schema", "data": {"label": "用户表", "columns": [{"name": "email", "id": "c1"}]}},
                {"id": "n2", "type": "schema", "data": {"label": "订单表", "columns": ["id", "amount"]}},
                {"id": "n3", "type": "regex", "data": {"label": "空节点"}},
            ]
        )
        assert "email (ID: c1)" in out
        assert "id, amount" in out
        assert "可用字段: []" in out

    def test_user_request_section(self):
        from app.shared.services.llm.chat.chat_system_prompt import build_user_request_section

        assert build_user_request_section("") == ""
        out = build_user_request_section("给 email 加唯一约束")
        assert "## 用户需求" in out
        assert "给 email 加唯一约束" in out

    def test_extract_node_columns(self):
        from app.shared.services.llm.chat.chat_system_prompt import extract_node_columns

        out = extract_node_columns([{"id": "n1", "data": {"columns": ["a"]}}, {"data": {"columns": ["b"]}}])
        assert out == {"n1": ["a"]}  # 无 id 的节点跳过

    def test_legacy_prompt_full_assembly(self):
        from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt

        prompt = build_system_prompt(
            {
                "message": "给 email 加唯一约束",
                "context": {"selectedNodes": [{"id": "n1", "type": "schema", "data": {"label": "用户表"}}]},
                "projectOverview": {"schemas": [{"name": "users", "id": "u1", "columns": [{"name": "email"}]}]},
            }
        )
        # legacy 路径必须同时携带：JSON 输出契约 + 项目概览 + 上下文 + 用户需求
        assert '"reply"' in prompt and '"actions"' in prompt
        assert "## 当前项目概览" in prompt
        assert "## 当前上下文" in prompt
        assert "## 用户需求" in prompt


# =============================================================================
# ChatAgentRunner 的指令上下文组装
# =============================================================================


class TestRunnerTaskMessageAndFallback:
    def _runner(self, **kwargs):
        from app.shared.services.ai.chat_agent_runner import ChatAgentRunner

        defaults = dict(
            provider=object(),
            project_path="",
            context_nodes=[],
            max_iterations=2,
        )
        defaults.update(kwargs)
        return ChatAgentRunner(**defaults)

    def test_task_message_without_history_unchanged(self):
        runner = self._runner()
        assert runner._build_task_message("原始消息", None) == "原始消息"

    def test_task_message_with_history_summarized(self):
        runner = self._runner()
        history = [
            {"role": "user", "content": "第一轮问题"},
            {"role": "assistant", "content": "第一轮回答"},
        ]
        message = runner._build_task_message("当前问题", history)
        assert "## 对话历史摘要" in message
        assert "## 当前用户需求" in message
        assert "用户: 第一轮问题" in message
        assert "助手: 第一轮回答" in message
        assert "当前问题" in message

    def test_task_message_history_capped_to_recent(self):
        runner = self._runner()
        history = [{"role": "user", "content": f"问题{i}"} for i in range(8)]
        message = runner._build_task_message("当前问题", history)
        assert "问题0" not in message and "问题1" not in message
        assert "问题7" in message

    @pytest.mark.asyncio
    async def test_empty_reply_fallback_message(self, monkeypatch):
        # executor 正常结束但无文本产出 → 兜底文案而非空串（用户永远有回复可读）
        import app.shared.services.ai.chat_agent_runner as runner_module

        class _SilentExecutor:
            def __init__(self, **kwargs) -> None:
                pass

            async def run(self, task_message, initial_checkpoint=None):
                return AgentResult(success=True, content="", error=None, iterations=1)

        monkeypatch.setattr(runner_module, "AgentExecutor", _SilentExecutor)
        target = self._runner()
        result = await target.run("做点什么")
        assert result.reply == "我已完成处理，但没有生成回复文本。"
        assert result.success is True

    def test_system_prompt_survives_overview_failure(self, monkeypatch):
        # 项目概览构建失败只降级概览段，核心提示词必须完整
        import app.shared.services.ai.utils as ai_utils

        def _boom(_path):
            raise RuntimeError("目录损坏")

        monkeypatch.setattr(ai_utils, "get_project_overview", _boom)
        runner = self._runner(project_path="/nonexistent")
        assert "工具使用指引" in runner.system_prompt
