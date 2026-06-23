"""qa_simple golden 校验脚本的单元测试。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 让测试能 import scripts 下的模块
BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from scripts.qa_simple_golden_check import (  # noqa: E402
    QA_SIMPLE_DATA_DIR,
    QA_SIMPLE_MANIFEST,
    GoldenAssertion,
    run_check,
)


@pytest.fixture
def assertions() -> GoldenAssertion:
    return GoldenAssertion(
        manifest_path=str(QA_SIMPLE_MANIFEST),
        data_dir=str(QA_SIMPLE_DATA_DIR),
    )


def test_run_check_returns_ok_for_qa_simple(assertions: GoldenAssertion):
    """对真实 qa_simple 跑 golden 校验，应通过（exit 0）。"""
    result = run_check(assertions)
    assert result.passed is True, "; ".join(result.failures)


def test_run_check_captures_expected_error_types(assertions: GoldenAssertion):
    """qa_simple 必须产出期望的三类错误。"""
    result = run_check(assertions)
    types = {e["error_type"] for e in result.errors}
    assert "MissingColumn" in types
    assert "ConstraintConfigError" in types
    assert "ForeignKeyViolation" in types


def test_run_check_captures_ghost_fk(assertions: GoldenAssertion):
    """ghost FK（orders_fk_ghost → ghost_table）必须作为 loading_error 出现。"""
    result = run_check(assertions)
    ghost = [
        le
        for le in result.loading_errors
        if le.get("error_type") == "ReferenceIntegrityError" and "ghost_table" in le.get("message", "")
    ]
    assert ghost, "未检测到 orders_fk_ghost → ghost_table 的引用完整性错误"


def test_signature_assertion_rejects_empty_errors():
    """当 errors 不含期望签名时，断言函数应返回 False。"""
    assert GoldenAssertion._assert_signatures([], []) is False


def test_signature_assertion_accepts_full_signatures(assertions: GoldenAssertion):
    """对真实 qa_simple 的 errors，断言函数应返回 True。"""
    result = run_check(assertions)
    assert GoldenAssertion._assert_signatures(result.errors, result.loading_errors) is True


def test_error_count_within_expected_range(assertions: GoldenAssertion):
    """errors 总数应在容忍区间内（容忍小幅波动）。"""
    result = run_check(assertions)
    assert 10 <= len(result.errors) <= 25, f"errors 数 {len(result.errors)} 超出区间"
