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
"""@fileoverview 校验错误 constraint_file 回溯测试（P0-3）

覆盖：
- 独立约束文件产生的违规 → constraint_file 为相对 manifest 的约束 YAML 路径
- schema 内嵌约束产生的违规 → constraint_file 为宿主 schema 文件路径
- 格式校验错误（FormatValidation）→ constraint_file 为 null
- 端到端：CLI --format json 输出的 errors[].constraint_file 与上述一致
"""

from __future__ import annotations

import json
from pathlib import Path

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand

# 数据：amount 第 2 行为空（触发独立 NotNull 约束）；order_date 第 3 行非法日期
# （触发格式校验，无约束文件）；qty 第 4 行为空（触发内嵌 NotNull 约束）
_CSV = "id,amount,order_date,qty\n1,10,2026-06-01,1\n2,,2026-06-02,2\n3,30,2026-13-01,3\n4,40,2026-06-04,\n"


def _make_project(tmp_path: Path) -> Path:
    """构造混合项目：1 个独立约束 + 1 个 schema 内嵌约束 + 格式违规数据。"""
    proj = tmp_path / "proj"
    (proj / "schemas").mkdir(parents=True)
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()
    (proj / "data" / "orders.csv").write_text(_CSV, encoding="utf-8")

    # schema：order_date 声明为 date（第 3 行 2026-13-01 将触发格式错误）；
    # 内嵌 NotNull 约束作用于 qty 列
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
  - id: order_date
    name: order_date
    type: date
  - id: qty
    name: qty
    type: integer
constraints:
  - id: qty_required
    type: NotNull
    column: qty
""",
        encoding="utf-8",
    )

    # 独立约束文件：amount 非空
    (proj / "constraints" / "orders_amount_notnull.constraint.yaml").write_text(
        """version: 2
id: orders_amount_notnull
type: NotNull
enabled: true
description: amount 非空
refs:
  table_id: orders
  column_id: amount
params: {}
""",
        encoding="utf-8",
    )

    (proj / "project.precis.yaml").write_text(
        """version: 2
project:
  id: constraint-file-demo
  name: constraint-file-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: orders_amount_notnull
    path: constraints/orders_amount_notnull.constraint.yaml
""",
        encoding="utf-8",
    )
    return proj


def _run_json(manifest: Path, capsys) -> dict:
    """执行 validate --format json 并解析 stdout。"""
    cmd = ValidateCommand()
    cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
    return json.loads(capsys.readouterr().out)


class TestConstraintFileBacktrace:
    """错误条目回溯到来源约束文件"""

    def test_standalone_constraint_error_has_file(self, tmp_path, capsys):
        """独立约束文件违规 → constraint_file 为约束 YAML 相对路径。"""
        payload = _run_json(_make_project(tmp_path) / "project.precis.yaml", capsys)
        amount_errors = [e for e in payload["errors"] if e["column"] == "amount"]
        assert len(amount_errors) == 1
        assert amount_errors[0]["constraint_file"] == "constraints/orders_amount_notnull.constraint.yaml"

    def test_embedded_constraint_error_has_schema_file(self, tmp_path, capsys):
        """schema 内嵌约束违规 → constraint_file 为宿主 schema 文件路径。"""
        payload = _run_json(_make_project(tmp_path) / "project.precis.yaml", capsys)
        # 内嵌约束 ID 形如 "{schema_id}_{item_id}"，qty 列空值触发内嵌 NotNull
        qty_errors = [e for e in payload["errors"] if e["column"] == "qty"]
        assert len(qty_errors) == 1
        assert qty_errors[0]["constraint_file"] == "schemas/orders.schema.yaml"

    def test_format_validation_error_has_null_file(self, tmp_path, capsys):
        """格式校验错误无约束来源 → constraint_file 为 null。"""
        payload = _run_json(_make_project(tmp_path) / "project.precis.yaml", capsys)
        format_errors = [e for e in payload["errors"] if e["constraint_type"] == "FormatValidation"]
        assert len(format_errors) == 1
        assert format_errors[0]["constraint_file"] is None
        assert format_errors[0]["column"] == "order_date"

    def test_constraint_source_files_map_built(self, tmp_path):
        """load_project 构建 constraint_source_files：独立与内嵌约束各有映射。"""
        from app.shared.core.project.loader import load_project

        proj = _make_project(tmp_path)
        loaded = load_project(str(proj / "project.precis.yaml"))

        source_map = loaded.constraint_source_files or {}
        assert source_map["orders_amount_notnull"] == "constraints/orders_amount_notnull.constraint.yaml"
        assert source_map["orders_qty_required"] == "schemas/orders.schema.yaml"
