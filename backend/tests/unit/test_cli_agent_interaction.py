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
"""
@fileoverview CLI agent 终端交互适配器测试

验证 build_agent_interaction 产出的回调能把终端输入经 pending store 正确送达
apply_actions 的 ConfirmController / ask_user 的 InteractionController——
即 CLI agent 模式的写盘确认与提问闸门真实可用（此前 fail-closed）。
"""

import asyncio

from app.cli.shell.commands.ai.agent_interaction import (
    _print_apply_summary,
    _read_apply_decision,
    build_agent_interaction,
)
from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InteractionController,
    get_global_pending_interaction_store,
)


def _run_gate_scenario(callback, payload, controller, interaction_id):
    """公共流程：注册 controller → 触发回调（内部起终端线程）→ 等待决策/回答。"""

    async def scenario():
        store = get_global_pending_interaction_store()
        store.put(interaction_id, controller)
        try:
            callback(payload)
            if isinstance(controller, ConfirmController):
                return await asyncio.wait_for(controller.await_decision(), timeout=5)
            return await asyncio.wait_for(controller.await_response(), timeout=5)
        finally:
            store.pop(interaction_id)

    return asyncio.run(scenario())


class TestApplyConfirmGate:
    def test_confirm_on_yes(self, monkeypatch, capsys):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "y")
        apply_cbs, _ = build_agent_interaction(None)
        controller = ConfirmController(request_id="job1#apply#1")
        decision = _run_gate_scenario(
            apply_cbs.on_apply_pending,
            {
                "apply_id": "job1#apply#1",
                "files": [{"path": "constraints/c1.yaml", "status": "created", "diff": "+ type: NotNull"}],
                "summary": "1 个文件",
            },
            controller,
            "job1#apply#1",
        )
        assert decision == "confirm"
        out = capsys.readouterr().out
        assert "constraints/c1.yaml" in out

    def test_reject_on_no(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "n")
        apply_cbs, _ = build_agent_interaction(None)
        decision = _run_gate_scenario(
            apply_cbs.on_apply_pending,
            {"apply_id": "job1#apply#2", "files": [], "summary": None},
            ConfirmController(request_id="job1#apply#2"),
            "job1#apply#2",
        )
        assert decision == "reject"

    def test_reject_on_empty_input(self, monkeypatch):
        """空回车默认拒绝（写盘保守默认）。"""
        monkeypatch.setattr("builtins.input", lambda *a, **k: "")
        apply_cbs, _ = build_agent_interaction(None)
        decision = _run_gate_scenario(
            apply_cbs.on_apply_pending,
            {"apply_id": "job1#apply#3", "files": []},
            ConfirmController(request_id="job1#apply#3"),
            "job1#apply#3",
        )
        assert decision == "reject"


def make_pending_file(path: str, status: str = "created", diff: str = "+ new: content") -> dict:
    """构造 pending payload 的单个文件条目。"""
    return {"path": path, "status": status, "diff": diff, "before_preview": "", "after_preview": ""}


def make_pending_action(description: str = "添加约束：users.email — NotNull") -> dict:
    """构造 pending payload 的单个动作摘要条目。"""
    return {"action_type": "ADD_CONSTRAINT_NODE", "description": description, "target": "users.email"}


class TestApplySummaryDisplay:
    """摘要优先展示：动作清单 + 文件清单，不含 diff 正文；diff 经 [d] 按需全量查看。"""

    PAYLOAD = {
        "apply_id": "job2#apply#1",
        "actions": [make_pending_action()],
        "files": [make_pending_file("constraints/c1.yaml", "created", "+ type: NotNull\n+ refs:\n+   column: email")],
        "summary": {"created": 1},
    }

    def test_summary_shows_actions_and_files_without_diff_body(self, capsys):
        """摘要模式：输出含动作清单与文件清单，不含 diff 正文（刷屏源头已移除）。"""
        _print_apply_summary(self.PAYLOAD)
        out = capsys.readouterr().out
        # 动作语义清单在前（用户先确认"AI 要干什么"）
        assert "将执行 1 个动作：" in out
        assert "1. 添加约束：users.email — NotNull" in out
        # 文件清单：状态汇总行 + 每文件一行（无 diff）
        assert "AI 请求写入 1 个文件（新增 1，修改 0，删除 0）：" in out
        assert "[created] constraints/c1.yaml" in out
        # 摘要行保留
        assert "摘要:" in out
        # 核心回归：diff 正文不得出现在摘要里
        assert "+ type: NotNull" not in out
        assert "+ refs:" not in out

    def test_summary_without_actions_skips_action_block(self, capsys):
        """payload 无 actions 字段（旧后端）时不打印动作清单，文件清单正常。"""
        _print_apply_summary({"apply_id": "x", "files": [make_pending_file("schemas/a.yaml", "modified", "+ x")]})
        out = capsys.readouterr().out
        assert "将执行" not in out
        assert "AI 请求写入 1 个文件（新增 0，修改 1，删除 0）：" in out
        assert "[modified] schemas/a.yaml" in out

    def test_long_lists_truncated_to_threshold(self, capsys):
        """超长清单截断：动作/文件各显示前 _MAX_LIST_ITEMS 项 + 总数提示。"""
        from app.cli.shell.commands.ai.agent_interaction import _MAX_LIST_ITEMS

        payload = {
            "apply_id": "x",
            "actions": [make_pending_action(f"动作 {i}") for i in range(_MAX_LIST_ITEMS + 5)],
            "files": [make_pending_file(f"constraints/f{i}.yaml") for i in range(_MAX_LIST_ITEMS + 5)],
        }
        _print_apply_summary(payload)
        out = capsys.readouterr().out
        assert f"... 共 {_MAX_LIST_ITEMS + 5} 个" in out
        # 阈值内条目展示、阈值外条目不展示
        assert "1. 动作 0" in out
        assert f"{_MAX_LIST_ITEMS}. 动作 {_MAX_LIST_ITEMS - 1}" in out
        assert f"动作 {_MAX_LIST_ITEMS}" not in out
        assert "[created] constraints/f0.yaml" in out
        assert f"[created] constraints/f{_MAX_LIST_ITEMS}.yaml" not in out

    def test_decision_d_prints_full_diff_then_returns_to_prompt(self, monkeypatch, capsys):
        """选 d 打印全量 diff（不截断），打完回到确认提示，再 y 确认。"""
        long_diff = "\n".join(f"+ line {i}" for i in range(60))
        payload = {
            "apply_id": "job3#apply#1",
            "actions": [make_pending_action()],
            "files": [make_pending_file("constraints/c1.yaml", "created", long_diff)],
        }
        inputs = iter(["d", "y"])
        monkeypatch.setattr("builtins.input", lambda *a, **k: next(inputs))
        decision = _read_apply_decision(payload)
        assert decision == "confirm"
        out = capsys.readouterr().out
        # 全量 diff：首尾行都在（旧版 30 行截断后无任何渠道看全量）
        assert "+ line 0" in out
        assert "+ line 59" in out
        assert "--- constraints/c1.yaml（created）---" in out

    def test_decision_d_then_reject(self, monkeypatch):
        """d 查看后空输入仍默认拒绝（三态循环不改变保守默认）。"""
        payload = {"apply_id": "x", "actions": [], "files": [make_pending_file("a.yaml")]}
        inputs = iter(["d", ""])
        monkeypatch.setattr("builtins.input", lambda *a, **k: next(inputs))
        assert _read_apply_decision(payload) == "reject"

    def test_decision_d_with_no_files_prints_placeholder(self, monkeypatch, capsys):
        """无文件变更时选 d 打印占位说明（不抛异常、不空转）。"""
        inputs = iter(["d", "n"])
        monkeypatch.setattr("builtins.input", lambda *a, **k: next(inputs))
        assert _read_apply_decision({"apply_id": "x", "actions": [], "files": []}) == "reject"
        assert "（无文件变更）" in capsys.readouterr().out

    def test_non_yes_non_d_input_rejects_immediately(self, monkeypatch):
        """既非 y 也非 d 的输入（如 n）直接拒绝，不进入循环。"""
        calls: list[str] = []

        def fake_input(*a, **k):
            calls.append("called")
            return "n"

        monkeypatch.setattr("builtins.input", fake_input)
        assert _read_apply_decision({"apply_id": "x", "files": []}) == "reject"
        assert len(calls) == 1


class TestAskUserGate:
    def test_choice_single(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "2")
        _, ask_cbs = build_agent_interaction(None)
        response = _run_gate_scenario(
            ask_cbs.on_user_input_requested,
            {
                "ask_id": "job1#ask#1",
                "question_type": "choice",
                "prompt": "选择目标表",
                "options": ["users", "orders"],
            },
            InteractionController(request_id="job1#ask#1"),
            "job1#ask#1",
        )
        assert response == {"answer": "orders"}

    def test_choice_dict_options_render_and_answer_value(self, monkeypatch, capsys):
        """schema 声明的 {label, value, description} 形态：展示人类可读，回灌 value 而非 dict repr。"""
        monkeypatch.setattr("builtins.input", lambda *a, **k: "1")
        _, ask_cbs = build_agent_interaction(None)
        response = _run_gate_scenario(
            ask_cbs.on_user_input_requested,
            {
                "ask_id": "job1#ask#4",
                "question_type": "choice",
                "prompt": "初始化意图？",
                "options": [
                    {
                        "label": "重置项目设置为默认值",
                        "value": "reset_settings",
                        "description": "把校验/文件处理/脚本安全等设置恢复为默认值",
                    },
                    {"label": "创建一张新表", "value": "create_schema"},
                ],
            },
            InteractionController(request_id="job1#ask#4"),
            "job1#ask#4",
        )
        assert response == {"answer": "reset_settings"}
        out = capsys.readouterr().out
        assert "1. 重置项目设置为默认值 — 把校验/文件处理/脚本安全等设置恢复为默认值" in out
        assert "2. 创建一张新表" in out
        assert "{'label'" not in out

    def test_choice_dict_options_multiple(self, monkeypatch):
        """多选 dict 形态：逗号分隔编号回灌各选项 value。"""
        monkeypatch.setattr("builtins.input", lambda *a, **k: "2,1")
        _, ask_cbs = build_agent_interaction(None)
        response = _run_gate_scenario(
            ask_cbs.on_user_input_requested,
            {
                "ask_id": "job1#ask#5",
                "question_type": "choice",
                "prompt": "选择要启用的检查",
                "multiple": True,
                "options": [
                    {"label": "非空", "value": "not_null"},
                    {"label": "唯一", "value": "unique"},
                ],
            },
            InteractionController(request_id="job1#ask#5"),
            "job1#ask#5",
        )
        assert response == {"answer": ["unique", "not_null"]}

    def test_free_text(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "身份证号")
        _, ask_cbs = build_agent_interaction(None)
        response = _run_gate_scenario(
            ask_cbs.on_user_input_requested,
            {"ask_id": "job1#ask#2", "question_type": "free_text", "prompt": "校验哪种格式？"},
            InteractionController(request_id="job1#ask#2"),
            "job1#ask#2",
        )
        assert response == {"answer": "身份证号"}

    def test_confirm_boolean(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "y")
        _, ask_cbs = build_agent_interaction(None)
        response = _run_gate_scenario(
            ask_cbs.on_user_input_requested,
            {"ask_id": "job1#ask#3", "question_type": "confirm", "prompt": "确认删除？"},
            InteractionController(request_id="job1#ask#3"),
            "job1#ask#3",
        )
        assert response == {"answer": True}
