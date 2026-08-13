"""
L06 注入测试 — 校验管线"提取异常静默吞掉"缺陷的行为测试。

本文件由 challenges/L06-dbg-root-cause/verify.py 在评分期间临时复制到
backend/tests/unit/，跑完即删。禁止修改本文件。

四个用例对应 verify.py 的四个评分项：
  - l06_r1（3 分）：非法正则 → 格式阶段提取错误上报，且信息包含原始异常内容
  - l06_r2（1 分）：提取异常上报的同时不中断其余表/约束校验
  - l06_e1（1 分）：好/坏提取列共存——好列照常产出、坏列带原始异常上报
  - l06_e2（1 分）：真实触发路径（重复列名 → 提取抛 AttributeError）不再静默
"""

from __future__ import annotations

import re

import pandas as pd

from app.shared.domain.constraints import NotNullConstraint
from app.shared.domain.data_types import StringType
from app.shared.domain.data_types_parts.extracted import ExtractedType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.domain.expression_system import ExpressionPattern, ExpressionRegistry
from app.shared.services.validation.engine import validate_full_dataset

BAD_PATTERN = "(?P<username>abc"  # 非法正则：未闭合分组 → re.compile 必抛 re.error


class _BrokenExprType:
    """duck-typed Expr 源列类型：pattern 非法，提取阶段 re.compile 必然抛异常。

    （提取模块对源列类型按 hasattr 协议消费——name/pattern/registry——
    与真实 Expr 类型的消费路径一致。）"""

    name = "Expr"
    pattern = BAD_PATTERN

    def process_column(self, series, col_name, nullable=True):
        return series.astype(str), []


class _DupSafeExprType:
    """duck-typed Expr 源列类型：绑定注册表（含命名捕获组 username）。

    阶段一（process_column）容忍重复列名（取第一列继续），从而让故障在**提取阶段**
    （raw_df[source_column] 因重复列名返回 DataFrame → .str 抛 AttributeError）
    而不是阶段一触发——这正是真实管线的触发路径。"""

    name = "Expr"

    def __init__(self, registry):
        self.registry = registry

    def process_column(self, series, col_name, nullable=True):
        if isinstance(series, pd.DataFrame):
            series = series.iloc[:, 0]
        return series.astype(str), []


def _make_registry() -> ExpressionRegistry:
    registry = ExpressionRegistry()
    registry.register(
        ExpressionPattern(
            name="email_local",
            regex=re.compile(r"(?P<username>[^@]+)@(?P<domain>.+)"),
            parser_func=lambda groups: groups,
        )
    )
    return registry


def _expected_compile_error() -> str:
    try:
        re.compile(BAD_PATTERN)
    except re.error as e:  # noqa: PERF203
        return str(e)
    raise AssertionError(f"预期 {BAD_PATTERN!r} 编译失败，但它居然成功了")


def _schema_with_extracted(source_type) -> DataSetSchema:
    return DataSetSchema(
        tables={
            "t1": TableSchema(
                id="t1",
                name="T1",
                columns=[
                    ColumnSchema(name="email", id="email", data_type=source_type),
                    ColumnSchema(
                        name="username",
                        id="username",
                        data_type=ExtractedType(
                            source_column="email", extract_key="username"
                        ),
                    ),
                ],
            )
        },
        constraints=[],
    )


def _extraction_errors(errors: list[dict], column: str) -> list[dict]:
    return [
        e
        for e in errors
        if e.get("check_type") == "ExtractedColumnValidation"
        and e.get("column") == column
    ]


def test_l06_r1_invalid_regex_reported_with_exception_detail():
    """非法正则导致提取异常 → 必须以格式阶段错误上报，且信息包含原始异常内容。"""
    schema = _schema_with_extracted(_BrokenExprType())
    raw = {"t1": pd.DataFrame({"email": ["alice@example.com"]})}

    _, errors, _ = validate_full_dataset(raw, schema)

    expected_exc = _expected_compile_error()
    extraction_errors = _extraction_errors(errors, "username")
    assert extraction_errors, "提取异常必须上报为验证错误（现被静默吞掉）"
    assert expected_exc in extraction_errors[0].get("message", ""), (
        "错误信息必须包含原始异常内容，便于用户定位配置问题"
    )
    assert extraction_errors[0].get("stage") == "format"


def test_l06_r2_reported_without_aborting_other_tables():
    """提取异常必须上报，同时不得中断其余表的解析与约束校验。"""
    schema = _schema_with_extracted(_BrokenExprType())
    schema.tables["t2"] = TableSchema(
        id="t2",
        name="T2",
        columns=[ColumnSchema(name="col_b", id="col_b", data_type=StringType())],
    )
    schema.constraints = [NotNullConstraint(table="t2", column="col_b")]
    raw = {
        "t1": pd.DataFrame({"email": ["alice@example.com"]}),
        "t2": pd.DataFrame({"col_b": [None]}),
    }

    parsed, errors, _ = validate_full_dataset(raw, schema)

    assert "t2" in parsed, "其余表必须照常解析"
    assert any(
        e.get("table") == "t2" and e.get("error_type") == "NotNullViolation"
        for e in errors
    ), "其余表的约束必须照常执行"
    assert _extraction_errors(errors, "username"), "提取异常必须同时上报"


def test_l06_e1_good_and_bad_extracted_columns_coexist():
    """一好一坏两个提取列：好列照常产出正确值，坏列带原始异常上报。"""
    schema = DataSetSchema(
        tables={
            "t1": TableSchema(
                id="t1",
                name="T1",
                columns=[
                    ColumnSchema(
                        name="email",
                        id="email",
                        data_type=_DupSafeExprType(_make_registry()),
                    ),
                    ColumnSchema(
                        name="username",
                        id="username",
                        data_type=ExtractedType(
                            source_column="email", extract_key="username"
                        ),
                    ),
                    ColumnSchema(name="phone", id="phone", data_type=_BrokenExprType()),
                    ColumnSchema(
                        name="phone_domain",
                        id="phone_domain",
                        data_type=ExtractedType(
                            source_column="phone", extract_key="domain"
                        ),
                    ),
                ],
            )
        },
        constraints=[],
    )
    raw = {
        "t1": pd.DataFrame({"email": ["alice@example.com"], "phone": ["13800138000"]})
    }

    parsed, errors, _ = validate_full_dataset(raw, schema)

    # 好列：username 照常提取
    assert "username" in parsed["t1"].columns, "好的提取列必须照常产出"
    assert parsed["t1"]["username"].iloc[0] == "alice"

    # 坏列：phone_domain 带原始异常上报
    expected_exc = _expected_compile_error()
    bad_errors = _extraction_errors(errors, "phone_domain")
    assert bad_errors, "坏的提取列必须上报"
    assert expected_exc in bad_errors[0].get("message", ""), (
        "坏列错误信息须含原始异常内容"
    )


def test_l06_e2_duplicate_column_trigger_reported():
    """真实触发路径：源数据列名重复 → 提取抛 AttributeError → 不得静默吞掉。"""
    schema = _schema_with_extracted(_DupSafeExprType(_make_registry()))
    # 两列表头都叫 email（导出工具产物，pandas 允许重复列名）
    raw = {
        "t1": pd.DataFrame(
            [["alice@example.com", "bob@example.com"]],
            columns=["email", "email"],
        )
    }

    _, errors, _ = validate_full_dataset(raw, schema)

    extraction_errors = _extraction_errors(errors, "username")
    assert extraction_errors, "重复列名触发的提取异常不得静默吞掉"
