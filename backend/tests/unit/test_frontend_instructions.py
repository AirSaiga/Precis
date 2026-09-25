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
"""@fileoverview frontend_instructions 生成器单元测试（v2 变更集信封契约）

契约文档：docs/contracts/frontend-instructions-v2.md

重点验证：
- 信封六字段完整性（instructionId/actionType/op/kind/entityId/filePath），不携带实体数据
- entityId 与磁盘文件真实 id 恒等（ADD/UPDATE 重读磁盘；DELETE 走 handler 回传 resolved_id）
- 内联约束降级为 kind=schema 的 update 条目（同一 schema 多操作 instructionId 去重）
- ADD_TO_CANVAS 统一到同一信封（op=add，by-name 解析出真实 id）
- UPDATE_SETTINGS / 未知动作返回 None
"""

from __future__ import annotations

import json
import os

import yaml

from app.shared.services.llm.actions.action_processor import process_actions
from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions

# 信封必须有且仅有的六个字段
_ENVELOPE_KEYS = {"instructionId", "actionType", "op", "kind", "entityId", "filePath"}


def _write_yaml(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True)


def _make_workspace(tmp_path) -> str:
    """构造含 users 表（id=sc_users，name=users）的项目工作区。"""
    ws = str(tmp_path)
    _write_yaml(
        os.path.join(ws, "schemas", "sc_users.schema.yaml"),
        {
            "version": 2,
            "id": "sc_users",
            "name": "users",
            "columns": [
                {"id": "col_email", "name": "email", "type": "string"},
                {"id": "col_age", "name": "age", "type": "integer"},
            ],
        },
    )
    return ws


def _assert_envelope(instruction: dict, op: str, kind: str, entity_id: str, file_path: str, action_type: str) -> None:
    """断言信封字段完整性与确定性 instructionId。"""
    assert set(instruction.keys()) == _ENVELOPE_KEYS, f"信封字段漂移: {sorted(instruction.keys())}"
    assert instruction["op"] == op
    assert instruction["kind"] == kind
    assert instruction["entityId"] == entity_id
    assert instruction["filePath"] == file_path
    assert instruction["actionType"] == action_type
    assert instruction["instructionId"] == f"{op}:{kind}:{entity_id}"
    # 不携带任何实体数据（v1 镜像通道已废弃）
    assert "columns" not in json.dumps(instruction)
    assert "params" not in json.dumps(instruction)
    assert "config" not in json.dumps(instruction)


class TestSchemaEnvelope:
    def test_add_envelope_from_disk(self, tmp_path):
        """ADD_SCHEMA：重读磁盘拿真实 id 与路径（entityId ≡ 文件 id）。"""
        ws = _make_workspace(tmp_path)
        action = {
            "actionType": "ADD_SCHEMA",
            "schemaSpec": {"name": "orders", "schemaId": "sc_orders", "columns": [{"name": "id", "type": "integer"}]},
        }
        # 模拟 handler 已落盘（生成器在 handler 成功后调用）
        _write_yaml(
            os.path.join(ws, "schemas", "sc_orders.schema.yaml"),
            {
                "version": 2,
                "id": "sc_orders",
                "name": "orders",
                "columns": [{"id": "id", "name": "id", "type": "integer"}],
            },
        )
        instruction = generate_frontend_instructions(action, ws)
        _assert_envelope(instruction, "add", "schema", "sc_orders", "schemas/sc_orders.schema.yaml", "ADD_SCHEMA")

    def test_update_by_name_resolves_real_id(self, tmp_path):
        """UPDATE_SCHEMA 只给 name：entityId 必须解析为磁盘真实 id（sc_users 而非 users）。"""
        ws = _make_workspace(tmp_path)
        action = {
            "actionType": "UPDATE_SCHEMA",
            "schemaSpec": {"name": "users", "columns": [{"name": "phone", "type": "string"}]},
        }
        instruction = generate_frontend_instructions(action, ws)
        _assert_envelope(instruction, "update", "schema", "sc_users", "schemas/sc_users.schema.yaml", "UPDATE_SCHEMA")

    def test_delete_uses_resolved_id(self, tmp_path):
        """DELETE_SCHEMA：文件已删无法重读，用 handler 回传的 resolved_id。"""
        action = {"actionType": "DELETE_SCHEMA", "schemaSpec": {"name": "users"}}
        instruction = generate_frontend_instructions(action, str(tmp_path), resolved_id="sc_users")
        _assert_envelope(instruction, "remove", "schema", "sc_users", "schemas/sc_users.schema.yaml", "DELETE_SCHEMA")

    def test_delete_falls_back_to_spec_key(self, tmp_path):
        """DELETE 无 resolved_id 时退回 spec key（尽力推导，不抛错）。"""
        action = {"actionType": "DELETE_SCHEMA", "schemaSpec": {"schemaId": "sc_users"}}
        instruction = generate_frontend_instructions(action, str(tmp_path))
        _assert_envelope(instruction, "remove", "schema", "sc_users", "schemas/sc_users.schema.yaml", "DELETE_SCHEMA")


class TestConstraintEnvelope:
    def test_standalone_add_id_parity_with_written_file(self, tmp_path):
        """独立约束 ADD：entityId 与写盘路径实际写出的文件名恒等（NOT_NULL 别名同样对齐）。"""
        ws = _make_workspace(tmp_path)
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "NOT_NULL",
                "tableName": "users",
                "targetColumn": "email",
                "params": {"x": 1},
            },
        }
        # 走真实写盘路径，再生成指令——两者必须指向同一文件
        result = process_actions([action], ws)
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        _assert_envelope(
            instruction,
            "add",
            "constraint",
            "notnull_users_email",
            "constraints/notnull_users_email.constraint.yaml",
            "ADD_CONSTRAINT_NODE",
        )
        # 恒等校验：磁盘上确有该文件，且内容 id == entityId
        disk_file = os.path.join(ws, "constraints", "notnull_users_email.constraint.yaml")
        assert os.path.isfile(disk_file)
        with open(disk_file, encoding="utf-8") as f:
            assert yaml.safe_load(f)["id"] == "notnull_users_email"

    def test_standalone_remove(self, tmp_path):
        """独立约束 DELETE：op=remove，id 派生与删除路径一致。"""
        instruction = generate_frontend_instructions(
            {
                "actionType": "DELETE_CONSTRAINT_NODE",
                "constraintSpec": {"type": "NotNull", "tableName": "users", "targetColumn": "email"},
            },
            str(tmp_path),
        )
        _assert_envelope(
            instruction,
            "remove",
            "constraint",
            "notnull_users_email",
            "constraints/notnull_users_email.constraint.yaml",
            "DELETE_CONSTRAINT_NODE",
        )

    def test_standalone_update(self, tmp_path):
        instruction = generate_frontend_instructions(
            {
                "actionType": "UPDATE_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "Range",
                    "tableName": "users",
                    "targetColumn": "age",
                    "params": {"min": 18, "max": 60},
                },
            },
            str(tmp_path),
        )
        _assert_envelope(
            instruction,
            "update",
            "constraint",
            "range_users_age",
            "constraints/range_users_age.constraint.yaml",
            "UPDATE_CONSTRAINT_NODE",
        )

    def test_inline_degrades_to_schema_update(self, tmp_path):
        """内联约束：无独立磁盘实体，降级为 kind=schema 的 update 条目。"""
        ws = _make_workspace(tmp_path)
        instruction = generate_frontend_instructions(
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"type": "NotNull", "tableName": "users", "targetColumn": "email", "isInline": True},
            },
            ws,
        )
        _assert_envelope(
            instruction, "update", "schema", "sc_users", "schemas/sc_users.schema.yaml", "ADD_CONSTRAINT_NODE"
        )

    def test_inline_delete_also_schema_update(self, tmp_path):
        """内联 DELETE：宿主 schema 文件仍存在，仍是 update:schema 条目。"""
        ws = _make_workspace(tmp_path)
        instruction = generate_frontend_instructions(
            {
                "actionType": "DELETE_CONSTRAINT_NODE",
                "constraintSpec": {"type": "NotNull", "tableName": "users", "targetColumn": "email", "isInline": True},
            },
            ws,
        )
        _assert_envelope(
            instruction, "update", "schema", "sc_users", "schemas/sc_users.schema.yaml", "DELETE_CONSTRAINT_NODE"
        )

    def test_inline_batch_same_instruction_id(self, tmp_path):
        """同一 schema 的两条内联操作产出相同 instructionId（天然去重为一次重读）。"""
        ws = _make_workspace(tmp_path)
        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"type": "NOT_NULL", "tableName": "users", "targetColumn": "email", "isInline": True},
            },
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "RANGE",
                    "tableName": "users",
                    "targetColumn": "age",
                    "params": {"min": 0},
                    "isInline": True,
                },
            },
        ]
        result = process_actions(actions, ws)
        assert result["success"] is True
        ids = {r["frontendInstructions"]["instructionId"] for r in result["results"]}
        assert ids == {"update:schema:sc_users"}


class TestRegexEnvelope:
    def test_update_rereads_real_id(self, tmp_path):
        """UPDATE_REGEX：重读磁盘（regex/ 与历史 regex_nodes/ 均可命中）。"""
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "regex", "rx_phone.regex.yaml"),
            {"id": "rx_phone", "name": "phone", "pattern": r"^\d{11}$", "matchMode": "full"},
        )
        instruction = generate_frontend_instructions(
            {"actionType": "UPDATE_REGEX", "regexSpec": {"regexId": "rx_phone", "pattern": "old"}},
            ws,
        )
        _assert_envelope(instruction, "update", "regex", "rx_phone", "regex/rx_phone.regex.yaml", "UPDATE_REGEX")

    def test_update_by_name_finds_legacy_dir(self, tmp_path):
        """历史 regex_nodes/ 目录同样可定位（与 _find_regex_file 口径一致）。"""
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "regex_nodes", "rx_phone.yaml"),
            {"id": "rx_phone", "name": "phone", "pattern": "p", "matchMode": "full"},
        )
        instruction = generate_frontend_instructions(
            {"actionType": "UPDATE_REGEX", "regexSpec": {"name": "phone"}},
            ws,
        )
        _assert_envelope(instruction, "update", "regex", "rx_phone", "regex_nodes/rx_phone.yaml", "UPDATE_REGEX")

    def test_delete_uses_resolved_id(self, tmp_path):
        instruction = generate_frontend_instructions(
            {"actionType": "DELETE_REGEX", "regexSpec": {"name": "phone"}},
            str(tmp_path),
            resolved_id="rx_phone",
        )
        _assert_envelope(instruction, "remove", "regex", "rx_phone", "regex/rx_phone.regex.yaml", "DELETE_REGEX")


class TestTransformEnvelope:
    def test_add_without_explicit_id_rereads_disk(self, tmp_path):
        """ADD_TRANSFORM 未显式给 id（写盘侧自动生成含哈希）：真实管线产出真实 entityId。"""
        ws = _make_workspace(tmp_path)
        result = process_actions(
            [
                {
                    "actionType": "ADD_TRANSFORM",
                    "transformSpec": {"type": "UpperCase", "inputFromNode": "sc_users", "inputColumn": "email"},
                }
            ],
            ws,
        )
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        entity_id = instruction["entityId"]
        assert entity_id.startswith("uppercase_")
        # 恒等校验：entityId 即磁盘文件名推导 id 与内容 id
        assert os.path.isfile(os.path.join(ws, "transforms", f"{entity_id}.transform.yaml"))
        with open(os.path.join(ws, "transforms", f"{entity_id}.transform.yaml"), encoding="utf-8") as f:
            assert yaml.safe_load(f)["id"] == entity_id
        _assert_envelope(
            instruction, "add", "transform", entity_id, f"transforms/{entity_id}.transform.yaml", "ADD_TRANSFORM"
        )

    def test_update_matches_by_content_id_only(self, tmp_path):
        """Transform 定位仅按内容 id 匹配（与 _find_transform_file 口径一致）。"""
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "transforms", "tf1.transform.yaml"),
            {"version": 2, "id": "tf1", "type": "UpperCase", "params": {}},
        )
        instruction = generate_frontend_instructions(
            {"actionType": "UPDATE_TRANSFORM", "transformSpec": {"transformId": "tf1", "params": {"x": 1}}},
            ws,
        )
        _assert_envelope(instruction, "update", "transform", "tf1", "transforms/tf1.transform.yaml", "UPDATE_TRANSFORM")


class TestCanvasEnvelope:
    def test_add_to_canvas_by_id(self, tmp_path):
        """ADD_TO_CANVAS：统一到同一信封（op=add），entityId 为磁盘真实 id。"""
        ws = _make_workspace(tmp_path)
        instruction = generate_frontend_instructions(
            {"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"}},
            ws,
        )
        _assert_envelope(instruction, "add", "schema", "sc_users", "schemas/sc_users.schema.yaml", "ADD_TO_CANVAS")

    def test_add_to_canvas_by_name_resolves_id(self, tmp_path):
        """ADD_TO_CANVAS 只给 resourceName：解析出磁盘真实 id。"""
        ws = _make_workspace(tmp_path)
        instruction = generate_frontend_instructions(
            {"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "schema", "resourceName": "users"}},
            ws,
        )
        _assert_envelope(instruction, "add", "schema", "sc_users", "schemas/sc_users.schema.yaml", "ADD_TO_CANVAS")

    def test_add_to_canvas_regex(self, tmp_path):
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "regex", "rx_email.regex.yaml"),
            {"id": "rx_email", "name": "邮箱格式", "pattern": r"^\w+@\w+\.\w+$", "matchMode": "full"},
        )
        instruction = generate_frontend_instructions(
            {"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "regex", "resourceId": "rx_email"}},
            ws,
        )
        _assert_envelope(instruction, "add", "regex", "rx_email", "regex/rx_email.regex.yaml", "ADD_TO_CANVAS")

    def test_add_to_canvas_invalid_kind_returns_none(self, tmp_path):
        instruction = generate_frontend_instructions(
            {"actionType": "ADD_TO_CANVAS", "canvasSpec": {"resourceKind": "datasource", "resourceId": "x"}},
            str(tmp_path),
        )
        assert instruction is None


class TestNoneReturns:
    def test_update_settings_returns_none(self, tmp_path):
        """UPDATE_SETTINGS 无独立实体文件，不产生变更集条目。"""
        action = {
            "actionType": "UPDATE_SETTINGS",
            "settingsSpec": {"category": "validation", "settings": {"error_handling": "stop"}},
        }
        assert generate_frontend_instructions(action, str(tmp_path)) is None

    def test_unknown_action_returns_none(self, tmp_path):
        assert generate_frontend_instructions({"actionType": "TOTALLY_UNKNOWN"}, str(tmp_path)) is None


class TestPipelineEntityIdIdentity:
    """端到端恒等：真实管线（handler 写盘 + 指令生成）中 entityId ≡ 磁盘文件 id。"""

    def test_delete_schema_by_name_uses_real_id(self, tmp_path):
        """DELETE_SCHEMA 只给 name：经 handler resolved_id 回传，entityId 是真实 id 而非 name。"""
        ws = _make_workspace(tmp_path)
        result = process_actions([{"actionType": "DELETE_SCHEMA", "schemaSpec": {"name": "users"}}], ws)
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        assert instruction["entityId"] == "sc_users"
        assert instruction["op"] == "remove"
        assert not os.path.exists(os.path.join(ws, "schemas", "sc_users.schema.yaml"))

    def test_delete_regex_by_name_uses_real_id(self, tmp_path):
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "regex", "rx_phone.regex.yaml"),
            {"id": "rx_phone", "name": "phone", "pattern": "p", "matchMode": "full"},
        )
        result = process_actions([{"actionType": "DELETE_REGEX", "regexSpec": {"name": "phone"}}], ws)
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        assert instruction["entityId"] == "rx_phone"
        assert instruction["op"] == "remove"

    def test_delete_transform_uses_real_id(self, tmp_path):
        ws = _make_workspace(tmp_path)
        _write_yaml(
            os.path.join(ws, "transforms", "tf1.transform.yaml"),
            {"version": 2, "id": "tf1", "type": "UpperCase", "params": {}},
        )
        result = process_actions([{"actionType": "DELETE_TRANSFORM", "transformSpec": {"transformId": "tf1"}}], ws)
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        assert instruction["entityId"] == "tf1"
        assert instruction["op"] == "remove"

    def test_rollback_clears_write_instructions(self, tmp_path):
        """P0 行为不破坏：批次回滚后写盘动作的指令被清空（幽灵指令不得下发）。"""
        ws = _make_workspace(tmp_path)
        actions = [
            # 第二个动作必然失败：目标表不存在
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "orders", "columns": [{"name": "id", "type": "integer"}]},
            },
            {"actionType": "DELETE_SCHEMA", "schemaSpec": {"name": "ghost_table"}},
        ]
        result = process_actions(actions, ws)
        assert result["success"] is False
        assert all(r["frontendInstructions"] is None for r in result["results"])
