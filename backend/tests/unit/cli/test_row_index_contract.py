# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview row_index 双基准契约守卫

契约（docs/contracts/validate-json-v1.md errors[].row_index）：
- 格式校验错误（FormatValidation）恒为原文件行位（0 起数据行）
- 约束错误为约束求值时行位；无行变换时与原文件行位一致（共享基准）
- 行数改变类转换（FilterRows 等）会重排约束侧行位（与原文件行位不对应）

本文件把这三条语义钉死：同一物理行的两类错误必须报同一行号（无变换时）；
有 FilterRows 时锁定"约束侧=变换后行位"的现状，使未来引入 index lineage
映射时的行为变更必须显式改契约与测试。
"""

from __future__ import annotations

import json
from pathlib import Path

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand

# 行 1（0 起）同时有 amount 空值（约束违规）与非法日期（格式错误）——
# 同一物理行的两类错误用于验证共享基准
_CSV = "id,amount,order_date,qty\n1,10,2026-06-01,1\n2,,2026-13-01,2\n3,30,2026-06-03,3\n"

_SCHEMA = """version: 2
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
"""

_NOTNULL = """version: 2
id: amount-notnull
type: NotNull
enabled: true
refs:
  table_id: orders
  column_id: amount
params: {}
"""


def _write_base(proj: Path) -> None:
    (proj / "schemas").mkdir(parents=True)
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()
    (proj / "data" / "orders.csv").write_text(_CSV, encoding="utf-8")
    (proj / "schemas" / "orders.schema.yaml").write_text(_SCHEMA, encoding="utf-8")
    (proj / "constraints" / "amount_notnull.constraint.yaml").write_text(_NOTNULL, encoding="utf-8")


def _run_json(manifest: Path, capsys) -> dict:
    cmd = ValidateCommand()
    cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
    return json.loads(capsys.readouterr().out)


class TestRowIndexSharedBaseline:
    """无行变换时两类错误共享 0 起数据行基准"""

    def test_same_physical_row_same_index(self, tmp_path, capsys):
        """同一物理行（第 2 数据行）的格式错误与约束违规报同一 row_index。"""
        proj = tmp_path / "proj"
        _write_base(proj)
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: ri-demo
  name: ri-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: amount-notnull
    path: constraints/amount_notnull.constraint.yaml
""",
            encoding="utf-8",
        )
        payload = _run_json(proj / "project.precis.yaml", capsys)

        fmt = [e for e in payload["errors"] if e["constraint_type"] == "FormatValidation"]
        con = [e for e in payload["errors"] if e["constraint_type"] != "FormatValidation"]
        assert len(fmt) == 1 and fmt[0]["column"] == "order_date"
        assert len(con) == 1 and con[0]["column"] == "amount"
        # 同一物理行（0 起第 1 行）→ 两类错误行号一致
        assert fmt[0]["row_index"] == 1
        assert con[0]["row_index"] == 1


class TestRowIndexTransformSemantics:
    """FilterRows 行变换后约束侧行位=变换后行位（现状锁定）"""

    def test_filter_rows_shifts_constraint_row_index(self, tmp_path, capsys):
        """行 0 被 FilterRows 删除后，原行 1 的约束违规报变换后行位 0。

        数据布局（flag=keep 的行保留）：
          行 0: flag=drop   ← 被过滤删除（amount 有值，无违规）
          行 1: flag=keep, amount 空 ← 约束违规；变换后位于行位 0
          行 2: flag=keep, order_date 非法 ← 格式错误仍按原文件行位 2 报
        """
        proj = tmp_path / "proj"
        (proj / "schemas").mkdir(parents=True)
        (proj / "constraints").mkdir()
        (proj / "transforms").mkdir()
        (proj / "data").mkdir()
        (proj / "data" / "orders.csv").write_text(
            "id,amount,flag,order_date\n0,10,drop,2026-06-01\n1,,keep,2026-06-02\n2,30,keep,2026-13-01\n",
            encoding="utf-8",
        )
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
  - id: flag
    name: flag
    type: string
  - id: order_date
    name: order_date
    type: date
""",
            encoding="utf-8",
        )
        (proj / "constraints" / "amount_notnull.constraint.yaml").write_text(_NOTNULL, encoding="utf-8")
        (proj / "transforms" / "filter.constraint.yaml").write_text(
            """version: 2
id: tf-keep-only
type: FilterRows
enabled: true
description: 只保留 flag=keep 的行
input_from_node: orders
input_column: flag
params:
  conditions:
    - column: flag
      op: eq
      value: keep
output_columns: []
""",
            encoding="utf-8",
        )
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: ri-tf-demo
  name: ri-tf-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: amount-notnull
    path: constraints/amount_notnull.constraint.yaml
transforms:
  - id: tf-keep-only
    path: transforms/filter.constraint.yaml
""",
            encoding="utf-8",
        )
        payload = _run_json(proj / "project.precis.yaml", capsys)

        con = [e for e in payload["errors"] if e["column"] == "amount"]
        fmt = [e for e in payload["errors"] if e["constraint_type"] == "FormatValidation"]
        assert len(con) == 1, f"约束违规应存在: {payload['errors']}"
        # 变换后行位：原行 1 在过滤后位于行位 0
        assert con[0]["row_index"] == 0, "约束错误应报变换后行位（契约现状）"
        # 格式错误恒为原文件行位（格式校验先于 Transform DAG 执行）
        if fmt:
            assert fmt[0]["row_index"] == 2
