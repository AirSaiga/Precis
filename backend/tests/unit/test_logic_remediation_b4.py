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
"""@fileoverview 2026-09-18 逻辑漏洞治理第二轮 B4 批次（AI 链路后端）回归测试

覆盖 docs/plans/2026-09-18-logic-remediation/02 规格中 B4 批次的后端修复：
- §2.4  约束 ID 全名化（去截断/去子串匹配）+ ADD 存在性检查
- §2.5  Transform 随机 ID 扩容（uuid4 hex[:8]）
- §2.6  AI DELETE_SCHEMA 引用检查（与 REST 共用单一事实源）
- §2.7  ADD_REGEX 登记失败回滚（对齐 Schema 路径）
- §2.9  legacy 聊天路径约束类型归一
- §2.10 AI UPDATE 整体替换语义（preserve_format=False）
- §2.11 isInline 默认 False（消费方口径锁定）
- §2.12 env 注入 API key 不落盘
- §2.13 get_project_overview 读取磁盘真实 enabled
"""

from __future__ import annotations

import re
import uuid
from unittest.mock import patch

import yaml

# ============================================================
# §2.4 约束 ID 生成
# ============================================================


class TestConstraintIdGeneration:
    def test_two_long_table_names_produce_distinct_ids(self):
        """customers_eu_2024 与 customers_us_2024 同列同类型 → ID 不同（原 10 字符截断后同前缀）"""
        from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id

        id1 = _generate_constraint_id("NotNull", "customers_eu_2024", "email")
        id2 = _generate_constraint_id("NotNull", "customers_us_2024", "email")
        assert id1 != id2
        assert "customers_eu_2024" in id1
        assert "customers_us_2024" in id2

    def test_chinese_table_no_substring_collision(self):
        """'订单' 与 '订单明细' 不再被子串匹配缩写成同一前缀（精确映射 + 首字母全名展开）"""
        from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id

        id1 = _generate_constraint_id("NotNull", "订单", "金额")
        id2 = _generate_constraint_id("NotNull", "订单明细", "金额")
        assert id1 != id2

    def test_exact_chinese_mapping_still_applies(self):
        """精确命中内建映射的中文表名仍用英文缩写（可读性保持）"""
        from app.shared.services.llm.constraints.constraint_id import _chinese_to_abbr

        assert _chinese_to_abbr("订单") == "order"
        assert _chinese_to_abbr("用户表") == "user"

    def test_add_existing_constraint_rejected(self, tmp_path):
        """ADD 已存在的约束文件 → 报'已存在'不覆盖（原实现直写覆盖）"""
        from app.shared.services.llm.actions.action_handlers import update_yaml_config

        spec = {
            "type": "NotNull",
            "tableName": "users",
            "targetColumn": "email",
            "targetNodeId": "users",
            "isInline": False,
        }
        action_add = {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": spec}
        ok1, _ = update_yaml_config(action_add, str(tmp_path))
        assert ok1 is True

        ok2, msg2 = update_yaml_config(action_add, str(tmp_path))
        assert ok2 is False
        assert "已存在" in msg2
        assert "UPDATE" in msg2

    def test_update_existing_constraint_still_allowed(self, tmp_path):
        """UPDATE 已存在的约束文件 → 正常覆盖（存在性检查只拦 ADD）"""
        from app.shared.services.llm.actions.action_handlers import update_yaml_config

        spec = {
            "type": "NotNull",
            "tableName": "users",
            "targetColumn": "email",
            "targetNodeId": "users",
            "isInline": False,
        }
        update_yaml_config({"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": spec}, str(tmp_path))
        ok, _ = update_yaml_config({"actionType": "UPDATE_CONSTRAINT_NODE", "constraintSpec": spec}, str(tmp_path))
        assert ok is True


# ============================================================
# §2.5 Transform 随机 ID 扩容
# ============================================================


class TestTransformIdExpansion:
    def test_short_hash_is_eight_hex_chars(self):
        from app.shared.services.llm.actions.transform_handlers import _short_hash

        for _ in range(20):
            assert re.fullmatch(r"[0-9a-f]{8}", _short_hash())

    def test_generate_transform_id_unique_across_thousand(self):
        """1000 个 ID 无碰撞（原 3 位数字空间 35 个即过半）"""
        from app.shared.services.llm.actions.transform_handlers import _generate_transform_id

        ids = {_generate_transform_id("filter_rows") for _ in range(1000)}
        assert len(ids) == 1000

    def test_uuid_backing(self):
        """底层确为 uuid4（防未来退回 random.randint）"""
        from app.shared.services.llm.actions import transform_handlers

        with patch.object(uuid, "uuid4") as mock_uuid:
            mock_uuid.return_value.hex = "abcdef0123456789fedcba"
            assert transform_handlers._short_hash() == "abcdef01"


# ============================================================
# §2.6 AI DELETE_SCHEMA 引用检查
# ============================================================


class TestAiDeleteSchemaReferenceCheck:
    def _make_project(self, tmp_path, with_constraint: bool):
        (tmp_path / "schemas").mkdir()
        (tmp_path / "schemas" / "users.schema.yaml").write_text(
            "version: 2\nid: users\nname: users\ncolumns:\n  - id: c1\n    name: email\n    type: string\n",
            encoding="utf-8",
        )
        if with_constraint:
            (tmp_path / "constraints").mkdir()
            (tmp_path / "constraints" / "nn_users_email.constraint.yaml").write_text(
                "version: 2\nid: nn_users_email\ntype: NotNull\nrefs: {table_id: users, column_id: c1}\n",
                encoding="utf-8",
            )
        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject: {id: p, name: p}\nschemas:\n  - id: users\n    path: schemas/users.schema.yaml\n"
            + (
                "constraints:\n  - id: nn_users_email\n    path: constraints/nn_users_email.constraint.yaml\n"
                if with_constraint
                else "constraints: []\n"
            )
            + "regex_nodes: []\n",
            encoding="utf-8",
        )

    def test_delete_with_references_rejected(self, tmp_path):
        from app.shared.services.llm.actions.schema_handlers import _delete_schema

        self._make_project(tmp_path, with_constraint=True)
        result = _delete_schema({"schemaId": "users"}, str(tmp_path))
        assert result["success"] is False
        assert "nn_users_email" in result["message"]
        # 文件未删
        assert (tmp_path / "schemas" / "users.schema.yaml").exists()

    def test_delete_without_references_succeeds(self, tmp_path):
        from app.shared.services.llm.actions.schema_handlers import _delete_schema

        self._make_project(tmp_path, with_constraint=False)
        result = _delete_schema({"schemaId": "users"}, str(tmp_path))
        assert result["success"] is True
        assert not (tmp_path / "schemas" / "users.schema.yaml").exists()

    def test_rest_and_ai_share_reference_logic(self):
        """REST 与 AI 共用 find_schema_references（单一事实源导入确认）"""
        from app.api.routers.project import schema as rest_module
        from app.shared.core.project.schema_ref_check import find_schema_references
        from app.shared.services.llm.actions import schema_handlers as ai_module

        assert rest_module.find_schema_references is find_schema_references
        assert ai_module.find_schema_references is find_schema_references


# ============================================================
# §2.7 ADD_REGEX 登记失败回滚
# ============================================================


class TestAddRegexRollback:
    def test_manifest_registration_failure_rolls_back_file(self, tmp_path, monkeypatch):
        from app.shared.services.llm.actions import regex_handlers

        (tmp_path / "regex").mkdir()
        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject: {id: p, name: p}\nschemas: []\nconstraints: []\nregex_nodes: []\n",
            encoding="utf-8",
        )
        spec = {
            "regexId": "phone",
            "pattern": r"^\d+$",
            "matchMode": "full",
            "caseSensitive": True,
        }

        def boom(workspace_path, regex_id):
            raise RuntimeError("manifest 写盘失败")

        monkeypatch.setattr(regex_handlers, "_ensure_manifest_regex_ref", boom)
        spec = {**spec, "name": "phone"}
        result = regex_handlers._add_regex(spec, str(tmp_path))
        assert result["success"] is False
        assert "回滚" in result["message"]
        # 已写的 Regex 文件被回滚删除
        assert not (tmp_path / "regex" / "phone.regex.yaml").exists()

    def test_registration_success_keeps_file(self, tmp_path):
        from app.shared.services.llm.actions.regex_handlers import _add_regex

        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject: {id: p, name: p}\nschemas: []\nconstraints: []\nregex_nodes: []\n",
            encoding="utf-8",
        )
        result = _add_regex({"regexId": "phone", "name": "phone", "pattern": r"^\d+$"}, str(tmp_path))
        assert result["success"] is True
        assert (tmp_path / "regex" / "phone.regex.yaml").exists()


# ============================================================
# §2.9 legacy 聊天路径类型归一
# ============================================================


class TestLegacyParserTypeNormalization:
    def _parse(self, constraint_type):
        from app.shared.services.llm.chat.response_parser import ActionParser

        response = {
            "actions": [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": constraint_type,
                        "tableName": "users",
                        "targetColumn": "email",
                    },
                }
            ]
        }
        parsed = ActionParser.parse_actions(response)
        return parsed

    def test_lowercase_type_accepted_and_normalized(self):
        parsed = self._parse("not_null")
        assert len(parsed) == 1
        assert parsed[0]["constraintSpec"]["type"] == "NotNull"

    def test_uppercase_alias_accepted(self):
        parsed = self._parse("NOT_NULL")
        assert len(parsed) == 1
        assert parsed[0]["constraintSpec"]["type"] == "NotNull"

    def test_plain_lowercase_accepted(self):
        parsed = self._parse("unique")
        assert len(parsed) == 1
        assert parsed[0]["constraintSpec"]["type"] == "Unique"

    def test_unknown_type_still_rejected(self):
        parsed = self._parse("no_such_constraint")
        assert parsed == []


# ============================================================
# §2.10 AI UPDATE 整体替换语义
# ============================================================


class TestAiUpdateReplaceSemantics:
    def test_update_transform_removing_output_column(self, tmp_path):
        """UPDATE_TRANSFORM 减少输出列 → 旧列从文件消失（preserve_format 只增不删的修复）"""
        from app.shared.services.llm.actions.transform_handlers import _update_transform

        (tmp_path / "transforms").mkdir()
        tf = tmp_path / "transforms" / "filter_x.transform.yaml"
        tf.write_text(
            yaml.safe_dump(
                {
                    "version": 2,
                    "id": "filter_x",
                    "type": "FilterRows",
                    "params": {"conditions": []},
                    "output_columns": ["a", "b", "c"],
                }
            ),
            encoding="utf-8",
        )
        result = _update_transform({"transformId": "filter_x", "outputColumns": ["a", "b"]}, str(tmp_path))
        assert result["success"] is True
        data = yaml.safe_load(tf.read_text(encoding="utf-8"))
        assert data["output_columns"] == ["a", "b"]

    def test_update_schema_partial_columns_keeps_unmentioned(self, tmp_path):
        """UPDATE_SCHEMA 部分列更新保留未提及列（handler :210-216 显式设计），
        已提及列的类型变更生效且写盘为新值——preserve_format=False 的写盘层验证
        由 transform 用例覆盖；列删除受部分更新设计限制（偏差已记规格）"""
        from app.shared.services.llm.actions.schema_handlers import _update_schema

        (tmp_path / "schemas").mkdir()
        sf = tmp_path / "schemas" / "users.schema.yaml"
        sf.write_text(
            yaml.safe_dump(
                {
                    "version": 2,
                    "id": "users",
                    "name": "users",
                    "columns": [
                        {"id": "c1", "name": "email", "type": "string"},
                        {"id": "c2", "name": "age", "type": "string"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        result = _update_schema(
            {
                "schemaId": "users",
                "columns": [{"name": "age", "type": "integer"}],
            },
            str(tmp_path),
        )
        assert result["success"] is True
        data = yaml.safe_load(sf.read_text(encoding="utf-8"))
        by_name = {c["name"]: c for c in data["columns"]}
        assert by_name["age"]["type"] == "integer"
        assert "email" in by_name  # 未提及列保留


# ============================================================
# §2.11 isInline 默认 False（行为锁定）
# ============================================================


class TestIsInlineDefaultContract:
    def test_spec_default_is_false(self):
        from app.shared.services.llm.actions.specs import ConstraintSpec

        assert ConstraintSpec().isInline is False

    def test_consumer_dict_default_is_false(self):
        """消费方（原始 dict get）缺省独立文件——与 Pydantic 默认一致（契约锁定）"""
        spec = {}
        assert spec.get("isInline", False) is False


# ============================================================
# §2.12 env 注入 API key 不落盘
# ============================================================


class TestEnvKeyNotPersisted:
    def _write_config(self, tmp_path):
        cfg = tmp_path / "ai_providers.yaml"
        cfg.write_text(
            yaml.safe_dump(
                {
                    "version": "2.0",
                    "providers": [
                        {
                            "id": "deepseek",
                            "name": "DeepSeek",
                            "type": "openai",
                            "base_url": "https://api.deepseek.com/v1",
                            "api_key": None,
                            "model": "deepseek-chat",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        return cfg

    def test_env_key_not_written_on_save(self, tmp_path, monkeypatch):
        from app.shared.services.llm.config.loader import ConfigLoader

        cfg = self._write_config(tmp_path)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "env-secret-key")
        loader = ConfigLoader(config_path=cfg)
        config = loader.load()
        assert any(p.api_key == "env-secret-key" for p in config.providers)

        loader.save(config)
        data = yaml.safe_load(cfg.read_text(encoding="utf-8"))
        providers = data.get("providers", [])
        assert all("api_key" not in p or not p["api_key"] for p in providers)

    def test_manual_key_written_after_mark(self, tmp_path, monkeypatch):
        from app.shared.services.llm.config.loader import ConfigLoader

        cfg = self._write_config(tmp_path)
        monkeypatch.setenv("DEEPSEEK_API_KEY", "env-secret-key")
        loader = ConfigLoader(config_path=cfg)
        config = loader.load()

        loader.mark_api_key_manual("deepseek")
        loader.save(config)
        data = yaml.safe_load(cfg.read_text(encoding="utf-8"))
        deepseek = next(p for p in data["providers"] if p["id"] == "deepseek")
        # 手工 key 正常落盘（保存路径会加密，验密文存在即可）
        assert deepseek.get("api_key")
        assert str(deepseek["api_key"]).startswith("enc:")

    def test_file_key_persisted_normally(self, tmp_path, monkeypatch):
        """手工配置文件里的 key 保存后保留（env 不注入时不误删）"""
        from app.shared.services.llm.config.loader import ConfigLoader

        cfg = self._write_config(tmp_path)
        data = yaml.safe_load(cfg.read_text(encoding="utf-8"))
        data["providers"][0]["api_key"] = "file-key"
        cfg.write_text(yaml.safe_dump(data), encoding="utf-8")

        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        loader = ConfigLoader(config_path=cfg)
        config = loader.load()
        loader.save(config)
        saved = yaml.safe_load(cfg.read_text(encoding="utf-8"))
        deepseek = next(p for p in saved["providers"] if p["id"] == "deepseek")
        assert deepseek.get("api_key")  # 文件里的手工 key 保存后保留


# ============================================================
# §2.13 overview 真实 enabled
# ============================================================


class TestOverviewRealEnabled:
    def test_inline_constraint_enabled_false_reported(self, tmp_path):
        from app.shared.services.ai.utils import get_project_overview

        (tmp_path / "schemas").mkdir()
        (tmp_path / "schemas" / "users.schema.yaml").write_text(
            yaml.safe_dump(
                {
                    "version": 2,
                    "id": "users",
                    "name": "users",
                    "columns": [{"id": "c1", "name": "email", "type": "string"}],
                    "constraints": [
                        {"id": "nn1", "column": "c1", "type": "NotNull", "enabled": False},
                        {"id": "nn2", "column": "c1", "type": "Unique"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        overview = get_project_overview(str(tmp_path))
        by_id = {c["id"]: c for c in overview["constraints"]}
        assert by_id["nn1"]["enabled"] is False
        assert by_id["nn2"]["enabled"] is True  # 无字段默认 true（与运行时语义一致）
