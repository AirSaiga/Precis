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
"""@fileoverview errors[].suggestion 可选字段守卫（契约 v1 增补）

两类首发生成器：
- AllowedValues：值与允许值相近（difflib cutoff 0.6）→ "是否应为 X"；不相近不给
- 日期类型错误：值按其他常见布局可解析 → "改写为 YYYY-MM-DD"；无法判定不给

契约要求：suggestion 是可选字段，JSON 输出恒有该键（无建议时为 null）。
"""

from __future__ import annotations

import json

import pandas as pd

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand
from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint


class TestAllowedValuesSuggestion:
    """AllowedValues 相近值建议（域层单元）"""

    def _validate(self, values: list, allowed: list) -> list[dict]:
        constraint = AllowedValuesConstraint(table="t", column="status", allowed_values=set(allowed))
        datasets = {"t": pd.DataFrame({"status": values})}
        return constraint.validate(datasets)["errors"]

    def test_close_value_gets_suggestion(self):
        """'shiped'（拼写误差）与允许值 'shipped' 相近 → suggestion 提示。"""
        errors = self._validate(["shiped"], ["pending", "paid", "shipped"])
        assert len(errors) == 1
        assert errors[0]["suggestion"] is not None
        assert "shipped" in errors[0]["suggestion"]

    def test_semantically_close_but_lexically_far_no_suggestion(self):
        """'delivered' 与 'shipped' 语义相近但词法不相近 → 不冒进给建议。"""
        errors = self._validate(["delivered"], ["pending", "paid", "shipped"])
        assert len(errors) == 1
        assert errors[0].get("suggestion") is None

    def test_distant_value_no_suggestion_key_value_none(self):
        """'zzz' 与任何允许值不相近 → suggestion 为 None（宁缺毋滥）。"""
        errors = self._validate(["zzz"], ["pending", "paid", "shipped"])
        assert len(errors) == 1
        assert errors[0].get("suggestion") is None

    def test_exact_prefix_match_suggested(self):
        """'pendin'（漏字母）→ 建议 'pending'。"""
        errors = self._validate(["pendin"], ["pending", "paid", "shipped"])
        assert "pending" in (errors[0].get("suggestion") or "")


class TestDateRangeSuggestion:
    """日期类型错误的取值范围定位建议（域层单元）

    注：§1.21 宽松解析下斜线/点分布局（2026/06/01）被当合法日期接受、
    不报错——布局类建议没有触发面；真正报错的是月/日取值非法的值。
    """

    def _process(self, values: list) -> list[dict]:
        from app.shared.domain.data_types_parts.scalars import DateType

        series = pd.Series(values, name="d")
        _, errors = DateType().process_column(series, "d", nullable=True)
        return errors

    def test_month_out_of_range_hint(self):
        """2026-13-01 → 建议指出月份超范围。"""
        errors = self._process(["2026-13-01"])
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert len(type_errors) == 1
        assert "月份取值 13" in type_errors[0]["suggestion"]

    def test_day_out_of_range_hint(self):
        """2026-06-32 → 建议指出日超范围。"""
        errors = self._process(["2026-06-32"])
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert "日取值 32" in type_errors[0]["suggestion"]

    def test_feb_30_hint(self):
        """2026-02-30 → 建议指出 2 月天数上限。"""
        errors = self._process(["2026-02-30"])
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert "2026 年 2 月只有 28 天" in type_errors[0]["suggestion"]

    def test_garbage_no_suggestion(self):
        """非日期乱串（abc）→ 无建议。"""
        errors = self._process(["abc"])
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert len(type_errors) == 1
        assert type_errors[0].get("suggestion") is None

    def test_slash_layout_accepted_no_error(self):
        """2026/06/01 按宽松解析合法（§1.21），不产生任何错误。"""
        errors = self._process(["2026/06/01"])
        assert errors == []


_CSV = "id,status,order_date\n1,shiped,2026-13-01\n2,delivered,2026-06-02\n"
_ALLOWED = """version: 2
id: status-allowed
type: AllowedValues
enabled: true
refs:
  table_id: orders
  column_id: status
params:
  allowed_values: [pending, paid, shipped]
"""


class TestSuggestionJsonContract:
    """CLI --format json 输出侧：suggestion 键恒存在，无建议为 null"""

    def test_payload_carries_suggestion(self, tmp_path, capsys):
        """端到端：delivered 行带建议、zzz 行 suggestion 为 null。"""
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
  - id: status
    name: status
    type: string
  - id: order_date
    name: order_date
    type: date
""",
            encoding="utf-8",
        )
        (proj / "constraints" / "allowed.constraint.yaml").write_text(_ALLOWED, encoding="utf-8")
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: sugg-demo
  name: sugg-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: status-allowed
    path: constraints/allowed.constraint.yaml
""",
            encoding="utf-8",
        )
        cmd = ValidateCommand()
        cmd.execute(["--manifest", str(proj / "project.precis.yaml"), "--format", "json"], ProjectContext())
        payload = json.loads(capsys.readouterr().out)

        by_value = {str(e["cell_value"]): e for e in payload["errors"]}
        # shiped（拼写误差）：AllowedValues 违规 + 相近建议
        assert "shipped" in (by_value["shiped"]["suggestion"] or "")
        # delivered：违规但与任何允许值词法不相近 → null（宁缺毋滥；
        # delivered→shipped 属语义相近，词法建议不冒进，键仍存在）
        assert "suggestion" in by_value["delivered"]
        assert by_value["delivered"]["suggestion"] is None
        # 2026-13-01：格式错误 + 月份超范围定位建议
        assert "月份取值 13" in (by_value["2026-13-01"]["suggestion"] or "")
