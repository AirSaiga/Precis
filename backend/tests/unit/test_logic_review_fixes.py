"""@fileoverview 2026-09 逻辑审查修复批次的回归测试

覆盖审查报告（docs/audit/2026-09-03-backend-logic-review.md）坐实缺陷的修复：
- D3  CompositeValidator 子约束异常计入失败（原实现静默假通过）
- D4  CLI 交互模式 exit 进程退出码为 0（原把 should_exit 哨兵透传为进程码）
- D5  FK 缺 target_values 报配置错误（原按空目标表处理 → 全表误报数据错误）
- D6  days_diff 缺 target_column 报配置错误（原 fail-open 静默通过）
- D7  cast_type 转 bool 空值透传 None（原 bool(nan)=True）
- D8  modulo/math_expr 小数结果保留 float（原 astype("Int64") 未捕获 TypeError）
- D9  SQL 危险关键字词边界匹配（列名 last_update 不再误杀）
- D10 regex flags 整词解析（"multiline" 不再误开 IGNORECASE）
- D11 manifest warnings 追加保留（原整体覆盖丢用户手写内容）
- D14 DisplayNameUpdateRequest 拒绝空/纯空白名
- D16 transform 输出列空值透传 None（原 astype(str) 产生 "nan"/"None" 字面量）
- D17 data_engine JSON 列空值填充为空 dict（原 fillna({}) 恒空操作）
- N1  composite builder 子约束非法 → 整条约束构建失败（原静默空过）
- N2  ProjectInfo.description roundtrip 保全
- D1/D2 预览工作表名助手 get_excel_sheet_names（引擎自适应 + 句柄关闭）
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import pytest

# ============================================================
# D3: CompositeValidator 子约束异常计入失败
# ============================================================


class TestCompositeChildException:
    def _validator(self, fn):
        from app.shared.services.validation.validators.composite import CompositeValidator

        return CompositeValidator(validate_fn=fn)

    def test_any_all_children_raise_never_passes(self):
        """logic=any 且唯一子约束抛异常 → 不得判通过（原实现假通过）"""

        def raising_fn(**kwargs):
            raise RuntimeError("子约束内部爆炸")

        df = pd.DataFrame({"x": ["a", "b"]})
        v = self._validator(raising_fn)
        result = v.validate(df, "x", logic="any", sub_constraints=[{"type": "notnull", "params": {}}])
        assert result.is_valid is False
        assert result.error_count == 1

    def test_all_semantics_broken_by_exception_is_fixed(self):
        """logic=all 下一个子约束通过、另一个抛异常 → 必须失败（原实现假通过）"""
        from app.shared.services.validation.types import ValidationType

        def half_raising_fn(**kwargs):
            if kwargs.get("validation_type") == ValidationType.UNIQUE:
                raise RuntimeError("boom")
            from app.shared.services.validation.types import ValidationResult

            return ValidationResult(is_valid=True, error_count=0, total_rows=2, error_rows=[])

        df = pd.DataFrame({"x": ["a", "b"]})
        v = self._validator(half_raising_fn)
        result = v.validate(
            df,
            "x",
            logic="all",
            sub_constraints=[
                {"type": "notnull", "params": {}},
                {"type": "unique", "params": {}},
            ],
        )
        assert result.is_valid is False

    def test_any_with_one_passing_and_one_raising_still_passes(self):
        """logic=any 下一个子约束通过、另一个抛异常 → 仍通过（any 语义不变）"""
        from app.shared.services.validation.types import ValidationResult, ValidationType

        def half_raising_fn(**kwargs):
            if kwargs.get("validation_type") == ValidationType.UNIQUE:
                raise RuntimeError("boom")
            return ValidationResult(is_valid=True, error_count=0, total_rows=2, error_rows=[])

        df = pd.DataFrame({"x": ["a", "b"]})
        v = self._validator(half_raising_fn)
        result = v.validate(
            df,
            "x",
            logic="any",
            sub_constraints=[
                {"type": "notnull", "params": {}},
                {"type": "unique", "params": {}},
            ],
        )
        assert result.is_valid is True


# ============================================================
# D4: CLI 交互模式 exit 进程退出码
# ============================================================


class TestCliExitExitCode:
    def test_exit_command_yields_clean_exit(self):
        """交互循环中 exit（should_exit 哨兵）→ run() 返回 0（与 qq/EOF 一致）"""
        import unittest.mock as mock

        from app.cli.shell.main import CLIShell

        shell = CLIShell()

        def fake_execute(_executor, _line):
            return 1  # _execute_line 的 should_exit 哨兵返回值

        with (
            mock.patch.object(CLIShell, "_get_prompt", return_value="> "),
            mock.patch.object(CLIShell, "_setup_readline", return_value=False),
            mock.patch.object(CLIShell, "_execute_line", side_effect=fake_execute),
            mock.patch("builtins.input", side_effect=["exit"]),
            mock.patch("builtins.print"),
        ):
            code = shell.run()
        assert code == 0

    def test_execute_line_sentinel_contract(self):
        """should_exit=True → _execute_line 返回非 0 哨兵（循环退出语义）"""
        from app.cli.shell.main import CLIShell

        shell = CLIShell()
        result = type("R", (), {"message": "", "success": True, "should_exit": True})()
        executor = type("E", (), {"execute": staticmethod(lambda line: result)})()
        assert shell._execute_line(executor, "exit") != 0


# ============================================================
# D5: FK 缺 target_values → 配置错误而非全表误报
# ============================================================


class TestFkMissingTargetValues:
    def test_missing_target_values_reports_config_error(self):
        from app.shared.services.validation.service import UnifiedValidationService

        df = pd.DataFrame({"uid": [1, 2, 3]})
        result = UnifiedValidationService.validate(
            validation_type="foreign_key", df=df, column="uid", target_table="users", target_column="id"
        )
        assert result.is_valid is False
        assert result.error_count == 1
        assert "target_values" in result.error_rows[0]["error_message"]

    def test_explicit_empty_target_values_keeps_data_error_semantics(self):
        """显式空列表 = 目标表确认为空 → 逐行外键冲突（数据错误语义保留）"""
        from app.shared.services.validation.service import UnifiedValidationService

        df = pd.DataFrame({"uid": [1, 2]})
        result = UnifiedValidationService.validate(
            validation_type="foreign_key",
            df=df,
            column="uid",
            target_table="users",
            target_column="id",
            target_values=[],
        )
        assert result.is_valid is False
        assert result.error_count == 2


# ============================================================
# D6: days_diff 缺 target_column → 配置错误
# ============================================================


class TestDaysDiffMissingTargetColumn:
    def test_missing_target_column_fails_closed(self):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        c = DateLogicConstraint(
            table="t",
            column="d1",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_value=5,
        )
        df = pd.DataFrame({"d1": ["2024-01-01", "2024-01-02"]})
        result = c.validate({"t": df})
        errors = result["errors"]
        assert len(errors) == 1
        assert errors[0]["error_type"] == "ConstraintConfigError"
        assert "target_column" in errors[0]["message"]

    def test_valid_config_still_passes(self):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        c = DateLogicConstraint(
            table="t",
            column="d1",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_value=5,
            target_column="d2",
            compare_op="gte",
        )
        df = pd.DataFrame({"d1": ["2024-01-01"], "d2": ["2024-02-01"]})
        result = c.validate({"t": df})
        assert result["errors"] == []


# ============================================================
# D7: cast_type 转 bool 空值透传
# ============================================================


class TestCastTypeBoolNull:
    def test_nan_and_none_become_none_not_true(self):
        from app.shared.domain.transforms.cast_type import CastTypeRunner

        df = pd.DataFrame({"x": [1.0, np.nan, 0.0, None]})
        out = CastTypeRunner().execute(df.copy(), "x", {"target_type": "bool"}, ["y"])
        values = out["y"].tolist()
        assert values[0] is True
        assert values[1] is None
        assert values[2] is False
        assert values[3] is None


# ============================================================
# D8: modulo / math_expr 小数结果不炸整条转换
# ============================================================


class TestFractionalResultsPreserved:
    def test_modulo_fractional_remainder_keeps_float(self):
        from app.shared.domain.transforms.modulo import ModuloRunner

        df = pd.DataFrame({"v": [2.5, 3.0]})
        out = ModuloRunner().execute(df.copy(), "v", {"divisor": 2}, ["m"])
        assert out["m"].tolist()[0] == pytest.approx(0.5)
        assert out["m"].tolist()[1] == pytest.approx(1.0)

    def test_math_expr_fractional_int_output_keeps_float(self):
        from app.shared.domain.transforms.math_expr import MathExprRunner

        df = pd.DataFrame({"a": [7.0], "b": [2.0]})
        out = MathExprRunner().execute(df.copy(), "a", {"expression": "@a / @b", "output_type": "int"}, ["r"])
        assert out["r"].tolist()[0] == pytest.approx(3.5)


# ============================================================
# D9: SQL 危险关键字词边界匹配
# ============================================================


class TestSqlKeywordWordBoundary:
    def _loader(self):
        from app.shared.core.data_source.loaders.sql_loader import SQLLoader
        from app.shared.core.data_source.specs.sql_source import SQLSourceSpec

        return SQLLoader(SQLSourceSpec(connection_string="sqlite://", table_or_query="SELECT 1"))

    def test_column_named_last_update_is_allowed(self):
        assert self._loader()._sanitize_query("SELECT last_update FROM t") == "SELECT last_update FROM t"

    def test_union_in_column_name_is_allowed(self):
        assert self._loader()._sanitize_query("SELECT union_flag FROM t")

    def test_real_union_still_rejected(self):
        with pytest.raises(Exception, match="union"):
            self._loader()._sanitize_query("SELECT 1 FROM t UNION SELECT 2")

    def test_comment_still_rejected(self):
        with pytest.raises(Exception, match="--"):
            self._loader()._sanitize_query("SELECT id FROM t -- 注释")

    def test_drop_statement_still_rejected(self):
        # 非 SELECT 开头本就先被拒；这里验证词边界下的独立 UPDATE 关键字仍拦截
        with pytest.raises(Exception):
            self._loader()._sanitize_query("SELECT * FROM t; update t set a=1")


# ============================================================
# D10: regex_extract utils flags 整词解析
# ============================================================


class TestRegexFlagsTokenParsing:
    def test_multiline_flag_does_not_enable_ignorecase(self):
        from app.shared.core.utils.regex_extract import extract_columns_from_values

        _, _, matched, _ = extract_columns_from_values(r"hello", "multiline", True, ["Hello", "world"])
        assert matched == 0  # 原 bug：multiline 含字母 i → IGNORECASE 误开 → 误匹配

    def test_short_combined_flags_still_work(self):
        from app.shared.core.utils.regex_extract import extract_columns_from_values

        _, _, matched, _ = extract_columns_from_values(r"hello", "im", True, ["Hello"])
        assert matched == 1

    def test_long_format_flag_works(self):
        from app.shared.core.utils.regex_extract import extract_columns_from_values

        _, _, matched, _ = extract_columns_from_values(r"hello", "ignorecase", True, ["Hello"])
        assert matched == 1


# ============================================================
# D11: manifest warnings 追加保留
# ============================================================


class TestManifestWarningsPreserved:
    def test_existing_warnings_not_overwritten(self):
        from app.shared.core.project.manifest.types import ProjectManifest

        m = ProjectManifest(
            version=2,
            project={"id": "p", "name": "p"},
            schemas=[
                {"id": "dup", "path": "a.schema.yaml"},
                {"id": "dup", "path": "b.schema.yaml"},
            ],
            warnings=["手写的既有警告"],
        )
        assert "手写的既有警告" in m.warnings
        assert any("重复" in w for w in m.warnings)


# ============================================================
# D14: DisplayNameUpdateRequest 空值校验
# ============================================================


class TestDisplayNameValidation:
    def test_empty_name_rejected(self):
        from pydantic import ValidationError

        from app.api.routers.project.models import DisplayNameUpdateRequest

        with pytest.raises(ValidationError):
            DisplayNameUpdateRequest(name="")

    def test_blank_name_rejected(self):
        from pydantic import ValidationError

        from app.api.routers.project.models import DisplayNameUpdateRequest

        with pytest.raises(ValidationError):
            DisplayNameUpdateRequest(name="   ")

    def test_valid_name_accepted(self):
        from app.api.routers.project.models import DisplayNameUpdateRequest

        assert DisplayNameUpdateRequest(name="客户信息表").name == "客户信息表"


# ============================================================
# D16: transform 输出列空值透传
# ============================================================


class TestTransformNullPreservation:
    def test_concat_single_column_null_stays_null(self):
        from app.shared.domain.transforms.concat import ConcatRunner

        df = pd.DataFrame({"a": ["x", None], "b": ["y", "z"]})
        out = ConcatRunner().execute(df.copy(), "a", {"columns": ["a", "b"]}, ["c"])
        assert out["c"].tolist()[0] == "xy"
        assert out["c"].tolist()[1] is None

    def test_lower_case_null_stays_null(self):
        from app.shared.domain.transforms.lower_case import LowerCaseRunner

        df = pd.DataFrame({"x": ["ABC", None]})
        out = LowerCaseRunner().execute(df.copy(), "x", {}, ["y"])
        assert out["y"].tolist() == ["abc", None]

    def test_digits_null_stays_null(self):
        from app.shared.domain.transforms.digits import DigitsRunner

        df = pd.DataFrame({"x": ["ab12", None]})
        out = DigitsRunner().execute(df.copy(), "x", {}, ["y"])
        assert out["y"].tolist()[0] == "a,b,1,2"
        assert out["y"].tolist()[1] is None

    def test_substring_null_stays_null(self):
        from app.shared.domain.transforms.substring import SubstringRunner

        df = pd.DataFrame({"x": ["hello", None]})
        out = SubstringRunner().execute(df.copy(), "x", {"start": 0, "length": 2}, ["y"])
        assert out["y"].tolist() == ["he", None]

    def test_evaluate_condition_null_never_matches(self):
        from app.shared.domain.transforms.base import evaluate_condition

        df = pd.DataFrame({"x": [np.nan, None, "b"]})
        # 空值行不得因字符串化 "nan" 而命中 eq/contains
        assert evaluate_condition(df, {"column": "x", "op": "eq", "value": "nan"}).tolist() == [False, False, False]
        assert evaluate_condition(df, {"column": "x", "op": "contains", "value": "an"}).tolist() == [
            False,
            False,
            False,
        ]
        # ne 同理：NULL != x 不算匹配（SQL 语义）；"b" 行 ne "b" 也为 False
        assert evaluate_condition(df, {"column": "x", "op": "ne", "value": "b"}).tolist() == [False, False, False]

    def test_regex_extract_null_stays_null(self):
        from app.shared.domain.transforms.regex_extract import RegexExtractRunner

        df = pd.DataFrame({"x": ["a12b", None]})
        out = RegexExtractRunner().execute(df.copy(), "x", {"pattern": r"(\d)(\d)"}, ["g1", "g2"])
        assert out["g1"].tolist() == ["1", None]


# ============================================================
# D17: data_engine JSON 列空值填充
# ============================================================


class TestDataEngineFillnaDict:
    def test_null_json_cell_expands_to_null_children(self):
        from app.shared.domain.data_engine import _fillna_dict

        col = pd.Series([{"a": 1, "b": 2}, None])
        filled = _fillna_dict(col)
        normalized = pd.json_normalize(filled.tolist())
        assert normalized["a"].iloc[0] == 1
        assert pd.isna(normalized["a"].iloc[1])
        assert normalized["b"].iloc[0] == 2
        assert pd.isna(normalized["b"].iloc[1])


# ============================================================
# N1: composite builder 子约束非法 → 构建失败（fail-closed）
# ============================================================


class TestCompositeBuilderFailClosed:
    def _build_input(self, const_id: str, params: dict):
        from app.shared.core.project.constraint.builders.base import BuilderInput
        from app.shared.core.project.constraint.types import ConstraintFile

        const = ConstraintFile(
            version=2,
            id=const_id,
            type="Composite",
            enabled=True,
            refs={"table_id": "t"},
            params=params,
        )
        return BuilderInput(
            const=const,
            refs={"table_id": "t"},
            params=params,
            column_name_by_table_id={"t": {}},
            schema_files={},
            create_child=lambda f, s: (None, None),
        )

    def test_invalid_sub_constraint_returns_error(self):
        from app.shared.core.project.constraint.builders.composite import build_composite

        params = {"logic": "any", "sub_constraints": [{"type": "Range", "column": "x"}]}
        kwargs, error = build_composite(self._build_input("bad_composite", params))
        assert kwargs == {}
        assert error is not None
        assert "子约束配置非法" in error

    def test_nested_composite_rejected_with_error(self):
        from app.shared.core.project.constraint.builders.composite import build_composite

        params = {
            "logic": "all",
            "sub_constraints": [{"id": "nested", "type": "Composite", "refs": {}, "params": {}}],
        }
        kwargs, error = build_composite(self._build_input("outer", params))
        assert kwargs == {}
        assert error is not None
        assert "嵌套" in error


# ============================================================
# N2: ProjectInfo.description roundtrip
# ============================================================


class TestProjectInfoDescription:
    def test_description_survives_model_validate_and_dump(self):
        import yaml

        from app.shared.core.project.manifest.types import ProjectManifest

        raw = yaml.safe_load("version: 2\nproject:\n  id: p1\n  name: 项目\n  description: 项目描述文本\n")
        m = ProjectManifest.model_validate(raw)
        assert m.project.description == "项目描述文本"
        dumped = m.model_dump(exclude_none=True)
        assert dumped["project"]["description"] == "项目描述文本"


# ============================================================
# D1/D2: get_excel_sheet_names 引擎自适应 + 句柄关闭
# ============================================================


class TestGetExcelSheetNames:
    def test_xlsx_engine_and_handle_closed(self, tmp_path):
        xlsx = tmp_path / "probe.xlsx"
        pd.DataFrame({"a": [1]}).to_excel(xlsx, index=False, sheet_name="MySheet")
        from app.shared.core.data_source.loaders.excel_loader import (
            get_excel_sheet_names,
            resolve_excel_engine,
        )

        assert resolve_excel_engine(str(xlsx)) == "openpyxl"
        names = get_excel_sheet_names(str(xlsx))
        assert names == ["MySheet"]
        # D2：助手返回后句柄必须已关闭——Windows 上验证为可立即删除
        os.remove(xlsx)
        assert not xlsx.exists()

    def test_xls_routes_to_xlrd_engine(self):
        from app.shared.core.data_source.loaders.excel_loader import resolve_excel_engine

        assert resolve_excel_engine("data/old_file.xls") == "xlrd"

    def test_unknown_extension_defaults_openpyxl(self):
        from app.shared.core.data_source.loaders.excel_loader import resolve_excel_engine

        assert resolve_excel_engine("no_ext") == "openpyxl"
