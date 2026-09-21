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
@fileoverview AI 写盘 ↔ 运行时加载契约测试

端到端锁定：AI 动作经 _build_constraint_refs/_build_constraint_params 落盘的
ConstraintFile，必须能被运行时 factory（create_constraint）成功构建为可执行约束实例。

历史缺陷背景：Conditional 曾落盘 then_value（运行时无消费方，约束被 factory 静默丢弃）、
Charset/Composite 参数恒空（恒 ascii / 恒真 no-op）。本文件保证"AI 建的约束真的会校验"。
"""

from app.shared.core.project.constraint.factory import create_constraint
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
from app.shared.domain.constraints.charset import CharsetConstraint
from app.shared.domain.constraints.composite import CompositeConstraint
from app.shared.domain.constraints.conditional import ConditionalConstraint
from app.shared.domain.constraints.unique import UniqueConstraint
from app.shared.services.llm.constraints.constraint_builder import (
    _build_constraint_params,
    _build_constraint_refs,
)


def _schema_files() -> dict[str, TableSchemaFile]:
    return {
        "sc_users": TableSchemaFile(
            version=2,
            id="sc_users",
            name="users",
            columns=[
                ColumnSpec(id="c_email", name="email", type="string"),
                ColumnSpec(id="c_age", name="age", type="integer"),
                ColumnSpec(id="c_country", name="country", type="string"),
            ],
        ),
    }


def _build_and_load(action_type: str, spec: dict, constraint_id: str = "test_c"):
    """AI spec → refs/params → ConstraintFile → factory 构建。"""
    refs = _build_constraint_refs(action_type, spec.get("tableName", ""), spec.get("targetColumn", ""), spec)
    params = _build_constraint_params(
        action_type, spec, spec.get("tableName", ""), spec.get("targetColumn", ""), "", constraint_id
    )
    cf = ConstraintFile(
        version=2, id=constraint_id, type=__import_type(action_type), enabled=True, refs=refs, params=params
    )
    return create_constraint(cf, _schema_files())


def __import_type(raw: str) -> str:
    from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP

    return CONSTRAINT_TYPE_MAP.get(raw, raw)


class TestConditionalWriteContract:
    def test_then_condition_dsl_reaches_runtime(self):
        """AI 的 thenCondition DSL 落盘后必须能构建出可执行的 ConditionalConstraint。

        历史缺陷：落盘 then_value → 运行时 then_condition=None → TypeError → factory 丢弃。
        """
        spec = {
            "targetNodeId": "sc_users",
            "targetColumn": "email",
            "params": {
                "ifConditions": [{"ifColumnId": "c_country", "operator": "eq", "value": "CN"}],
                "thenCondition": {"operator": "not_null"},
            },
        }
        constraint, error = _build_and_load("CONDITIONAL", spec)
        assert error is None, f"约束构建失败: {error}"
        assert isinstance(constraint, ConditionalConstraint)
        assert constraint.then_column == "email"
        assert constraint.then_condition_config == {"operator": "not_null"}
        assert constraint.if_conditions[0]["if_column"] == "country"

    def test_then_condition_greater_than_executes(self):
        spec = {
            "targetNodeId": "sc_users",
            "targetColumn": "age",
            "params": {
                "ifConditions": [{"ifColumnId": "c_country", "operator": "eq", "value": "CN"}],
                "thenCondition": {"operator": "greater_than", "value": 18},
            },
        }
        constraint, error = _build_and_load("CONDITIONAL", spec)
        assert error is None
        assert isinstance(constraint, ConditionalConstraint)
        assert constraint._condition_func(20, {"age": 20}) is True
        assert constraint._condition_func(10, {"age": 10}) is False


class TestCharsetWriteContract:
    def test_chinese_mode_reaches_runtime(self):
        """AI 指定 chinese 必须落盘 charset_mode=chinese（历史缺陷：恒默认 ascii 系统性误报）。"""
        spec = {"targetNodeId": "sc_users", "targetColumnId": "c_email", "params": {"charsetMode": "chinese"}}
        constraint, error = _build_and_load("CHARSET", spec)
        assert error is None
        assert isinstance(constraint, CharsetConstraint)
        assert constraint.charset_mode == "chinese"


class TestCompositeWriteContract:
    def test_sub_constraints_reach_runtime(self):
        """AI 的 subConstraints 必须展开为引擎可执行的子约束（历史缺陷：恒空 = 恒真 no-op）。"""
        spec = {
            "targetNodeId": "sc_users",
            "targetColumnId": "c_email",
            "params": {
                "logic": "all",
                "subConstraints": [{"type": "NOT_NULL", "targetColumnId": "c_email"}],
            },
        }
        constraint, error = _build_and_load("COMPOSITE", spec)
        assert error is None, f"约束构建失败: {error}"
        assert isinstance(constraint, CompositeConstraint)
        assert constraint.logic == "all"
        assert len(constraint.sub_constraints) == 1


class TestUniqueWriteContract:
    def test_multi_column_reaches_runtime(self):
        spec = {"targetNodeId": "sc_users", "targetColumnIds": ["c_email", "c_age"]}
        constraint, error = _build_and_load("UNIQUE", spec)
        assert error is None
        assert isinstance(constraint, UniqueConstraint)
        assert constraint.columns == ["email", "age"]
