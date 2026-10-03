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
"""@fileoverview 约束摘要英文标签渲染（constraint_summaries）单元测试

describe_data 结构化描述 → 英文可读标签；与 zh description 的口径逐 kind
对位校验；未知 kind / 缺关键字段回退 None（调用方回退 description）。
"""

from __future__ import annotations

from app.cli.shell.constraint_summaries import render_constraint_label_en


class TestRenderConstraintLabelEn:
    """各 kind 的英文标签渲染"""

    def test_not_null(self):
        out = render_constraint_label_en({"kind": "NotNull", "table": "orders", "column": "order_id"})
        assert out == "NotNull: orders.order_id"

    def test_unique_multi_columns(self):
        out = render_constraint_label_en({"kind": "Unique", "table": "orders", "columns": ["order_id", "line_no"]})
        assert out == "Unique: orders.order_id, line_no"

    def test_allowed_values_full_and_truncated(self):
        full = render_constraint_label_en(
            {"kind": "AllowedValues", "table": "t", "column": "c", "allowed_values": ["a", "b"]}
        )
        assert full == "AllowedValues: t.c allowed ['a', 'b']"
        # 超过 5 个截断前 5 个加省略号（与 zh 口径一致）
        truncated = render_constraint_label_en(
            {"kind": "AllowedValues", "table": "t", "column": "c", "allowed_values": list("abcdef")}
        )
        assert truncated == "AllowedValues: t.c allowed ['a', 'b', 'c', 'd', 'e']..."

    def test_range_both_bounds_inclusive_and_exclusive(self):
        inc = render_constraint_label_en(
            {"kind": "Range", "table": "t", "column": "c", "min": 0, "max": 100, "boundary_mode": "inclusive"}
        )
        assert inc == "Range: t.c range [0, 100]"
        exc = render_constraint_label_en(
            {"kind": "Range", "table": "t", "column": "c", "min": 0, "max": 100, "boundary_mode": "exclusive"}
        )
        assert exc == "Range: t.c range (0, 100)"

    def test_range_single_bound(self):
        lo = render_constraint_label_en(
            {"kind": "Range", "table": "t", "column": "c", "min": 1, "boundary_mode": "inclusive"}
        )
        assert lo == "Range: t.c >= 1"
        hi = render_constraint_label_en(
            {"kind": "Range", "table": "t", "column": "c", "max": 100, "boundary_mode": "exclusive"}
        )
        assert hi == "Range: t.c < 100"
        none_bound = render_constraint_label_en({"kind": "Range", "table": "t", "column": "c"})
        assert none_bound == "Range: t.c"

    def test_foreign_key(self):
        out = render_constraint_label_en(
            {
                "kind": "ForeignKey",
                "from_table": "orders",
                "from_column": "customer_id",
                "to_table": "customers",
                "to_column": "customer_id",
            }
        )
        assert out == "ForeignKey: orders.customer_id -> customers.customer_id"

    def test_regex(self):
        # repr 转义与 zh description 的 {pattern!r} 口径一致（反斜杠被转义展示）
        out = render_constraint_label_en({"kind": "Regex", "table": "t", "column": "c", "pattern": r"^\d+$"})
        assert out == "Regex: t.c pattern='^\\\\d+$'"

    def test_charset_modes(self):
        out = render_constraint_label_en({"kind": "Charset", "table": "t", "column": "c", "charset_mode": "chinese"})
        assert out == "Charset: t.c (Chinese)"
        mixed = render_constraint_label_en(
            {"kind": "Charset", "table": "t", "column": "c", "charset_mode": "chinese_mixed"}
        )
        assert mixed == "Charset: t.c (Chinese (mixed))"
        unknown = render_constraint_label_en({"kind": "Charset", "table": "t", "column": "c", "charset_mode": "weird"})
        assert unknown == "Charset: t.c (unknown)"

    def test_scripted(self):
        out = render_constraint_label_en({"kind": "Scripted", "table": "t", "name": "手机号校验"})
        assert out == "Scripted: t.手机号校验"

    def test_conditional_simple_and_composite(self):
        simple = render_constraint_label_en(
            {
                "kind": "Conditional",
                "table": "t",
                "then_column": "credit_limit",
                "then": {"operator": "greater_than", "value": 1000},
                "if_column": "status",
                "if_value": "VIP",
                "if_conditions": [],
            }
        )
        assert simple == (
            "Conditional: t when status=VIP, credit_limit must satisfy DSL {'operator': 'greater_than', 'value': 1000}"
        )
        composite = render_constraint_label_en(
            {
                "kind": "Conditional",
                "table": "t",
                "then_column": "c",
                "then": "is_not_empty",
                "if_conditions": [{"column": "age", "operator": "greater_than", "value": 18}],
            }
        )
        assert composite == "Conditional: t when the condition holds, c must satisfy registered rule 'is_not_empty'"

    def test_date_logic_compare_and_calculation(self):
        cmp_label = render_constraint_label_en(
            {
                "kind": "DateLogic",
                "table": "t",
                "column": "birth",
                "logic_mode": "compare",
                "compare_op": "gt",
                "reference_date": "1900-01-01",
            }
        )
        assert cmp_label == "DateLogic: t.birth gt 1900-01-01"
        calc = render_constraint_label_en(
            {
                "kind": "DateLogic",
                "table": "t",
                "column": "birth",
                "logic_mode": "calculation",
                "calculation_type": "age",
            }
        )
        assert calc == "DateLogic: t.birth age check"

    def test_composite(self):
        out = render_constraint_label_en({"kind": "Composite", "table": None, "logic": "any", "sub_count": 3})
        assert out == "Composite (logic=any, 3 sub-constraints)"


class TestRenderFallbacks:
    """渲染安全网：异常输入回退 None（调用方用 description 兜底）"""

    def test_none_input(self):
        assert render_constraint_label_en(None) is None

    def test_unknown_kind(self):
        assert render_constraint_label_en({"kind": "Future", "table": "t"}) is None

    def test_missing_required_field(self):
        # NotNull 缺 column → 无法渲染，回退
        assert render_constraint_label_en({"kind": "NotNull", "table": "t"}) is None
        # ForeignKey 缺 to_table → 回退
        assert (
            render_constraint_label_en({"kind": "ForeignKey", "from_table": "a", "from_column": "x", "to_column": "y"})
            is None
        )

    def test_non_dict_input(self):
        assert render_constraint_label_en("NotNull") is None  # type: ignore[arg-type]
