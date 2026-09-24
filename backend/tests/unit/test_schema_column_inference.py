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
@fileoverview ADD/UPDATE_SCHEMA 的列自动推断兜底测试

LLM 建 schema 常只给表名 + source.path（省略 columns），空壳 schema 会让后续
约束动作全部挂在"字段不存在"预验证上。本组测试验证推断兜底行为：
- ADD_SCHEMA 无 columns + source.path 指向真实数据文件 → 推断列落盘
- ADD_SCHEMA 无 columns + source.path 文件不存在 → 失败并给 LLM 修正指引
- ADD_SCHEMA 显式 columns → 不推断（显式定义优先）
- UPDATE_SCHEMA 空壳表不传 columns → 推断回填
"""

from __future__ import annotations

import yaml

from app.shared.services.llm.actions.schema_handlers import process_schema_action


def _make_workspace(tmp_path, csv_content: str = "编号,数量\nA1,10\nA2,20\n") -> None:
    """构造带数据文件的最小项目工作区。"""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "orders.csv").write_text(csv_content, encoding="utf-8")


def _read_schema(tmp_path, schema_id: str) -> dict:
    schema_file = tmp_path / "schemas" / f"{schema_id}.schema.yaml"
    with open(schema_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class TestAddSchemaColumnInference:
    """ADD_SCHEMA 的列推断兜底"""

    def test_infers_columns_when_missing(self, tmp_path):
        """无 columns + source.path 指向真实文件 → 推断列落盘，message 注明推断。"""
        _make_workspace(tmp_path)
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "orders",
                    "schemaId": "orders",
                    "source": {"path": "data/orders.csv", "type": "csv"},
                },
            },
            str(tmp_path),
        )

        assert result["success"] is True
        assert "自动推断" in result["message"]
        schema = _read_schema(tmp_path, "orders")
        col_names = [c["name"] for c in schema["columns"]]
        assert col_names == ["编号", "数量"]
        # 类型推断生效（全数字列 → integer 而非默认 string）
        col_types = {c["name"]: c["type"] for c in schema["columns"]}
        assert col_types["数量"] == "integer"

    def test_fails_with_guidance_when_data_file_missing(self, tmp_path):
        """无 columns + source.path 文件不存在 → 失败，message 携带修正指引（不静默建空壳）。"""
        _make_workspace(tmp_path)  # 只建了 data/orders.csv，引用别的文件
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "ghost",
                    "schemaId": "ghost",
                    "source": {"path": "data/no-such-file.csv"},
                },
            },
            str(tmp_path),
        )

        assert result["success"] is False
        assert "不存在" in result["message"]
        assert "list_data_files" in result["message"]
        # 失败时不留半成品文件
        assert not (tmp_path / "schemas" / "ghost.schema.yaml").exists()

    def test_explicit_columns_not_inferred(self, tmp_path):
        """显式给 columns → 以显式定义为准，不触发推断。"""
        _make_workspace(tmp_path)
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "orders",
                    "schemaId": "orders",
                    "columns": [{"name": "自定义列", "type": "string"}],
                    "source": {"path": "data/orders.csv"},
                },
            },
            str(tmp_path),
        )

        assert result["success"] is True
        assert "自动推断" not in result["message"]
        schema = _read_schema(tmp_path, "orders")
        assert [c["name"] for c in schema["columns"]] == ["自定义列"]

    def test_no_columns_no_source_keeps_empty(self, tmp_path):
        """无 columns 也无 source.path → 维持空壳（手动表场景，不强行推断）。"""
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "manual", "schemaId": "manual"},
            },
            str(tmp_path),
        )

        assert result["success"] is True
        assert _read_schema(tmp_path, "manual")["columns"] == []


class TestUpdateSchemaColumnInference:
    """UPDATE_SCHEMA 的空壳回填"""

    def test_backfills_empty_columns(self, tmp_path):
        """空壳 schema（columns: []）+ source + 不传 columns → 推断回填。"""
        _make_workspace(tmp_path)
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "orders.schema.yaml").write_text(
            "version: 2\nid: orders\nname: orders\ncolumns: []\nsource:\n  path: data/orders.csv\n  type: csv\n",
            encoding="utf-8",
        )

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "orders"},
            },
            str(tmp_path),
        )

        assert result["success"] is True
        schema = _read_schema(tmp_path, "orders")
        assert [c["name"] for c in schema["columns"]] == ["编号", "数量"]

    def test_no_backfill_when_columns_present(self, tmp_path):
        """已有列定义的 schema 不传 columns → 列保持不变（不重复推断）。"""
        _make_workspace(tmp_path)
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "orders.schema.yaml").write_text(
            "version: 2\nid: orders\nname: orders\n"
            "columns:\n  - id: c1\n    name: 已有列\n    type: string\n"
            "source:\n  path: data/orders.csv\n  type: csv\n",
            encoding="utf-8",
        )

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "orders"},
            },
            str(tmp_path),
        )

        assert result["success"] is True
        schema = _read_schema(tmp_path, "orders")
        assert [c["name"] for c in schema["columns"]] == ["已有列"]

    def test_inference_failure_does_not_block_update(self, tmp_path):
        """空壳 + 传入 source 指向不存在文件 → 推断失败但不阻断 UPDATE（source 照常写入）。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "ghost.schema.yaml").write_text(
            "version: 2\nid: ghost\nname: ghost\ncolumns: []\n",
            encoding="utf-8",
        )

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "ghost", "source": {"path": "data/missing.csv"}},
            },
            str(tmp_path),
        )

        # UPDATE 成功（source 已写入），空壳列不因推断失败而报错或误填
        assert result["success"] is True
        schema = _read_schema(tmp_path, "ghost")
        assert schema["source"]["path"] == "data/missing.csv"
        assert schema["columns"] == []
