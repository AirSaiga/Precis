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
"""@fileoverview 动作级语义摘要（action_summaries）单元测试

覆盖:
- 描述映射完整性守卫：新增动作类型漏登记中文描述时即红
- summarize_action：一行摘要（两阶段确认 payload 的 actions 字段）各家族输入→输出映射
- format_confirm_lines：legacy confirm_actions 多行格式回归（提取前后逐字节一致）
- confirm_actions 端到端：提取重构后行为不变（展示 + y/N 决策）
"""

from __future__ import annotations

import pytest

from app.cli.shell.commands.ai.interaction import confirm_actions
from app.shared.services.llm.actions.action_summaries import (
    ACTION_TYPE_DESCRIPTIONS,
    describe_action_type,
    extract_action_target,
    format_confirm_lines,
    summarize_action,
)
from app.shared.services.llm.actions.registry import ACTIONS, WRITE_ACTION_TYPES


def make_constraint_action(action_type: str = "ADD_CONSTRAINT_NODE", **spec_overrides) -> dict:
    """构造约束动作工厂（默认 users.email 的 NotNull）。"""
    spec = {
        "type": "NotNull",
        "tableName": "users",
        "targetColumn": "email",
        "isInline": True,
    }
    spec.update(spec_overrides)
    return {"actionType": action_type, "constraintSpec": spec}


def make_schema_action(action_type: str = "ADD_SCHEMA", **spec_overrides) -> dict:
    """构造 Schema 动作工厂。"""
    spec = {"name": "orders", "columns": [{"name": "id", "type": "integer"}]}
    spec.update(spec_overrides)
    return {"actionType": action_type, "schemaSpec": spec}


def make_regex_action(action_type: str = "ADD_REGEX", **spec_overrides) -> dict:
    """构造 Regex 动作工厂。"""
    spec = {"name": "email_pattern", "pattern": r"^[\w.-]+@[\w.-]+$"}
    spec.update(spec_overrides)
    return {"actionType": action_type, "regexSpec": spec}


def make_transform_action(action_type: str = "ADD_TRANSFORM", **spec_overrides) -> dict:
    """构造 Transform 动作工厂。"""
    spec = {"type": "RegexExtract", "inputFromNode": "users", "inputColumn": "email"}
    spec.update(spec_overrides)
    return {"actionType": action_type, "transformSpec": spec}


def make_settings_action(**spec_overrides) -> dict:
    """构造设置动作工厂。"""
    spec = {"category": "validation", "settings": {"strict": True}}
    spec.update(spec_overrides)
    return {"actionType": "UPDATE_SETTINGS", "settingsSpec": spec}


class TestDescriptionMappingGuard:
    """描述映射完整性：全部写盘动作 + canvas 只读动作都必须有静态中文描述。"""

    def test_all_write_actions_have_descriptions(self):
        """新增写盘动作类型时必须同步登记中文描述，否则确认清单退化显示英文类型名。"""
        missing = WRITE_ACTION_TYPES - set(ACTION_TYPE_DESCRIPTIONS)
        assert not missing, f"缺少动作描述条目: {missing}"

    def test_mapping_only_contains_known_action_types(self):
        """映射中的 key 必须都是注册表已知动作（防拼写错误静默失效）。"""
        unknown = set(ACTION_TYPE_DESCRIPTIONS) - set(ACTIONS)
        assert not unknown, f"映射含未注册动作类型: {unknown}"

    def test_unknown_type_falls_back_to_type_name(self):
        """未登记类型回退英文类型名（与 legacy .get(action_type, action_type) 一致）。"""
        assert describe_action_type("FUTURE_ACTION") == "FUTURE_ACTION"


class TestExtractActionTarget:
    """目标提取（迁移自 ApplyActionsTool._extract_action_target，行为不变）。"""

    def test_constraint_action_extracts_table_and_column(self):
        table, column = extract_action_target(make_constraint_action())
        assert (table, column) == ("users", "email")

    def test_constraint_action_falls_back_to_node_ids(self):
        """tableName 缺失时回退 targetNodeId/targetColumnId。"""
        action = make_constraint_action(targetNodeId="sc_users", targetColumnId="col_email")
        action["constraintSpec"].pop("tableName")
        action["constraintSpec"].pop("targetColumn")
        assert extract_action_target(action) == ("sc_users", "col_email")

    def test_schema_action_extracts_name(self):
        assert extract_action_target(make_schema_action()) == ("orders", None)

    def test_regex_action_has_no_target(self):
        assert extract_action_target(make_regex_action()) == (None, None)

    def test_transform_action_extracts_input(self):
        assert extract_action_target(make_transform_action()) == ("users", "email")


class TestSummarizeAction:
    """一行语义摘要：两阶段确认 payload actions 字段的输入→输出映射。"""

    def test_constraint_summary_combines_target_and_type(self):
        summary = summarize_action(make_constraint_action())
        assert summary == {
            "action_type": "ADD_CONSTRAINT_NODE",
            "description": "添加约束：users.email — NotNull",
            "target": "users.email",
        }

    def test_constraint_summary_without_column_uses_table_only(self):
        """表级约束（如 Composite）无列目标 → 摘要只到表名。"""
        action = make_constraint_action(type="Composite")
        action["constraintSpec"].pop("targetColumn")
        summary = summarize_action(action)
        assert summary["description"] == "添加约束：users — Composite"
        assert summary["target"] == "users"

    def test_delete_constraint_prefix(self):
        summary = summarize_action(make_constraint_action("DELETE_CONSTRAINT_NODE"))
        assert summary["description"] == "删除约束：users.email — NotNull"

    def test_schema_summary_uses_name(self):
        summary = summarize_action(make_schema_action())
        assert summary == {
            "action_type": "ADD_SCHEMA",
            "description": "创建表：orders",
            "target": "orders",
        }

    def test_regex_summary_uses_node_name(self):
        summary = summarize_action(make_regex_action())
        assert summary == {
            "action_type": "ADD_REGEX",
            "description": "创建正则校验：email_pattern",
            "target": None,
        }

    def test_transform_summary_uses_sub_type(self):
        summary = summarize_action(make_transform_action())
        assert summary["action_type"] == "ADD_TRANSFORM"
        assert summary["description"] == "创建数据转换：RegexExtract"
        assert summary["target"] == "users.email"

    def test_settings_summary_uses_category(self):
        summary = summarize_action(make_settings_action())
        assert summary == {
            "action_type": "UPDATE_SETTINGS",
            "description": "修改项目设置：validation",
            "target": None,
        }

    def test_unknown_action_falls_back_to_type_name(self):
        """未登记动作 → description 回退英文类型名（保守展示，不抛异常）。"""
        summary = summarize_action({"actionType": "FUTURE_ACTION", "someSpec": {}})
        assert summary == {"action_type": "FUTURE_ACTION", "description": "FUTURE_ACTION", "target": None}


class TestFormatConfirmLines:
    """legacy confirm_actions 的多行展示格式回归（提取前后输出一致）。"""

    def test_constraint_two_line_format(self):
        assert format_confirm_lines(make_constraint_action(), 1) == [
            "  1. 添加约束",
            "     表: users, 字段: email, 类型: NotNull",
        ]

    def test_schema_with_columns_lists_column_names(self):
        action = make_schema_action(columns=[{"name": "id"}, {"name": "amount"}])
        assert format_confirm_lines(action, 2) == [
            "  2. 创建表: orders",
            "     列: id, amount",
        ]

    def test_schema_without_columns_single_line(self):
        action = make_schema_action()
        action["schemaSpec"].pop("columns")
        assert format_confirm_lines(action, 1) == ["  1. 创建表: orders"]

    def test_validate_project_all_tables(self):
        assert format_confirm_lines({"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}, 3) == ["  3. 校验所有表"]

    def test_validate_project_single_table(self):
        action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {"tableName": "users"}}
        assert format_confirm_lines(action, 1) == ["  1. 校验表: users"]

    def test_validate_project_table_list(self):
        action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {"tables": ["users", "orders"]}}
        assert format_confirm_lines(action, 1) == ["  1. 校验 2 张表: users, orders"]

    def test_add_to_canvas_format(self):
        action = {"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"}}
        assert format_confirm_lines(action, 4) == ["  4. 显示到画布（只读）: schema / sc_users"]

    def test_regex_format(self):
        assert format_confirm_lines(make_regex_action(), 5) == ["  5. 创建正则校验: email_pattern"]

    def test_transform_format(self):
        assert format_confirm_lines(make_transform_action(), 6) == ["  6. 创建数据转换: RegexExtract"]

    def test_settings_two_line_format(self):
        action = make_settings_action(settings={"strict": True})
        assert format_confirm_lines(action, 7) == [
            "  7. 修改项目设置: validation",
            "     设置: {'strict': True}",
        ]

    def test_unknown_action_single_line(self):
        assert format_confirm_lines({"actionType": "FUTURE_ACTION"}, 8) == ["  8. FUTURE_ACTION"]


class TestConfirmActionsRegression:
    """confirm_actions 提取重构后的端到端行为回归（展示 + 决策语义不变）。"""

    def test_confirm_on_yes_renders_legacy_output(self, monkeypatch, capsys):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "y")
        actions = [
            make_constraint_action(),
            {"actionType": "VALIDATE_PROJECT", "constraintSpec": {"tableName": "users"}},
        ]
        assert confirm_actions(actions, "给 email 加非空") is True
        out = capsys.readouterr().out
        assert "即将执行以下操作:" in out
        assert "说明: 给 email 加非空" in out
        assert "  1. 添加约束" in out
        assert "     表: users, 字段: email, 类型: NotNull" in out
        assert "  2. 校验表: users" in out

    def test_reject_on_non_yes_input(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "n")
        assert confirm_actions([make_constraint_action()], "") is False

    def test_reject_on_empty_input(self, monkeypatch):
        monkeypatch.setattr("builtins.input", lambda *a, **k: "")
        assert confirm_actions([make_constraint_action()], "") is False

    def test_eof_returns_false(self, monkeypatch):
        def raise_eof(*a, **k):
            raise EOFError

        monkeypatch.setattr("builtins.input", raise_eof)
        assert confirm_actions([make_constraint_action()], "") is False


@pytest.mark.parametrize(
    "action_type,expected_desc",
    [
        ("ADD_CONSTRAINT_NODE", "添加约束"),
        ("UPDATE_CONSTRAINT_NODE", "更新约束"),
        ("DELETE_CONSTRAINT_NODE", "删除约束"),
        ("ADD_SCHEMA", "创建表"),
        ("UPDATE_SCHEMA", "修改表结构"),
        ("DELETE_SCHEMA", "删除表"),
        ("ADD_REGEX", "创建正则校验"),
        ("UPDATE_REGEX", "更新正则校验"),
        ("DELETE_REGEX", "删除正则校验"),
        ("ADD_TRANSFORM", "创建数据转换"),
        ("UPDATE_TRANSFORM", "更新数据转换"),
        ("DELETE_TRANSFORM", "删除数据转换"),
        ("UPDATE_SETTINGS", "修改项目设置"),
    ],
)
def test_write_action_descriptions(action_type: str, expected_desc: str):
    """13 种写盘动作的中文描述逐一锁定（单一事实源文案不许漂移）。"""
    assert describe_action_type(action_type) == expected_desc
