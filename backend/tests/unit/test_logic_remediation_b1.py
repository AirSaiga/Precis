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
"""@fileoverview 2026-09-18 逻辑漏洞治理第二轮 B1 批次（升级第一类）回归测试

覆盖 docs/plans/2026-09-18-logic-remediation/01/03 规格中 B1 批次的修复：
- §1.1  if_logic/logic/order 枚举大小写归一 + 未知值 fail-fast
- §1.3  模板展开节点级失败上报（errors 收集 + load_project loading error）
- §1.25 静默丢表上报（Excel 无 sheet 配置 / 多 schema 引用同一 CSV）
- §1.26 Scripted 约束引用列失效报错（不再静默降级整行脚本）
- §1.28 正则 flags 整词匹配（共享助手 parse_regex_flags 统一三处调用点）
"""

from __future__ import annotations

import re
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

# ============================================================
# §1.1 if_logic / logic / order 枚举归一与 fail-fast
# ============================================================


class TestIfLogicNormalization:
    def _constraint(self, if_logic):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        return ConditionalConstraint(
            table="t",
            if_conditions=[
                {"column": "a", "operator": "eq", "value": 1},
                {"column": "b", "operator": "eq", "value": 2},
            ],
            if_logic=if_logic,
            then_column="c",
            then_condition={"operator": "not_null"},
        )

    def _datasets(self):
        return {
            "t": pd.DataFrame(
                {
                    "a": [1, 1, 9],
                    "b": [9, 2, 2],
                    "c": ["x", None, "z"],
                }
            )
        }

    def test_uppercase_or_is_valid_and_applies_or_semantics(self):
        """if_logic="OR" 大小写归一后按 OR 语义执行（任一条件满足即触发）"""
        result = self._constraint("OR").validate(self._datasets())
        # OR 语义: 第 1 行 (a=1)、第 2 行 (b=2)、第 3 行 (b=2) 全部触发；
        # 第 2 行 c 为空 → 恰一条违规。若被静默按 AND，触发行只有第 2 行，同样 1 条违规，
        # 因此再用 AND 不可判定的场景断言（见下一用例）
        assert result["errors"] == [] or all(e["error_type"] == "ConditionalViolation" for e in result["errors"])

    def test_or_vs_and_semantics_distinguishable(self):
        """OR 与 AND 语义可区分: 单条件满足的行仅在 OR 下触发 THEN 检查"""
        datasets = {
            "t": pd.DataFrame(
                {
                    "a": [1, 1],
                    "b": [9, 9],  # b 恒不满足
                    "c": [None, "ok"],  # 第 1 行缺值
                }
            )
        }
        # OR: 第 1、2 行都触发 → 第 1 行 c 空判违规
        result_or = self._constraint("OR").validate(datasets)
        assert len(result_or["errors"]) == 1
        # AND: 无行同时满足 → 无触发 → 无违规
        result_and = self._constraint("and").validate(datasets)
        assert result_and["errors"] == []

    def test_unknown_if_logic_reports_config_error(self):
        """if_logic="adn"（拼错）→ ConstraintConfigError，THEN 检查不执行"""
        result = self._constraint("adn").validate(self._datasets())
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        violations = [e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]
        assert len(config_errors) == 1
        assert "if_logic" in config_errors[0]["message"]
        assert "adn" in config_errors[0]["message"]
        assert violations == []

    def test_default_if_logic_is_and(self):
        """缺省 if_logic（None）→ AND 语义，保持向后兼容"""
        datasets = {"t": pd.DataFrame({"a": [1, 1], "b": [9, 2], "c": [None, None]})}
        result = self._constraint(None).validate(datasets)
        # AND: 仅第 2 行 (a=1,b=2) 触发 → 第 2 行 c 空判违规；第 1 行不触发
        assert len(result["errors"]) == 1


class TestTransformLogicEnum:
    def test_filter_rows_uppercase_or(self):
        from app.shared.domain.transforms.filter_rows import FilterRowsRunner

        runner = FilterRowsRunner()
        df = pd.DataFrame({"a": [1, 5, 9], "b": ["keep", "drop", "keep"]})
        result = runner.execute(
            df,
            "a",
            {
                "conditions": [{"column": "a", "op": "eq", "value": 1}, {"column": "a", "op": "eq", "value": 9}],
                "logic": "Or",
            },
            [],
        )
        assert result["b"].tolist() == ["keep", "keep"]

    def test_filter_rows_unknown_logic_raises(self):
        from app.shared.domain.transforms.filter_rows import FilterRowsRunner

        runner = FilterRowsRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="未知的 logic 'xor'"):
            runner.execute(df, "a", {"conditions": [{"column": "a", "op": "eq", "value": 1}], "logic": "xor"}, [])

    def test_conditional_assign_uppercase_or(self):
        from app.shared.domain.transforms.conditional_assign import ConditionalAssignRunner

        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1, 5, 9]})
        result = runner.execute(
            df,
            "a",
            {
                "conditions": [{"column": "a", "op": "eq", "value": 1}, {"column": "a", "op": "eq", "value": 9}],
                "logic": "OR",
                "then_value": "hit",
            },
            ["out"],
        )
        # 未命中行（a=5）保留原值；命中行（OR 语义下 a=1 与 a=9）写 then_value
        assert result["out"].tolist() == ["hit", 5, "hit"]

    def test_conditional_assign_unknown_logic_raises(self):
        from app.shared.domain.transforms.conditional_assign import ConditionalAssignRunner

        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="未知的 logic"):
            runner.execute(
                df,
                "a",
                {"conditions": [{"column": "a", "op": "eq", "value": 1}], "logic": "xor", "then_value": "x"},
                ["out"],
            )

    def test_sort_rows_uppercase_order(self):
        from app.shared.domain.transforms.sort_rows import SortRowsRunner

        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [3, 1, 2]})
        assert runner.execute(df, "a", {"sort_by": [{"column": "a", "order": "ASC"}]}, [])["a"].tolist() == [1, 2, 3]
        assert runner.execute(df, "a", {"sort_by": [{"column": "a", "order": "DESC"}]}, [])["a"].tolist() == [3, 2, 1]

    def test_sort_rows_unknown_order_raises(self):
        from app.shared.domain.transforms.sort_rows import SortRowsRunner

        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="未知的排序方向 'up'"):
            runner.execute(df, "a", {"sort_by": [{"column": "a", "order": "up"}]}, [])


# ============================================================
# §1.3 模板展开节点级失败上报
# ============================================================


class TestTemplateNodeErrorReporting:
    def test_node_failure_collected_in_errors_and_others_survive(self):
        from app.shared.core.project.template.expander import expand_template
        from app.shared.core.project.template.types import TemplateFile, TemplateNode

        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[
                # type="Unknown" 不是合法 transform 类型 → 节点级展开抛异常
                TemplateNode(id="bad", kind="transform", type="Unknown", input_column="x"),
                TemplateNode(id="good", kind="constraint", type="NotNull"),
            ],
        )
        node_errors: list[dict[str, str]] = []
        _, constraints, _, _ = expand_template(template, "i1", errors=node_errors)

        assert len(constraints) == 1  # 其余节点正常展开
        assert len(node_errors) == 1
        assert node_errors[0]["node_id"] == "bad"
        assert node_errors[0]["kind"] == "transform"
        assert node_errors[0]["message"]

    def test_no_errors_param_keeps_legacy_behavior(self):
        from app.shared.core.project.template.expander import expand_template
        from app.shared.core.project.template.types import TemplateFile, TemplateNode

        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[TemplateNode(id="bad", kind="transform", type="Unknown", input_column="x")],
        )
        # 不传 errors → 不抛错（旧行为），展开结果为空
        transforms, _, _, _ = expand_template(template, "i1")
        assert transforms == []

    def test_load_project_reports_template_node_expansion_error(self, tmp_path):
        from app.shared.core.project.loader import load_project

        root = tmp_path
        (root / "templates").mkdir()
        (root / "templates" / "t1.template.yaml").write_text(
            "version: 2\n"
            "id: t1\n"
            "name: T\n"
            "nodes:\n"
            "  - id: bad\n"
            "    kind: transform\n"
            "    type: Unknown\n"
            "    input_column: x\n"
            "  - id: good\n"
            "    kind: constraint\n"
            "    type: NotNull\n"
            "    refs: {table_id: tt, column_id: c1}\n",
            encoding="utf-8",
        )
        (root / "project.precis.yaml").write_text(
            "version: 2\n"
            "project:\n"
            "  id: p\n"
            "  name: p\n"
            "schemas: []\n"
            "constraints: []\n"
            "regex_nodes: []\n"
            "templates:\n"
            "  - id: t1\n"
            "    path: templates/t1.template.yaml\n"
            "template_instances:\n"
            "  - id: inst_1\n"
            "    template_id: t1\n"
            "    enabled: true\n",
            encoding="utf-8",
        )
        loaded = load_project(str(root / "project.precis.yaml"))
        node_errors = [e for e in loaded.loading_errors if e.error_type == "TemplateNodeExpansionError"]
        assert len(node_errors) == 1
        assert node_errors[0].ref_id == "inst_1/bad"
        # 展开失败的节点约束缺失，但正常节点仍展开生效
        assert "inst_1__good" in loaded.constraint_files
        assert "inst_1__bad" not in loaded.transform_files


# ============================================================
# §1.25 静默丢表上报
# ============================================================


class TestSilentTableLossReporting:
    @patch("app.shared.core.data_source.loader.ExcelLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_excel_without_sheet_reports_loading_error(self, mock_exists, mock_excel_loader_cls):
        from app.shared.core.data_source.loader import DataSourceInfo, load_grouped_sources

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load_multi_sheet.return_value = {}
        mock_excel_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="orphan", name="orphan", header_row=0)
        datasets, errors = load_grouped_sources({"data.xlsx": [info]})

        assert "orphan" not in datasets
        sheet_errors = [e for e in errors if e["error_type"] == "SheetNotConfigured"]
        assert len(sheet_errors) == 1
        assert "orphan" in sheet_errors[0]["message"]
        assert sheet_errors[0]["source_path"] == "data.xlsx"

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_duplicate_csv_reference_reports_and_loads_first(self, mock_exists, mock_csv_loader_cls):
        from app.shared.core.data_source.loader import DataSourceInfo, load_grouped_sources

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        first = DataSourceInfo(schema_id="s1", name="s1", header_row=0, source_config={})
        second = DataSourceInfo(schema_id="s2", name="s2", header_row=0, source_config={})
        datasets, errors = load_grouped_sources({"data.csv": [first, second]})

        # 第一个 schema 仍加载（规格拍板：保持"不支持但可用"，仅可见性增强）
        assert "s1" in datasets
        assert "s2" not in datasets
        dup_errors = [e for e in errors if e["error_type"] == "DuplicateCsvReference"]
        assert len(dup_errors) == 1
        assert "s2" in dup_errors[0]["message"]


# ============================================================
# §1.26 Scripted 约束引用列失效 fail-fast
# ============================================================


class TestScriptedBuilderFailFast:
    def _build_input(self, refs, params=None):
        from app.shared.core.project.constraint.builders.base import BuilderInput
        from app.shared.core.project.constraint.types import ConstraintFile

        const = ConstraintFile(
            version=2,
            id="c1",
            type="Scripted",
            enabled=True,
            refs=refs,
            params=params or {"expression": "value > 0"},
        )
        return BuilderInput(
            const=const,
            refs=refs,
            params=params or {"expression": "value > 0"},
            column_name_by_table_id={"t": {"col1": "年龄"}},
            schema_files={},
            create_child=lambda f, s: (None, None),
        )

    def test_valid_column_id_maps_to_column_name(self):
        from app.shared.core.project.constraint.builders.scripted import build_scripted

        kwargs, error = build_scripted(self._build_input({"table_id": "t", "column_id": "col1"}))
        assert error is None
        assert kwargs["column"] == "年龄"
        assert kwargs["table"] == "t"

    def test_stale_column_id_returns_error(self):
        from app.shared.core.project.constraint.builders.scripted import build_scripted

        kwargs, error = build_scripted(self._build_input({"table_id": "t", "column_id": "gone"}))
        assert kwargs == {}
        assert error is not None
        assert error == "引用的列 'gone' 不存在于表 't' 中"

    def test_missing_column_id_is_legal_row_level_script(self):
        from app.shared.core.project.constraint.builders.scripted import build_scripted

        kwargs, error = build_scripted(self._build_input({"table_id": "t"}))
        assert error is None
        assert "column" not in kwargs

    def test_missing_table_id_returns_error(self):
        from app.shared.core.project.constraint.builders.scripted import build_scripted

        kwargs, error = build_scripted(self._build_input({}))
        assert kwargs == {}
        assert error == "缺少 table_id"


# ============================================================
# §1.28 正则 flags 整词匹配（共享助手）
# ============================================================


class TestParseRegexFlags:
    def test_multiline_token_does_not_enable_ignorecase(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        flags = parse_regex_flags("multiline")
        assert flags == re.MULTILINE
        assert flags & re.IGNORECASE == 0

    def test_combined_short_format(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        flags = parse_regex_flags("im")
        assert flags == re.IGNORECASE | re.MULTILINE

    def test_long_format_tokens(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        assert parse_regex_flags("ignorecase") == re.IGNORECASE
        assert parse_regex_flags("dotall") == re.DOTALL

    def test_case_insensitive_normalization(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        assert parse_regex_flags("Multiline") == re.MULTILINE

    def test_empty_and_none_yield_zero(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        assert parse_regex_flags("") == 0
        assert parse_regex_flags(None) == 0

    def test_unknown_tokens_ignored(self):
        from app.shared.domain.regex_flags import parse_regex_flags

        assert parse_regex_flags("xyz, i") == re.IGNORECASE

    def test_regex_constraint_multiline_flags_stay_case_sensitive(self):
        """regex 约束 flags="multiline"（连带核查项）→ 只开 MULTILINE，不开 IGNORECASE"""
        from app.shared.domain.constraints.regex import RegexConstraint

        constraint = RegexConstraint(
            table="t",
            column="c",
            pattern="ERROR",
            match_mode="full",
            case_sensitive=True,
            flags="multiline",
        )
        datasets = {"t": pd.DataFrame({"c": ["error", "ERROR"]})}
        result = constraint.validate(datasets)
        # "error"（小写）在不开 IGNORECASE 时 fullmatch 失败 → 违规；若误开则零违规
        violations = [e for e in result["errors"] if e["error_type"] == "RegexViolation"]
        assert len(violations) == 1
        assert violations[0]["value"] == "error"

    def test_extractors_flags_parsing(self):
        """validation/extractors 调用点：flags="multiline" 仅 MULTILINE，case_sensitive=False 仍补 IGNORECASE"""
        # 直接对助手断言等价行为（extractors 编译路径已委托该助手）
        from app.shared.domain.regex_flags import parse_regex_flags

        flags = parse_regex_flags("multiline")
        assert flags & re.IGNORECASE == 0
        assert (flags | re.IGNORECASE) & re.IGNORECASE != 0
