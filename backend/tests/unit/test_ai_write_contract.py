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


class TestScriptedPatternWriteContract:
    r"""Scripted pattern 参数端到端契约：AI 动作 → 真实写盘 → 真实校验引擎执行。

    历史缺陷（数据误报级）：pattern 经 re.escape 生成 "re.match(字面量, str(value))
    is not None"——沙箱只注册 re_match（re 未定义），逐行 SCRIPTED_EXECUTION_ERROR；
    且 re.escape 把 ^\d+$ 等正则元字符当字面量子串匹配。修复后生成
    re_match(pattern, str(value))（fullmatch 全串匹配，与独立 regex 约束同口径）。
    """

    def _build_project(self, tmp_path, csv_content: str):
        """搭建最小可校验项目：manifest + schema（指向 CSV）+ 数据文件。"""
        import yaml

        workspace = tmp_path / "proj"
        (workspace / "schemas").mkdir(parents=True)
        (workspace / "data").mkdir()
        (workspace / "data" / "codes.csv").write_text(csv_content, encoding="utf-8")

        schema_data = {
            "version": 2,
            "id": "sc_codes",
            "name": "codes",
            "source": {"mode": "relative_file", "path": "data/codes.csv"},
            "columns": [{"id": "code", "name": "code", "type": "string"}],
        }
        (workspace / "schemas" / "codes.schema.yaml").write_text(
            yaml.safe_dump(schema_data, allow_unicode=True), encoding="utf-8"
        )

        manifest = {
            "version": 2,
            "project": {"id": "p-scripted", "name": "scripted 契约测试"},
            "schemas": [{"id": "sc_codes", "path": "schemas/codes.schema.yaml"}],
        }
        (workspace / "project.precis.yaml").write_text(yaml.safe_dump(manifest, allow_unicode=True), encoding="utf-8")
        return workspace

    def test_pattern_constraint_validates_via_real_engine(self, tmp_path):
        """pattern 建约束 → 写盘 → 真实引擎跑：匹配行通过、不匹配行报违规、无执行错误。"""
        from app.shared.services.llm.actions.action_handlers import update_yaml_config
        from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

        workspace = self._build_project(tmp_path, "code\n123\n12a\n 42\n")
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "codes",
                "targetColumn": "code",
                "isInline": False,
                "params": {"pattern": r"^\d+$"},
            },
        }
        success, constraint_id = update_yaml_config(action, str(workspace))
        assert success is True, f"写盘失败: {constraint_id}"

        # 落盘断言：表达式必须是沙箱函数形式（旧式 "re.match(...)" 在沙箱内逐行执行错误）
        import yaml

        constraint_file = workspace / "constraints" / f"{constraint_id}.constraint.yaml"
        cf = yaml.safe_load(constraint_file.read_text(encoding="utf-8"))
        assert cf["params"]["expression"] == f"re_match({r'^\d+$'!r}, str(value))"

        executor = ValidationExecutor(str(workspace / "project.precis.yaml"))
        result = executor.execute(str(workspace), ValidationOptions(allow_unsafe_eval=True))
        errors = result.get("errors", [])

        # 无任何执行/定义错误（旧缺陷的表现形态就是逐行 ScriptCheckExecutionError）
        script_errors = [e for e in errors if str(e.get("error_type", "")).startswith("Script")]
        assert script_errors == [], f"存在脚本执行错误: {script_errors}"
        # '12a'(行1) 与 ' 42'(行2，前导空格 fullmatch 不通过) 各报一条违规；'123'(行0) 通过
        violations = [e for e in errors if e.get("error_type") == "BusinessLogicViolation"]
        assert sorted(e.get("row_index") for e in violations) == [1, 2]
        assert len(violations) == 2

    def test_pattern_with_quotes_no_injection_escape(self, tmp_path):
        """pattern 含引号：repr 封闭字面量，注入串按字面 pattern 求值（不逃逸为代码）。"""
        from app.shared.services.llm.actions.action_handlers import update_yaml_config
        from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

        # 恶意尝试（须为合法正则才能作为注入探针）：闭合引号 + 布尔 or 篡改判定——
        # repr 转义后仅是字面 pattern，逐字符精确匹配
        malicious = "x' or '1'=='1"
        workspace = self._build_project(tmp_path, "code\nx' or '1'=='1\nplain\nx\n")
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "codes",
                "targetColumn": "code",
                "isInline": False,
                "params": {"pattern": malicious},
            },
        }
        success, _ = update_yaml_config(action, str(workspace))
        assert success is True

        executor = ValidationExecutor(str(workspace / "project.precis.yaml"))
        result = executor.execute(str(workspace), ValidationOptions(allow_unsafe_eval=True))
        errors = result.get("errors", [])

        # 注入未生效：仅等于恶意串本身的行(行0) fullmatch 通过，'plain'(行1) 与 'x'(行2) 报违规；
        # 若注入成功（表达式被解析为 'x' or '1'=='1' 恒真），所有行都通过、0 违规——即为断言反面
        violations = [e for e in errors if e.get("error_type") == "BusinessLogicViolation"]
        assert [e.get("row_index") for e in violations] == [1, 2]
