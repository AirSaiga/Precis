"""@fileoverview frontend_instructions 生成器单元测试

重点验证 P1 的"UPDATE 重读磁盘"行为：
- UPDATE_SCHEMA 指令必须携带合并后的完整列（而非回声 LLM 增量，否则画布丢列）
- ADD 路径保持回声（输入即落盘结果）
- DELETE 只需 id/name 用于前端定位
"""

from __future__ import annotations

import os

import yaml

from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions


def _write_schema(workspace: str, schema_id: str, name: str, columns: list) -> None:
    """写入 schema 文件（模拟落盘后的真实状态）。"""
    schemas_dir = os.path.join(workspace, "schemas")
    os.makedirs(schemas_dir, exist_ok=True)
    with open(os.path.join(schemas_dir, f"{schema_id}.schema.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump({"id": schema_id, "name": name, "columns": columns}, f)


class TestGenerateSchemaInstruction:
    def test_update_rereads_merged_columns(self, tmp_path):
        """UPDATE_SCHEMA：磁盘已有 2 列，LLM 只声明 1 个新列 → 指令必须含 3 列（合并结果）。

        这是 P1 的核心修复——若回声 LLM 输入，画布会丢掉保留的列。
        """
        workspace = str(tmp_path)
        # 落盘状态：已有 name + email 两列（_update_schema 会保留它们）
        _write_schema(
            workspace,
            "sc_users",
            "users",
            [
                {"id": "col_name", "name": "name", "type": "string"},
                {"id": "col_email", "name": "email", "type": "string"},
            ],
        )
        # 模拟 _update_schema 执行后：磁盘已含 3 列（LLM 加的 phone 被合并进来）
        _write_schema(
            workspace,
            "sc_users",
            "users",
            [
                {"id": "col_name", "name": "name", "type": "string"},
                {"id": "col_email", "name": "email", "type": "string"},
                {"id": "col_phone", "name": "phone", "type": "string"},
            ],
        )

        # LLM 的 UPDATE action 只声明了 phone（增量）
        action = {
            "actionType": "UPDATE_SCHEMA",
            "schemaSpec": {
                "name": "users",
                "schemaId": "sc_users",
                "columns": [{"name": "phone", "type": "string"}],  # 仅增量
            },
        }
        instruction = generate_frontend_instructions(action, workspace)

        spec = instruction["schemaSpec"]
        col_names = [c["name"] for c in spec["columns"]]
        # 关键断言：含全部 3 列（name/email/phone），而非仅 phone
        assert set(col_names) == {"name", "email", "phone"}, f"UPDATE 指令丢列: {col_names}"

    def test_add_echoes_input_columns(self, tmp_path):
        """ADD_SCHEMA：回声输入列（ADD 时输入即落盘结果，无需重读）。"""
        workspace = str(tmp_path)
        action = {
            "actionType": "ADD_SCHEMA",
            "schemaSpec": {
                "name": "orders",
                "schemaId": "sc_orders",
                "columns": [{"name": "id", "type": "integer"}],
            },
        }
        instruction = generate_frontend_instructions(action, workspace)
        assert instruction["schemaSpec"]["columns"] == [{"name": "id", "type": "integer"}]

    def test_delete_carries_id_only(self, tmp_path):
        """DELETE_SCHEMA：只需 id/name 定位，不依赖磁盘（文件已删）。"""
        workspace = str(tmp_path)
        action = {
            "actionType": "DELETE_SCHEMA",
            "schemaSpec": {"name": "users", "schemaId": "sc_users"},
        }
        instruction = generate_frontend_instructions(action, workspace)
        assert instruction["schemaSpec"]["schemaId"] == "sc_users"
        assert instruction["schemaSpec"]["name"] == "users"


class TestGenerateRegexInstruction:
    def test_update_rereads_pattern(self, tmp_path):
        """UPDATE_REGEX：重读磁盘真实 pattern。"""
        workspace = str(tmp_path)
        regex_dir = os.path.join(workspace, "regex")
        os.makedirs(regex_dir)
        with open(os.path.join(regex_dir, "phone.regex.yaml"), "w", encoding="utf-8") as f:
            yaml.safe_dump({"pattern": r"^\d{11}$", "matchMode": "full", "caseSensitive": False}, f)

        action = {
            "actionType": "UPDATE_REGEX",
            "regexSpec": {"regexId": "phone", "name": "phone", "pattern": "old"},
        }
        instruction = generate_frontend_instructions(action, workspace)
        # 重读后应得磁盘上的真实 pattern
        assert instruction["regexSpec"]["pattern"] == r"^\d{11}$"

    def test_delete_regex_carries_id(self, tmp_path):
        """DELETE_REGEX：携带 id 用于前端定位。"""
        action = {"actionType": "DELETE_REGEX", "regexSpec": {"regexId": "phone", "name": "phone"}}
        instruction = generate_frontend_instructions(action, str(tmp_path))
        assert instruction["regexSpec"]["regexId"] == "phone"
