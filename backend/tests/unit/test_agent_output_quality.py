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
"""@fileoverview AI Agent 输出质量强化测试

围绕"LLM 输出的解析、提取与回灌质量"补充对抗性用例：
- ActionParser 策略链对抗样本：BOM/多代码块/Markdown 围栏+截断组合/混合嵌套截断/
  约束类型别名归一（指令遵循宽容度）
- 截断恢复 LIFO 闭合序回归：{ 与 [ 混合未闭合时恢复结果必须真正可解析
- AgentExecutor._try_parse_config：生成链路最终配置提取（此前零覆盖）
- AgentMemory observation 裁剪：超长列表/嵌套 dict/不可序列化兜底，回灌文本不得截半 JSON
- AgentPlanner 按列分块的合并边界与序列化
"""

from __future__ import annotations

import json

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.memory import AgentMemory
from app.shared.services.ai.agent.planner import build_chunk_plan, plan_to_dict
from app.shared.services.llm.chat.response_parser import ActionParser
from app.shared.services.llm.yaml_io import ActionParseError


def _assert_json_valid(text: str) -> None:
    """断言恢复产物是真正可解析的 JSON（此前单测只断言 recovered 标志，漏过非法产物）。"""
    json.loads(text)


class TestParseResponseAdversarial:
    """parse_llm_response 策略链对抗样本。"""

    def test_bom_prefixed_json_parsed(self):
        # Windows 编辑器/部分 provider 会带 UTF-8 BOM；策略链经"提取 JSON 块"剥掉 BOM
        result = ActionParser.parse_llm_response('﻿{"reply": "ok", "actions": []}')
        assert result["reply"] == "ok"

    def test_multiple_code_blocks_longest_wins(self):
        text = 'A ```{"a": 1}``` B ```{"reply": "long-block-wins", "actions": []}```'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "long-block-wins"

    def test_markdown_fenced_truncated_json_recovered(self):
        # token 上限掐断的典型形态：已输出 ```json 围栏开头、JSON 中途截断。
        # 旧实现"截断恢复"在含围栏前缀的原文上补闭合符，仍然非法 → 整体解析失败
        text = '```json\n{"reply": "x", "actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull"'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "x"
        assert len(result["actions"]) == 1
        assert result["actions"][0]["constraintSpec"]["type"] == "NotNull"

    def test_prose_fenced_truncated_recovers_complete_prefix(self):
        # 散文前缀 + 围栏 + 截断：至少一个完整动作时，提取 JSON 块后恢复出完整前缀
        text = '好的，以下是配置：\n```json\n{"reply": "x", "actions": [{"a": 1}, {"b"'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "x"
        assert result["actions"] == [{"a": 1}]

    def test_nested_mixed_truncation_recovers_valid_json(self):
        # 最常见截断形态：actions 数组中途截断（{ 与 [ 同时未闭合）
        result = ActionParser.parse_llm_response('{"reply": "x", "actions": [{"a": 1')
        assert result["actions"] == [{"a": 1}]

    def test_mid_string_truncation_closes_string_then_braces(self):
        # 截断在字符串值中间：先补引号再补闭合括号，保住已生成的文本
        result = ActionParser.parse_llm_response('{"reply": "部分回复内')
        assert result["reply"] == "部分回复内"

    def test_single_quote_with_embedded_double_quotes_raises(self):
        # 已知局限：单引号串内含双引号时不做替换（避免破坏字段），全策略失败 → 显式报错
        with pytest.raises(ActionParseError):
            ActionParser.parse_llm_response("""{'reply': 'say "hi"', 'actions': []}""")

    def test_garbage_with_braces_still_raises(self):
        # 回归守卫：逐级回退的恢复候选不得把乱码"恢复"成空对象——必须显式失败
        with pytest.raises(ActionParseError, match="无法解析"):
            ActionParser.parse_llm_response("not json at all {{{")

    def test_plain_garbage_raises(self):
        with pytest.raises(ActionParseError, match="无法解析"):
            ActionParser.parse_llm_response("完全不是 JSON 的回复")


class TestTruncateRecoveryLifo:
    """_try_recover_truncated 的 LIFO 闭合序回归（修复：计数盲补产出非法 JSON）。"""

    def test_bracket_and_brace_both_open_closes_in_lifo_order(self):
        # 旧实现按计数先补全 } 再补 ]，产出 {"a": [1, 2}] —— 非法 JSON
        recovered, flag = ActionParser._try_recover_truncated('{"a": [1, 2')
        assert flag is True
        _assert_json_valid(recovered)
        assert json.loads(recovered) == {"a": [1, 2]}

    def test_deeply_nested_object_in_array(self):
        recovered, flag = ActionParser._try_recover_truncated('{"reply": "x", "actions": [{"a": 1')
        assert flag is True
        assert json.loads(recovered)["actions"] == [{"a": 1}]

    def test_balanced_json_untouched(self):
        result, flag = ActionParser._try_recover_truncated('{"a": 1}')
        assert flag is False
        assert result == '{"a": 1}'

    def test_brace_inside_string_literal_not_miscounted(self):
        # 字符串字面量内的 } 不得被当作闭合符（旧计数法会误判已闭合而漏补）
        recovered, flag = ActionParser._try_recover_truncated('{"a": "}"')
        assert flag is True
        assert json.loads(recovered) == {"a": "}"}

    def test_scan_reports_dangling_string(self):
        stack, in_string = ActionParser._scan_json_open_stack('{"a": "unclosed')
        assert stack == ["}"]
        assert in_string is True


class TestConstraintTypeLeniency:
    """约束类型归一（指令遵循宽容度）：LLM 用别名/小写也要被受理并归一为正名。"""

    def test_lowercase_snake_alias_normalized_and_accepted(self):
        spec = {"type": "not_null"}
        ok = ActionParser._validate_action({"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": spec})
        assert ok is True
        assert spec["type"] == "NotNull"

    def test_uppercase_alias_regex_mapped_to_scripted(self):
        spec = {"type": "REGEX"}
        ok = ActionParser._validate_action({"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": spec})
        assert ok is True
        assert spec["type"] == "Scripted"

    def test_fabricated_constraint_type_rejected(self):
        # 提示词明令拒绝的自造类型（EmailFormat 等）必须被校验器拒绝，不得静默受理
        ok = ActionParser._validate_action(
            {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "EmailFormat"}}
        )
        assert ok is False

    def test_validate_response_normalizes_alias_in_place(self):
        response = {
            "reply": "ok",
            "actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NOT_NULL"}}],
        }
        assert ActionParser.validate_response(response) is True
        assert response["actions"][0]["constraintSpec"]["type"] == "NotNull"


class TestTryParseConfig:
    """AgentExecutor._try_parse_config：生成链路"LLM 直接文本回复含配置 JSON"的提取。"""

    def test_plain_json_dict(self):
        assert AgentExecutor._try_parse_config('{"schemas": []}') == {"schemas": []}

    def test_json_in_markdown_fence(self):
        content = '说明文字\n```json\n{"a": {"b": 2}}\n```'
        assert AgentExecutor._try_parse_config(content) == {"a": {"b": 2}}

    def test_json_with_surrounding_prose(self):
        assert AgentExecutor._try_parse_config('前缀 {"a": 1} 后缀') == {"a": 1}

    def test_first_balanced_object_wins(self):
        content = '{"first": 1} 中间文字 {"second": 2}'
        assert AgentExecutor._try_parse_config(content) == {"first": 1}

    def test_no_json_returns_none(self):
        assert AgentExecutor._try_parse_config("没有任何 JSON 的回复") is None

    def test_empty_returns_none(self):
        assert AgentExecutor._try_parse_config("") is None
        assert AgentExecutor._try_parse_config(None) is None

    def test_top_level_scalar_list_returns_none(self):
        # 契约：最终配置必须是 dict；无任何对象的顶层 JSON 数组不受理
        assert AgentExecutor._try_parse_config("[1, 2, 3]") is None

    def test_top_level_list_with_object_extracts_first_dict(self):
        # 文档化：提取逻辑取首个平衡的 { }，顶层数组内的对象也会被取出
        assert AgentExecutor._try_parse_config('[{"a": 1}, {"b": 2}]') == {"a": 1}

    def test_invalid_json_returns_none(self):
        assert AgentExecutor._try_parse_config("前缀 {a: 1} 后缀") is None

    def test_brace_inside_string_breaks_extraction(self):
        # 已知局限（文档化）：平衡计数不感知字符串字面量，值内的 } 会被误当闭合符 → None
        assert AgentExecutor._try_parse_config('here {"a": "x}y"} end') is None


class TestDictToTextAndMetrics:
    """executor 的观察文本化兜底与 metrics 构造。"""

    def test_dict_to_text_serializable(self):
        assert json.loads(AgentExecutor._dict_to_text({"a": 1})) == {"a": 1}

    def test_dict_to_text_falls_back_to_str_on_unserializable(self):
        # observation 含 set 等不可序列化值时兜底 str()，不得抛异常打断工具回灌
        out = AgentExecutor._dict_to_text({"s": {1, 2}})
        assert "s" in out

    def test_build_metrics_from_issues(self):
        issues = [{"row": 1}, {"row": 2}]
        metrics = AgentExecutor.build_metrics_from_issues(issues)
        assert metrics.failed_rules == 2
        assert metrics.issues == issues


class TestObservationSummarization:
    """AgentMemory observation 裁剪：回灌给 LLM 的工具结果不截半 JSON、不丢关键信号。"""

    def test_short_fields_kept_intact(self):
        data = {"success": True, "message": "ok", "small": "x" * 100}
        assert AgentMemory._summarize_dict(data) == data

    def test_long_string_truncated_with_marker(self):
        out = AgentMemory._summarize_dict({"big": "x" * 2000})
        assert out["big"].endswith("...[truncated]")
        assert len(out["big"]) < 2000

    def test_short_list_kept_intact(self):
        out = AgentMemory._summarize_dict({"items": [1, 2, 3, 4, 5]})
        assert out["items"] == [1, 2, 3, 4, 5]

    def test_long_list_capped_with_counter(self):
        out = AgentMemory._summarize_dict({"items": list(range(10))})
        assert out["items"][:5] == [0, 1, 2, 3, 4]
        assert out["items"][5] == "...[5 more items]"
        assert len(out["items"]) == 6

    def test_nested_dict_recursed(self):
        out = AgentMemory._summarize_dict({"inner": {"big": "y" * 2000}})
        assert out["inner"]["big"].endswith("...[truncated]")

    def test_critical_small_fields_never_truncated(self):
        # success/error 等关键字段即使长也完整保留——LLM 依赖它们判断成败
        long_error = "e" * 2000
        out = AgentMemory._summarize_dict({"error": long_error})
        assert out["error"] == long_error

    def test_dict_to_observation_valid_json(self):
        out = AgentMemory._dict_to_observation({"a": [1] * 10, "success": True})
        parsed = json.loads(out)  # 裁剪后仍必须是完整 JSON，不得截半
        assert parsed["success"] is True
        assert parsed["a"][5] == "...[5 more items]"

    def test_dict_to_observation_falls_back_to_str(self):
        out = AgentMemory._dict_to_observation({"s": {1, 2}})
        assert "s" in out  # str 兜底，不抛异常


class TestPlannerColumnChunking:
    """按列分块的合并边界与序列化（generation agent 分块指令质量）。"""

    @staticmethod
    def _profile(table: str, cols: list[str]) -> dict:
        return {
            "table_name": table,
            "path": f"data/{table}.csv",
            "columns": [{"name": c} for c in cols],
        }

    def test_small_tables_merge_into_one_chunk(self):
        # 总列数 6 > max 5 触发 by_column：a(3) 独立成块，b(2) 并入（3+2≤5），c(1) 溢出另起
        plan = build_chunk_plan(
            [self._profile("a", ["a1", "a2", "a3"]), self._profile("b", ["b1", "b2"]), self._profile("c", ["c1"])],
            [],
            max_columns_per_chunk=5,
        )
        assert plan.strategy == "by_column"
        assert len(plan.chunks) == 2
        merged = plan.chunks[0]
        assert merged.table_names == ["a", "b"]
        assert len(merged.columns) == 5
        assert plan.chunks[1].table_names == ["c"]

    def test_overflowing_table_starts_new_chunk(self):
        plan = build_chunk_plan(
            [self._profile("a", ["a1", "a2"]), self._profile("b", ["b1", "b2", "b2x"])],
            [],
            max_columns_per_chunk=4,
        )
        assert len(plan.chunks) == 2
        assert plan.chunks[0].table_names == ["a"]
        assert plan.chunks[1].table_names == ["b"]

    def test_single_oversized_table_split_by_columns(self):
        plan = build_chunk_plan([self._profile("wide", [f"c{i}" for i in range(5)])], [], max_columns_per_chunk=2)
        assert len(plan.chunks) == 3
        assert all(c.table_names == ["wide"] for c in plan.chunks)

    def test_plan_to_dict_roundtrip_structure(self):
        plan = build_chunk_plan([self._profile("a", ["a1"])], ["data/a.csv"], max_columns_per_chunk=10)
        # 列数未超限走 single 策略；by_column 分支的序列化用合并场景验证
        plan_by_col = build_chunk_plan(
            [self._profile("a", ["a1"]), self._profile("b", ["b1"])], [], max_columns_per_chunk=1
        )
        d = plan_to_dict(plan_by_col)
        assert d["strategy"] == "by_column"
        assert set(d["chunks"][0].keys()) == {"chunk_id", "file_paths", "table_names", "columns", "reason"}
        json.dumps(d)  # 必须可 JSON 序列化（checkpoint 落盘依赖）
        assert plan.chunks[0].chunk_id == "single"


class TestMessageTokenEstimation:
    """消息 token 估算的入参形态覆盖。"""

    def test_estimate_message_tokens_with_string_arguments(self):
        tokens = AgentMemory._estimate_message_tokens(
            {"role": "assistant", "content": "hi", "tool_calls": [{"function": {"name": "t", "arguments": '{"a":1}'}}]}
        )
        assert tokens > 0

    def test_estimate_message_tokens_with_dict_arguments(self):
        tokens = AgentMemory._estimate_message_tokens(
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "t", "arguments": {"a": 1}}}]}
        )
        assert tokens > 0

    def test_estimate_message_tokens_empty(self):
        assert AgentMemory._estimate_message_tokens({"role": "user", "content": ""}) == 4


class TestMemoryReminderGuard:
    def test_empty_reminder_ignored(self):
        mem = AgentMemory("sys")
        mem.add_system_reminder("")
        assert len(mem.get_messages()) == 1  # 仅 system prompt

    def test_get_turns_returns_record(self):
        from app.shared.services.ai.agent.types import AgentTurn

        mem = AgentMemory("sys")
        mem.add_turn(AgentTurn(turn=1))
        assert [t.turn for t in mem.get_turns()] == [1]
