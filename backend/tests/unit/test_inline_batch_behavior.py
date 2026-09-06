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
@fileoverview 内联约束批量处理行为测试

覆盖 process_inline_batch 将约束写入 schema 文件。
"""

from __future__ import annotations

import yaml

from app.shared.services.llm.constraints.inline_batch import process_inline_batch


class TestProcessInlineBatch:
    """process_inline_batch 行为"""

    def test_adds_inline_constraint_to_schema(self, tmp_path):
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        schema_file = schemas_dir / "users.schema.yaml"
        schema_file.write_text(
            """version: 2
id: users
name: users
columns:
  - id: email
    name: email
    type: string
""",
            encoding="utf-8",
        )

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "isInline": True,
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                },
            }
        ]

        results = process_inline_batch(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True
        assert "notnull" in results[0]["message"]

        with open(schema_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert len(data["constraints"]) == 1
        assert data["constraints"][0]["type"] == "NotNull"
        assert data["constraints"][0]["column"] == "email"

    def test_returns_failure_when_schema_not_found(self, tmp_path):
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "isInline": True,
                    "type": "NotNull",
                    "tableName": "missing",
                    "targetColumn": "email",
                },
            }
        ]

        results = process_inline_batch(actions, str(tmp_path))
        assert results[0]["success"] is False
        assert "未找到 schema" in results[0]["message"]
