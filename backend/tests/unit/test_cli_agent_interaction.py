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

from app.cli.shell.commands.ai.agent_interaction import build_agent_interaction
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
