"""qa_simple golden 校验脚本。

跑 qa_simple 数据校验，断言产出「期望的那一组错误」而非要求 exit 0。
供 CI smoke 使用：校验器一旦漏报/误报或契约破坏，本脚本立即非零退出。

用法：
    python -m scripts.qa_simple_golden_check
退出码：
    0 = qa_simple 产出符合 golden 基线
    1 = 不符合（缺签名 / 崩溃 / 计数异常）
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# 默认指向仓库根的 qa_simple
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_ROOT.parent
QA_SIMPLE_ROOT = _REPO_ROOT / "qa_test" / "qa_simple"
QA_SIMPLE_MANIFEST = QA_SIMPLE_ROOT / "project.precis.yaml"
QA_SIMPLE_DATA_DIR = QA_SIMPLE_ROOT / "data"

# 期望的错误签名（不要求精确匹配 message，只匹配稳定的结构字段）
EXPECTED_ERROR_TYPES = {"MissingColumn", "ConstraintConfigError", "ForeignKeyViolation"}
EXPECTED_FK_VIOLATIONS = {
    # (table, column, value) — inventory 的 2 个 ghost FK
    ("inventory", "item_id", "I001"),
    ("inventory", "item_id", "I002"),
}
EXPECTED_LOADING_REF_TABLES = {"ghost_table"}  # orders_fk_ghost 的目标表

ERROR_COUNT_MIN = 10
ERROR_COUNT_MAX = 25


@dataclass
class CheckResult:
    passed: bool
    failures: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    loading_errors: list[dict] = field(default_factory=list)


@dataclass
class GoldenAssertion:
    manifest_path: str
    data_dir: str

    @staticmethod
    def _assert_signatures(errors: list[dict], loading_errors: list[dict]) -> bool:
        """断言 errors/loading_errors 含期望签名。返回是否全部满足。"""
        ok = True
        # 1. 期望的错误类型齐全
        types = {e.get("error_type") for e in errors}
        if not EXPECTED_ERROR_TYPES.issubset(types):
            ok = False
        # 2. 期望的 FK 违规值
        fk_seen = {
            (e.get("table"), e.get("column"), e.get("value"))
            for e in errors
            if e.get("error_type") == "ForeignKeyViolation"
        }
        if not EXPECTED_FK_VIOLATIONS.issubset(fk_seen):
            ok = False
        # 3. 期望的 loading 阶段引用完整性错误（ghost_table）
        ref_msgs = " ".join(
            le.get("message", "") for le in loading_errors if le.get("error_type") == "ReferenceIntegrityError"
        )
        if not all(t in ref_msgs for t in EXPECTED_LOADING_REF_TABLES):
            ok = False
        return ok


def _execute_validation(manifest_path: str, data_dir: str) -> dict:
    """调用 ValidationExecutor 跑校验，返回结构化结果 dict。"""
    from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

    executor = ValidationExecutor(manifest_path)
    options = ValidationOptions(timeout_seconds=30, allow_unsafe_eval=True)
    return executor.execute(data_dir, options)


def run_check(assertion: GoldenAssertion) -> CheckResult:
    """执行 golden 校验，返回 CheckResult。"""
    result = CheckResult(passed=True)

    try:
        raw = _execute_validation(assertion.manifest_path, assertion.data_dir)
    except Exception as e:  # noqa: BLE001
        result.passed = False
        result.failures.append(f"校验过程崩溃: {e}")
        return result

    errors = raw.get("errors", [])
    loading_errors = raw.get("loading_errors", [])
    result.errors = errors
    result.loading_errors = loading_errors

    # 断言 1：不崩溃（已通过，因为没抛异常）

    # 断言 2：签名齐全
    if not GoldenAssertion._assert_signatures(errors, loading_errors):
        result.passed = False
        result.failures.append(
            "期望的错误签名不齐全（MissingColumn/ConstraintConfigError/"
            "ForeignKeyViolation、inventory FK、ghost_table 引用）"
        )

    # 断言 3：SchemaSourceDuplicate 警告存在
    has_dup = any(le.get("error_type") == "SchemaSourceDuplicate" for le in loading_errors)
    if not has_dup:
        result.passed = False
        result.failures.append("未检测到 SchemaSourceDuplicate 警告")

    # 断言 4：错误总数在区间
    n = len(errors)
    if not (ERROR_COUNT_MIN <= n <= ERROR_COUNT_MAX):
        result.passed = False
        result.failures.append(f"errors 数 {n} 超出期望区间 [{ERROR_COUNT_MIN}, {ERROR_COUNT_MAX}]")

    return result


def main() -> int:
    manifest = os.environ.get("QA_SIMPLE_MANIFEST", str(QA_SIMPLE_MANIFEST))
    data_dir = os.environ.get("QA_SIMPLE_DATA_DIR", str(QA_SIMPLE_DATA_DIR))
    assertion = GoldenAssertion(manifest_path=manifest, data_dir=data_dir)
    result = run_check(assertion)

    if result.passed:
        print(f"✓ qa_simple golden 校验通过（{len(result.errors)} 个错误符合预期）")
        return 0
    for f in result.failures:
        print(f"✗ {f}")
    print(f"  实际 errors 数: {len(result.errors)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
