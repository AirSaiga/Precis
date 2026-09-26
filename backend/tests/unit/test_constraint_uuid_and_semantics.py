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
"""@fileoverview 约束 ID UUID 化行为测试（生成/查重/删除/信封四链路）

覆盖约束缺省 ID 从语义派生改为 {类型}_{UUID v4} 后的行为：
- 缺省 id 形如 {类型小写}_{UUID v4}（保留类型前缀是 E2E ai-fake-provider
  spec 按 `charset_` 前缀定位约束文件的既有契约，任务范围禁止改 TS）
- 显式 constraintId 生效且经文件名安全清洗；穿越 ID 被拒
- 碰撞回归：同表两个全角括号列各加一条同类型约束，两条都成功且 id 不同
  （旧派生方案两列清洗后都是 col，第二条被误判"约束已存在"）
- 语义查重：完全相同（表+列+类型）的重复 ADD 被拦截（UUID 不同也算重复）
- 删除：UUID 文件按 id 删 / 按语义引用删；存量语义 ID 文件按语义引用也能删
- 信封 entityId ≡ 落盘文件 id（ADD 用实际写盘 id；DELETE 用删前真实 id）
- 内联约束路径同步覆盖（缺省 id / 显式 id / 更新保留 id / 删除回传被删项 id）
"""

from __future__ import annotations

import uuid

import pytest
import yaml

from app.shared.services.llm.actions.action_handlers import update_yaml_config
from app.shared.services.llm.actions.action_processor import process_actions
from app.shared.services.llm.constraints.constraint_lookup import (
    default_constraint_id,
    sanitize_constraint_id,
)

# 员工信息表：两个全角括号列（旧派生方案清洗后都坍缩为 col 的碰撞场景）
_SCHEMA_EMP = {
    "version": 2,
    "id": "sc_emp",
    "name": "员工信息b",
    "columns": [
        {"id": "c_salary", "name": "月薪（元）", "type": "integer"},
        {"id": "c_annual", "name": "年薪（元）", "type": "integer"},
    ],
}


def _make_workspace(tmp_path, schema: dict | None = None) -> str:
    """构造含一张表的项目工作区，返回路径字符串。"""
    ws = tmp_path / "proj"
    (ws / "schemas").mkdir(parents=True)
    (ws / "constraints").mkdir()
    data = schema if schema is not None else _SCHEMA_EMP
    (ws / "schemas" / f"{data['id']}.schema.yaml").write_text(
        yaml.safe_dump(data, allow_unicode=True), encoding="utf-8"
    )
    return str(ws)


def _add_action(column: str, constraint_id: str | None = None, action_type: str = "ADD_CONSTRAINT_NODE") -> dict:
    spec = {
        "type": "Range",
        "tableName": _SCHEMA_EMP["name"],
        "targetNodeId": _SCHEMA_EMP["id"],
        "targetColumn": column,
        "isInline": False,
        "params": {"min": 0},
    }
    if constraint_id is not None:
        spec["constraintId"] = constraint_id
    return {"actionType": action_type, "constraintSpec": spec}


def _read_constraint(ws: str, constraint_id: str) -> dict:
    path = f"{ws}/constraints/{constraint_id}.constraint.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _write_legacy_constraint(ws: str, constraint_id: str, column_id: str, ctype: str = "Range") -> None:
    """写入一个存量语义派生 ID 的约束文件（UUID 化之前的历史产物）。"""
    with open(f"{ws}/constraints/{constraint_id}.constraint.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(
            {
                "version": 2,
                "id": constraint_id,
                "type": ctype,
                "enabled": True,
                "refs": {"table_id": _SCHEMA_EMP["id"], "column_id": column_id},
                "params": {"min": 0},
            },
            f,
            allow_unicode=True,
        )


# ============================================================
# 缺省 ID 生成
# ============================================================


class TestDefaultConstraintId:
    def test_default_id_is_type_prefixed_uuid_v4(self):
        """缺省 id 形如 {类型小写}_{UUID v4}：前缀保留类型可读性（E2E 按前缀定位文件），尾部为合法 UUID v4。"""
        cid = default_constraint_id("Range")
        prefix, _, uuid_part = cid.partition("_")
        assert prefix == "range"
        parsed = uuid.UUID(uuid_part)
        assert parsed.version == 4

    def test_default_ids_never_collide(self):
        ids = {default_constraint_id("NotNull") for _ in range(200)}
        assert len(ids) == 200


class TestSanitizeConstraintId:
    def test_plain_id_unchanged(self):
        assert sanitize_constraint_id("my_constraint-1") == "my_constraint-1"

    def test_empty_returns_empty_string(self):
        assert sanitize_constraint_id(None) == ""
        assert sanitize_constraint_id("") == ""
        assert sanitize_constraint_id("   ") == ""

    def test_unsafe_chars_replaced(self):
        # 中文与空格替换为 _，首尾剥离
        assert sanitize_constraint_id("a b") == "a_b"
        assert sanitize_constraint_id("约束1") == "1"
        # 全部字符非法 → 清洗后为空，按非法 ID 拒绝
        with pytest.raises(ValueError, match="非法"):
            sanitize_constraint_id("约束 甲")

    def test_traversal_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            sanitize_constraint_id("../etc/passwd")
        with pytest.raises(ValueError, match="非法"):
            sanitize_constraint_id("a/b")
        with pytest.raises(ValueError, match="非法"):
            sanitize_constraint_id("a\\b")


# ============================================================
# 生成链路（独立约束）
# ============================================================


class TestStandaloneGeneration:
    def test_add_without_constraint_id_generates_prefixed_uuid(self, tmp_path):
        """新建约束缺省 id：类型前缀 + 合法 UUID v4，文件名/内容 id/manifest 三处一致。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）"), ws)
        assert success is True, cid

        prefix, _, uuid_part = cid.partition("_")
        assert prefix == "range"
        assert uuid.UUID(uuid_part).version == 4

        data = _read_constraint(ws, cid)
        assert data["id"] == cid
        assert data["refs"]["column_id"] == "c_salary"

    def test_add_with_explicit_constraint_id_respected_and_sanitized(self, tmp_path):
        """LLM 显式 constraintId 生效，且经文件名安全清洗（非法字符替换）。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）", constraint_id="My Range#1"), ws)
        assert success is True, cid
        assert cid == "My_Range_1"
        assert _read_constraint(ws, cid)["id"] == "My_Range_1"

    def test_add_with_traversal_constraint_id_rejected(self, tmp_path):
        ws = _make_workspace(tmp_path)
        success, msg = update_yaml_config(_add_action("月薪（元）", constraint_id="../evil"), ws)
        assert success is False
        assert "非法" in msg

    def test_fullwidth_paren_columns_no_collision(self, tmp_path):
        """碰撞回归：同表两个全角括号列各加一条同类型约束，两条都成功且 id 不同。

        旧派生方案把「月薪（元）」「年薪（元）」都清洗成 col，
        第二条约束因派生 ID 撞名被误判"约束已存在"创建失败。
        """
        ws = _make_workspace(tmp_path)
        ok1, cid1 = update_yaml_config(_add_action("月薪（元）"), ws)
        ok2, cid2 = update_yaml_config(_add_action("年薪（元）"), ws)
        assert ok1 is True, cid1
        assert ok2 is True, cid2
        assert cid1 != cid2
        # 两个文件都在磁盘上，且各自指向正确的列
        assert _read_constraint(ws, cid1)["refs"]["column_id"] == "c_salary"
        assert _read_constraint(ws, cid2)["refs"]["column_id"] == "c_annual"

    def test_semantic_duplicate_add_rejected(self, tmp_path):
        """语义查重：完全相同（表+列+类型）重复添加被拦截，错误信息含既有约束 id。"""
        ws = _make_workspace(tmp_path)
        ok1, cid1 = update_yaml_config(_add_action("月薪（元）"), ws)
        assert ok1 is True

        ok2, msg2 = update_yaml_config(_add_action("月薪（元）"), ws)
        assert ok2 is False
        assert "已存在" in msg2
        assert cid1 in msg2
        # 磁盘上仍只有一个约束文件（未产出 UUID 不同的双份）
        import os

        assert len(os.listdir(f"{ws}/constraints")) == 1

    def test_semantic_duplicate_matches_legacy_file_by_name(self, tmp_path):
        """语义查重对存量语义 ID 文件同样生效（按内容 refs 匹配，不看文件名形状）。"""
        ws = _make_workspace(tmp_path)
        _write_legacy_constraint(ws, "range_ygxxb_col", "c_salary")

        ok, msg = update_yaml_config(_add_action("月薪（元）"), ws)
        assert ok is False
        assert "已存在" in msg
        assert "range_ygxxb_col" in msg

    def test_update_locates_by_semantics_and_preserves_id(self, tmp_path):
        """UPDATE 未传 id：按语义定位既有文件原地覆写，保留原 id（含存量语义 ID 文件）。"""
        ws = _make_workspace(tmp_path)
        _write_legacy_constraint(ws, "range_ygxxb_col", "c_salary")

        ok, cid = update_yaml_config(
            {
                "actionType": "UPDATE_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "Range",
                    "tableName": _SCHEMA_EMP["name"],
                    "targetColumn": "月薪（元）",
                    "isInline": False,
                    "params": {"min": 10, "max": 100},
                },
            },
            ws,
        )
        assert ok is True, cid
        assert cid == "range_ygxxb_col"
        data = _read_constraint(ws, cid)
        assert data["params"]["min"] == 10
        assert data["params"]["max"] == 100

    def test_update_by_explicit_id_locates_file(self, tmp_path):
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）"), ws)
        assert success is True

        action = _add_action("月薪（元）", constraint_id=cid, action_type="UPDATE_CONSTRAINT_NODE")
        ok, cid2 = update_yaml_config(action, ws)
        assert ok is True
        assert cid2 == cid


# ============================================================
# 删除链路
# ============================================================


class TestConstraintDeletion:
    def test_delete_uuid_file_by_explicit_id(self, tmp_path):
        """UUID 文件按显式 constraintId 删：返回被删文件真实 id，manifest 引用同步移除。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）"), ws)
        assert success is True

        import os

        manifest_path = f"{ws}/project.precis.yaml"
        with open(manifest_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                {
                    "version": 2,
                    "project": {"id": "p1", "name": "p1"},
                    "schemas": [],
                    "constraints": [{"id": cid, "path": f"constraints/{cid}.constraint.yaml"}],
                },
                f,
            )

        action = _add_action("月薪（元）", constraint_id=cid, action_type="DELETE_CONSTRAINT_NODE")
        ok, msg = update_yaml_config(action, ws)
        assert ok is True, msg
        assert msg == cid
        assert not os.path.exists(f"{ws}/constraints/{cid}.constraint.yaml")
        with open(manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f)
        assert all(c["id"] != cid for c in manifest.get("constraints", []))

    def test_delete_uuid_file_by_semantic_reference(self, tmp_path):
        """UUID 文件未传 id：按语义引用（表+列+类型）磁盘搜索匹配删除。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("年薪（元）"), ws)
        assert success is True

        action = _add_action("年薪（元）", action_type="DELETE_CONSTRAINT_NODE")
        ok, msg = update_yaml_config(action, ws)
        assert ok is True, msg
        assert msg == cid
        import os

        assert not os.path.exists(f"{ws}/constraints/{cid}.constraint.yaml")

    def test_delete_legacy_semantic_id_file_by_semantic_reference(self, tmp_path):
        """存量语义 ID 文件（如 range_yg信息b_col）按语义引用也能删——表/列改名前的旧产物。"""
        ws = _make_workspace(tmp_path)
        _write_legacy_constraint(ws, "range_yg信息b_col", "c_salary")

        action = _add_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE")
        ok, msg = update_yaml_config(action, ws)
        assert ok is True, msg
        assert msg == "range_yg信息b_col"
        import os

        assert not os.path.exists(f"{ws}/constraints/range_yg信息b_col.constraint.yaml")

    def test_delete_semantic_match_skips_other_columns(self, tmp_path):
        """语义删除不误伤：同表同类型但不同列的约束保留。"""
        ws = _make_workspace(tmp_path)
        _write_legacy_constraint(ws, "range_yg信息b_col", "c_salary")
        _write_legacy_constraint(ws, "range_yg信息b_col2", "c_annual")

        action = _add_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE")
        ok, msg = update_yaml_config(action, ws)
        assert ok is True
        assert msg == "range_yg信息b_col"
        import os

        assert os.path.exists(f"{ws}/constraints/range_yg信息b_col2.constraint.yaml")

    def test_delete_by_id_only_without_column(self, tmp_path):
        """仅凭显式 constraintId（无列信息）也能删除。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）"), ws)
        assert success is True

        action = {
            "actionType": "DELETE_CONSTRAINT_NODE",
            "constraintSpec": {"type": "Range", "tableName": _SCHEMA_EMP["name"], "constraintId": cid},
        }
        ok, msg = update_yaml_config(action, ws)
        assert ok is True, msg
        assert msg == cid

    def test_delete_not_found_fails(self, tmp_path):
        ws = _make_workspace(tmp_path)
        action = _add_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE")
        ok, msg = update_yaml_config(action, ws)
        assert ok is False
        assert "不存在" in msg


# ============================================================
# 信封链路（entityId ≡ 落盘文件 id）
# ============================================================


class TestEnvelopeEntityIdIdentity:
    def test_add_envelope_entity_id_equals_disk_file_id(self, tmp_path):
        """ADD：真实管线（handler 写盘 + processor 生成指令）entityId ≡ 磁盘文件 id。"""
        ws = _make_workspace(tmp_path)
        result = process_actions([_add_action("月薪（元）")], ws)
        assert result["success"] is True, result

        instruction = result["results"][0]["frontendInstructions"]
        entity_id = instruction["entityId"]
        assert instruction["op"] == "add"
        assert instruction["kind"] == "constraint"
        assert instruction["filePath"] == f"constraints/{entity_id}.constraint.yaml"
        data = _read_constraint(ws, entity_id)
        assert data["id"] == entity_id
        assert entity_id.startswith("range_")

    def test_delete_envelope_entity_id_is_real_deleted_id(self, tmp_path):
        """DELETE：文件已删无法重读，entityId 用 handler 删前解析的真实 id。"""
        ws = _make_workspace(tmp_path)
        success, cid = update_yaml_config(_add_action("月薪（元）"), ws)
        assert success is True

        result = process_actions([_add_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE")], ws)
        assert result["success"] is True
        instruction = result["results"][0]["frontendInstructions"]
        assert instruction["op"] == "remove"
        assert instruction["entityId"] == cid

    def test_generator_without_resolved_id_locates_disk_by_semantics(self, tmp_path):
        """直连生成器（无 resolved_id）：重读磁盘按语义定位，entityId 为文件内容 id。"""
        from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions

        ws = _make_workspace(tmp_path)
        _write_legacy_constraint(ws, "range_ygxxb_col", "c_salary")

        instruction = generate_frontend_instructions(
            _add_action("月薪（元）", action_type="UPDATE_CONSTRAINT_NODE"), ws
        )
        assert instruction is not None
        assert instruction["entityId"] == "range_ygxxb_col"
        assert instruction["filePath"] == "constraints/range_ygxxb_col.constraint.yaml"

    def test_generator_delete_without_resolved_id_or_disk_returns_none(self, tmp_path):
        """DELETE 后磁盘无据且无 resolved_id：不派生猜测 id，跳过指令（返回 None）。"""
        from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions

        instruction = generate_frontend_instructions(
            _add_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE"), str(tmp_path)
        )
        assert instruction is None


# ============================================================
# 内联约束路径
# ============================================================


class TestInlineConstraintIds:
    def _inline_action(self, column: str, action_type: str = "ADD_CONSTRAINT_NODE", constraint_id: str | None = None):
        spec = {
            "type": "NotNull",
            "tableName": _SCHEMA_EMP["name"],
            "targetNodeId": _SCHEMA_EMP["id"],
            "targetColumn": column,
            "isInline": True,
        }
        if constraint_id is not None:
            spec["constraintId"] = constraint_id
        return {"actionType": action_type, "constraintSpec": spec}

    def _schema_constraints(self, ws: str) -> list[dict]:
        with open(f"{ws}/schemas/sc_emp.schema.yaml", encoding="utf-8") as f:
            return yaml.safe_load(f).get("constraints", [])

    def test_inline_add_default_id_is_prefixed_uuid(self, tmp_path):
        ws = _make_workspace(tmp_path)
        ok, msg = update_yaml_config(self._inline_action("月薪（元）"), ws)
        assert ok is True
        assert msg.startswith("inline:")
        cid = msg.removeprefix("inline:")
        prefix, _, uuid_part = cid.partition("_")
        assert prefix == "notnull"
        assert uuid.UUID(uuid_part).version == 4
        assert self._schema_constraints(ws)[0]["id"] == cid

    def test_inline_add_explicit_id_respected(self, tmp_path):
        ws = _make_workspace(tmp_path)
        ok, msg = update_yaml_config(self._inline_action("月薪（元）", constraint_id="my_inline_nn"), ws)
        assert ok is True
        assert msg == "inline:my_inline_nn"
        assert self._schema_constraints(ws)[0]["id"] == "my_inline_nn"

    def test_inline_update_preserves_existing_id(self, tmp_path):
        """内联 UPDATE：替换参数但保留既有项 id（不因缺省 UUID 每次更新换 id）。"""
        ws = _make_workspace(tmp_path)
        ok, _ = update_yaml_config(self._inline_action("月薪（元）", constraint_id="nn_keep"), ws)
        assert ok is True

        ok, msg = update_yaml_config(self._inline_action("月薪（元）", action_type="UPDATE_CONSTRAINT_NODE"), ws)
        assert ok is True
        assert msg == "inline:nn_keep"
        assert self._schema_constraints(ws)[0]["id"] == "nn_keep"

    def test_inline_delete_returns_removed_item_id(self, tmp_path):
        """内联 DELETE：回传被删内联项自身的 id（不再派生）。"""
        ws = _make_workspace(tmp_path)
        ok, _ = update_yaml_config(self._inline_action("月薪（元）", constraint_id="nn_del_me"), ws)
        assert ok is True

        ok, msg = update_yaml_config(self._inline_action("月薪（元）", action_type="DELETE_CONSTRAINT_NODE"), ws)
        assert ok is True
        assert msg == "inline:nn_del_me"
        assert self._schema_constraints(ws) == []

    def test_inline_semantic_duplicate_replaces_not_duplicates(self, tmp_path):
        """内联语义查重：同列同类型重复 ADD 走既有项替换（不产生双份）。"""
        ws = _make_workspace(tmp_path)
        ok1, _ = update_yaml_config(self._inline_action("月薪（元）"), ws)
        ok2, _ = update_yaml_config(self._inline_action("月薪（元）"), ws)
        assert ok1 is True
        assert ok2 is True
        constraints = self._schema_constraints(ws)
        assert len(constraints) == 1
