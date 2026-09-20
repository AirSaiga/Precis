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
"""@fileoverview validate --format json 输出契约 v1 快照测试（P0-2 契约冻结）

契约文档：docs/contracts/validate-json-v1.md
以固定违规项目断言字段集合、字段类型与 null 语义——精确断言，禁止 snapshot。
后端输出契约发生破坏性变更（减字段/改类型）时本文件必须变红。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand

# 固定测试数据：3 行，第 2 行 amount 空（NotNull 违规），第 3 行超区间（Range 违规）
_CSV = "id,amount\n1,10\n2,\n3,999999\n"

_TOP_FIELDS = {
    "schema_version",
    "is_valid",
    "interrupted",
    "duration_ms",
    "tables",
    "summary",
    "errors",
    "loading_warnings",
}
_ERROR_FIELDS = {
    "table",
    "column",
    "constraint_type",
    "constraint_file",
    "row_index",
    "cell_value",
    "error_message",
    "suggestion",
}
_TABLE_FIELDS = {"name", "rows"}
_SUMMARY_FIELDS = {"constraints_total", "constraints_passed", "constraints_failed"}


@pytest.fixture(scope="module")
def contract_project(tmp_path_factory) -> Path:
    """构造契约测试固定项目（module 级共享，避免重复建项目）。"""
    tmp_path = tmp_path_factory.mktemp("contract")
    proj = tmp_path / "proj"
    (proj / "schemas").mkdir(parents=True)
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()
    (proj / "data" / "orders.csv").write_text(_CSV, encoding="utf-8")
    (proj / "schemas" / "orders.schema.yaml").write_text(
        """version: 2
id: orders
name: orders
source:
  mode: relative_file
  path: data/orders.csv
columns:
  - id: id
    name: id
    type: integer
  - id: amount
    name: amount
    type: integer
""",
        encoding="utf-8",
    )
    (proj / "constraints" / "c1.constraint.yaml").write_text(
        """version: 2
id: c1a2b3c4-0000-4000-8000-000000000001
type: NotNull
enabled: true
refs:
  table_id: orders
  column_id: amount
params: {}
""",
        encoding="utf-8",
    )
    (proj / "constraints" / "c2.constraint.yaml").write_text(
        """version: 2
id: c1a2b3c4-0000-4000-8000-000000000002
type: Range
enabled: true
refs:
  table_id: orders
  column_id: amount
params:
  min: 0
  max: 100000
  boundary_mode: inclusive
""",
        encoding="utf-8",
    )
    (proj / "project.precis.yaml").write_text(
        """version: 2
project:
  id: contract-freeze-demo
  name: contract-freeze-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: c1a2b3c4-0000-4000-8000-000000000001
    path: constraints/c1.constraint.yaml
  - id: c1a2b3c4-0000-4000-8000-000000000002
    path: constraints/c2.constraint.yaml
""",
        encoding="utf-8",
    )
    return proj


def _load_payload(project_dir: Path, capsys) -> dict:
    """每次调用重新执行 validate 并解析 stdout（capsys 需逐测试清空，故不用 module fixture）。"""
    cmd = ValidateCommand()
    manifest = project_dir / "project.precis.yaml"
    cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
    return json.loads(capsys.readouterr().out)


class TestContractFieldSets:
    """字段集合精确冻结：v1 只增不减，减字段在此变红"""

    def test_top_level_field_set_frozen(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert set(payload.keys()) == _TOP_FIELDS

    def test_error_entry_field_set_frozen(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert len(payload["errors"]) >= 1
        for entry in payload["errors"]:
            assert set(entry.keys()) == _ERROR_FIELDS

    def test_table_entry_field_set_frozen(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert payload["tables"], "契约项目应加载出至少一张表"
        for table in payload["tables"]:
            assert set(table.keys()) == _TABLE_FIELDS

    def test_summary_field_set_frozen(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert set(payload["summary"].keys()) == _SUMMARY_FIELDS


class TestContractFieldTypes:
    """字段类型冻结：改类型属破坏性变更，须升 schema_version"""

    def test_scalar_field_types(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert type(payload["schema_version"]) is int
        assert payload["schema_version"] == 1
        assert type(payload["is_valid"]) is bool
        assert type(payload["interrupted"]) is bool
        assert type(payload["duration_ms"]) is int

    def test_collection_field_types(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert type(payload["tables"]) is list
        assert type(payload["errors"]) is list
        assert type(payload["loading_warnings"]) is list
        assert type(payload["summary"]) is dict
        for key in ("constraints_total", "constraints_passed", "constraints_failed"):
            assert type(payload["summary"][key]) is int

    def test_error_entry_type_semantics(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        for entry in payload["errors"]:
            # 可空字符串字段：str 或 None
            for key in ("table", "column", "constraint_type", "constraint_file", "error_message"):
                assert entry[key] is None or isinstance(entry[key], str)
            # row_index：int 或 None（不允许 str）
            assert entry["row_index"] is None or type(entry["row_index"]) is int
            # cell_value：任意 JSON 值（含 null）
            json.dumps(entry["cell_value"])


class TestContractNullSemantics:
    """null 语义：缺值字段必须以 null 呈现（键存在），不得静默缺键"""

    def test_constraint_file_null_for_non_constraint_error(self, contract_project, capsys):
        """格式校验类错误的 constraint_file 必须是 null 而非缺键（键集合已在上方冻结）。"""
        payload = _load_payload(contract_project, capsys)
        non_constraint = [e for e in payload["errors"] if e["constraint_type"] != "NotNullConstraint"]
        # 本项目仅约束错误；契约语义：非约束错误的 constraint_file 为 null
        for entry in non_constraint:
            assert "constraint_file" in entry
            if entry["constraint_type"] == "FormatValidation":
                assert entry["constraint_file"] is None

    def test_loading_warnings_present_even_when_empty(self, contract_project, capsys):
        """无加载问题时 loading_warnings 必须是空数组而非缺键。"""
        payload = _load_payload(contract_project, capsys)
        assert payload["loading_warnings"] == []


class TestContractValues:
    """契约值语义抽查（与文档描述一致）"""

    def test_is_valid_equals_empty_errors(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        assert payload["is_valid"] == (len(payload["errors"]) == 0)

    def test_summary_counts_consistent(self, contract_project, capsys):
        payload = _load_payload(contract_project, capsys)
        s = payload["summary"]
        assert s["constraints_total"] == s["constraints_passed"] + s["constraints_failed"]
        # 固定项目：2 项约束检查，NotNull 与 Range 各失败一次
        assert s["constraints_total"] == 2
        assert s["constraints_failed"] == 2
