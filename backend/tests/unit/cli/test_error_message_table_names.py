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
"""@fileoverview 错误消息表名可读性（UUID→显示名）端到端守卫

约束构造时注入的 from_table/to_table 是数据集查表键（表 ID，UUID 形态），
错误消息直接插值导致用户看到 UUID。postprocess 的文本重写
（rewrite_id_tokens）与 loader/builder 生成点改用显示名后，本文件守卫：
- FK 违规消息里出现的是表显示名而非 UUID
- 悬空引用（表已不存在，无名称可映射）保留 UUID——定位配置的唯一线索
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand

# 两个表 ID 为真实 UUID 形态、显示名刻意与 ID 无关，证明消息取的是 name
_ORDERS_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
_CUSTOMERS_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
_ORDERS_NAME = "订单表"
_CUSTOMERS_NAME = "客户表"

# 订单表 customer_id 含一个不在客户表的值（C-999）触发 FK 违规
_ORDERS_CSV = "order_id,customer_id,amount\nO-001,C-001,10\nO-002,C-999,20\nO-003,C-002,30\n"
_CUSTOMERS_CSV = "customer_id,name\nC-001,甲\nC-002,乙\n"


def _make_fk_project(tmp_path: Path) -> Path:
    """构造 UUID ID + 中文显示名的双表 FK 项目，含一条 FK 违规。"""
    proj = tmp_path / "proj"
    (proj / "schemas").mkdir(parents=True)
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()
    (proj / "data" / "orders.csv").write_text(_ORDERS_CSV, encoding="utf-8")
    (proj / "data" / "customers.csv").write_text(_CUSTOMERS_CSV, encoding="utf-8")

    (proj / "schemas" / "orders.schema.yaml").write_text(
        f"""version: 2
id: {_ORDERS_ID}
name: {_ORDERS_NAME}
source:
  mode: relative_file
  path: data/orders.csv
columns:
  - id: order_id
    name: order_id
    type: string
  - id: customer_id
    name: customer_id
    type: string
""",
        encoding="utf-8",
    )
    (proj / "schemas" / "customers.schema.yaml").write_text(
        f"""version: 2
id: {_CUSTOMERS_ID}
name: {_CUSTOMERS_NAME}
source:
  mode: relative_file
  path: data/customers.csv
columns:
  - id: customer_id
    name: customer_id
    type: string
""",
        encoding="utf-8",
    )
    (proj / "constraints" / "fk.constraint.yaml").write_text(
        f"""version: 2
id: 9c0d1e2f-3a4b-4c5d-8e6f-8a9b0c1d2e3f
type: ForeignKey
enabled: true
description: 订单客户必须存在
refs:
  from_table_id: {_ORDERS_ID}
  from_column_id: customer_id
  to_table_id: {_CUSTOMERS_ID}
  to_column_id: customer_id
params: {{}}
""",
        encoding="utf-8",
    )
    (proj / "project.precis.yaml").write_text(
        f"""version: 2
project:
  id: fk-demo
  name: fk-demo
schemas:
  - id: {_ORDERS_ID}
    path: schemas/orders.schema.yaml
  - id: {_CUSTOMERS_ID}
    path: schemas/customers.schema.yaml
constraints:
  - id: 9c0d1e2f-3a4b-4c5d-8e6f-8a9b0c1d2e3f
    path: constraints/fk.constraint.yaml
""",
        encoding="utf-8",
    )
    return proj


def _run_json(manifest: Path, capsys) -> dict:
    """执行 validate --format json 并解析 stdout。"""
    cmd = ValidateCommand()
    cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
    return json.loads(capsys.readouterr().out)


class TestErrorMessageTableNames:
    """错误消息中的表标识必须是显示名（UUID 形态表 ID 不外泄）"""

    def test_fk_violation_message_uses_display_names(self, tmp_path, capsys):
        """FK 违规消息：目标表显示名出现、UUID 不出现。"""
        payload = _run_json(_make_fk_project(tmp_path) / "project.precis.yaml", capsys)
        # check_type 为注册的检查组名（ForeignKeyConstraints），非约束类型名
        fk_errors = [e for e in payload["errors"] if "ForeignKey" in (e["constraint_type"] or "")]
        assert len(fk_errors) == 1
        message = fk_errors[0]["error_message"]
        assert _CUSTOMERS_NAME in message, f"消息应含目标表显示名: {message}"
        assert _CUSTOMERS_ID not in message, f"消息不应含目标表 UUID: {message}"

    def test_tables_list_uses_display_names(self, tmp_path, capsys):
        """tables 列表为显示名而非 UUID，且 rows 按 table_id 保底查到真实行数。"""
        payload = _run_json(_make_fk_project(tmp_path) / "project.precis.yaml", capsys)
        table_names = {t["name"] for t in payload["tables"]}
        assert _ORDERS_NAME in table_names
        assert _CUSTOMERS_NAME in table_names
        assert _ORDERS_ID not in table_names
        # rows 回归：postprocess 显示名化后 json_payload 须按保留的 table_id
        # 查 raw_datasets（曾恒 null），这里两表各有 3/2 行数据
        rows_by_name = {t["name"]: t["rows"] for t in payload["tables"]}
        assert rows_by_name[_ORDERS_NAME] == 3
        assert rows_by_name[_CUSTOMERS_NAME] == 2

    def test_top_level_table_field_is_display_name(self, tmp_path, capsys):
        """错误条目顶层 table 字段为显示名（map_table_id 既有行为回归守卫）。"""
        payload = _run_json(_make_fk_project(tmp_path) / "project.precis.yaml", capsys)
        fk_errors = [e for e in payload["errors"] if "ForeignKey" in (e["constraint_type"] or "")]
        assert fk_errors[0]["table"] == _ORDERS_NAME

    def test_dangling_table_reference_keeps_uuid(self, tmp_path, capsys):
        """悬空引用（表不存在，无名称可映射）在 loading_warnings 保留 UUID。

        保留是设计行为：用户需要拿 ID 回配置文件定位悬空引用。
        """
        proj = _make_fk_project(tmp_path)
        # 把 customers 从 manifest 摘除，使 FK 的 to_table 悬空
        manifest = proj / "project.precis.yaml"
        text = manifest.read_text(encoding="utf-8")
        text = text.replace(f"  - id: {_CUSTOMERS_ID}\n    path: schemas/customers.schema.yaml\n", "")
        manifest.write_text(text, encoding="utf-8")

        payload = _run_json(manifest, capsys)
        warnings_text = json.dumps(payload["loading_warnings"], ensure_ascii=False)
        assert _CUSTOMERS_ID in warnings_text, "悬空引用应保留 UUID 供定位"


class TestRewriteIdTokensUnit:
    """postprocess.rewrite_id_tokens 纯函数行为"""

    def test_known_uuid_replaced(self):
        from app.shared.services.validation.postprocess import rewrite_id_tokens

        mapping = {_CUSTOMERS_ID: _CUSTOMERS_NAME}
        out = rewrite_id_tokens(f"值 'X' 在目标表 '{_CUSTOMERS_ID}' 中不存在", mapping)
        assert out == f"值 'X' 在目标表 '{_CUSTOMERS_NAME}' 中不存在"

    def test_unknown_uuid_kept(self):
        from app.shared.services.validation.postprocess import rewrite_id_tokens

        unknown = str(uuid.uuid4())
        out = rewrite_id_tokens(f"表 '{unknown}' 不存在", {_CUSTOMERS_ID: _CUSTOMERS_NAME})
        assert unknown in out

    def test_non_uuid_text_untouched(self):
        from app.shared.services.validation.postprocess import rewrite_id_tokens

        text = "列 'amount' 的值必须是整数；表名 orders-2024 不是 UUID"
        assert rewrite_id_tokens(text, {_CUSTOMERS_ID: _CUSTOMERS_NAME}) == text

    def test_non_string_passthrough(self):
        from app.shared.services.validation.postprocess import rewrite_id_tokens

        assert rewrite_id_tokens(None, {}) is None
        assert rewrite_id_tokens(123, {}) == 123

    def test_case_insensitive_lookup(self):
        from app.shared.services.validation.postprocess import rewrite_id_tokens

        upper = _CUSTOMERS_ID.upper()
        out = rewrite_id_tokens(f"表 '{upper}'", {_CUSTOMERS_ID: _CUSTOMERS_NAME})
        assert _CUSTOMERS_NAME in out

    def test_humanize_item_texts_rewrites_known_fields_only(self):
        from app.shared.services.validation.postprocess import humanize_item_texts

        item = {
            "message": f"外键冲突: 目标表 '{_CUSTOMERS_ID}'",
            "description": f"外键约束: {_ORDERS_ID}.customer_id -> {_CUSTOMERS_ID}.customer_id",
            "suggestion": f"可用表: [{_CUSTOMERS_ID}]",
            "row_index": 3,
            "cell_value": "C-999",
        }
        humanize_item_texts(item, {_ORDERS_ID: _ORDERS_NAME, _CUSTOMERS_ID: _CUSTOMERS_NAME})
        assert _CUSTOMERS_NAME in item["message"]
        assert _ORDERS_NAME in item["description"] and _CUSTOMERS_NAME in item["description"]
        assert _CUSTOMERS_NAME in item["suggestion"]
        assert item["row_index"] == 3 and item["cell_value"] == "C-999"
