"""黄金集校验脚本。

遍历 qa_test/golden/*/，对每个案例跑 ValidationExecutor 并与 expected.json 对比。

用法:
    python -m scripts.golden_check              # 校验全部案例
    python -m scripts.golden_check --case 01_not_null  # 校验单例
    python -m scripts.golden_check --update 01_not_null # 用实际输出更新 expected.json（首次冻结）
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_ROOT.parent
GOLDEN_ROOT = _REPO_ROOT / "qa_test" / "golden"


@dataclass
class CaseResult:
    """单个黄金案例的校验结果。"""

    case_id: str
    passed: bool
    failures: list[str] = field(default_factory=list)
    actual_error_count: int = 0


def discover_cases() -> list[Path]:
    """发现所有黄金案例目录（含 expected.json 的子目录）。"""
    if not GOLDEN_ROOT.is_dir():
        return []
    return sorted(p for p in GOLDEN_ROOT.iterdir() if p.is_dir() and (p / "expected.json").exists())


def load_expected(case_dir: Path) -> dict:
    """读取案例的 expected.json。"""
    with open(case_dir / "expected.json", encoding="utf-8") as f:
        return json.load(f)


def _execute_validation(manifest_path: str, data_dir: str) -> dict:
    """运行 ValidationExecutor 并返回原始结果字典。

    复用 qa_simple_golden_check.py 的调用模式。
    """
    from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

    executor = ValidationExecutor(manifest_path)
    options = ValidationOptions(timeout_seconds=30, allow_unsafe_eval=True)
    return executor.execute(data_dir, options)


def _extract_violations(errors: list[dict]) -> list[dict]:
    """从 errors 提取 (table, column, type) 三元组（字段缺失时用空串填充）。"""
    out = []
    for err in errors:
        out.append(
            {
                "table": err.get("table_name") or err.get("table") or "",
                "column": err.get("column_name") or err.get("column") or "",
                "type": err.get("error_type") or err.get("type") or "",
            }
        )
    return out


def _extract_error_types(errors: list[dict], loading_errors: list[dict]) -> tuple[set[str], set[str]]:
    """返回 (错误类型集合, 加载错误类型集合)。"""
    err_types = {(e.get("error_type") or e.get("type") or "") for e in errors}
    load_types = {(e.get("error_type") or e.get("type") or "") for e in loading_errors}
    return err_types, load_types


def run_case(case_dir: Path) -> CaseResult:
    """对单个案例执行校验并对比 expected.json。

    Returns:
        CaseResult，passed=True 表示全部断言通过
    """
    case_id = case_dir.name
    expected = load_expected(case_dir)
    manifest = str(case_dir / "project.precis.yaml")
    data_dir = str(case_dir / "data")

    result = CaseResult(case_id=case_id, passed=True)

    # 1. 执行校验（expect_success=false 时捕获异常）
    try:
        raw = _execute_validation(manifest, data_dir)
    except Exception as e:
        if expected.get("expect_success", True):
            result.passed = False
            result.failures.append(f"校验抛异常但期望成功: {type(e).__name__}: {e}")
        return result

    if not expected.get("expect_success", True):
        result.passed = False
        result.failures.append("校验未抛异常但期望失败")
        return result

    errors = raw.get("errors", []) or []
    loading_errors = raw.get("loading_errors", []) or []
    result.actual_error_count = len(errors)

    # 2. 错误数量区间断言
    count_min = expected.get("expected_error_count_min", 0)
    count_max = expected.get("expected_error_count_max", 10**9)
    if not (count_min <= len(errors) <= count_max):
        result.passed = False
        result.failures.append(f"错误数 {len(errors)} 不在期望区间 [{count_min}, {count_max}]")

    # 3. 错误类型子集断言（期望的类型必须都出现）
    actual_err_types, actual_load_types = _extract_error_types(errors, loading_errors)
    expected_err_types = set(expected.get("expected_error_types", []))
    missing_err = expected_err_types - actual_err_types
    if missing_err:
        result.passed = False
        result.failures.append(f"缺失错误类型: {missing_err}（实际: {actual_err_types}）")

    expected_load_types = set(expected.get("expected_loading_error_types", []))
    missing_load = expected_load_types - actual_load_types
    if missing_load:
        result.passed = False
        result.failures.append(f"缺失加载错误类型: {missing_load}（实际: {actual_load_types}）")

    # 4. 具体违规三元组子集断言
    actual_violations = _extract_violations(errors)
    expected_violations = expected.get("expected_violations", [])
    for ev in expected_violations:
        ev_normalized = {
            "table": ev.get("table", ""),
            "column": ev.get("column", ""),
            "type": ev.get("type", ""),
        }
        if ev_normalized not in actual_violations:
            result.passed = False
            result.failures.append(f"缺失违规: {ev_normalized}（实际 {len(actual_violations)} 条）")

    return result


def _freeze_expected(case_dir: Path) -> None:
    """跑一次校验，把实际错误签名写回 expected.json（首次冻结用）。"""
    manifest = str(case_dir / "project.precis.yaml")
    data_dir = str(case_dir / "data")
    raw = _execute_validation(manifest, data_dir)
    errors = raw.get("errors", []) or []
    loading_errors = raw.get("loading_errors", []) or []
    err_types, load_types = _extract_error_types(errors, loading_errors)

    frozen = {
        "case_id": case_dir.name,
        "description": f"自动冻结于 {case_dir.name}",
        "expect_success": True,
        "expected_error_count_min": len(errors),
        "expected_error_count_max": len(errors),
        "expected_error_types": sorted(err_types),
        "expected_violations": _extract_violations(errors),
        "expected_loading_error_types": sorted(load_types),
    }
    with open(case_dir / "expected.json", "w", encoding="utf-8") as f:
        json.dump(frozen, f, ensure_ascii=False, indent=2)
    print(f"已冻结 {case_dir.name}: {len(errors)} 个错误")


def main() -> int:
    """入口：解析参数、遍历案例、汇总结果、返回退出码。"""
    parser = argparse.ArgumentParser(description="黄金集校验")
    parser.add_argument("--case", help="只校验指定案例 ID")
    parser.add_argument("--update", help="用实际输出更新指定案例的 expected.json")
    args = parser.parse_args()

    if args.update:
        target = GOLDEN_ROOT / args.update
        if not target.is_dir():
            print(f"案例目录不存在: {target}")
            return 1
        _freeze_expected(target)
        return 0

    cases = discover_cases()
    if args.case:
        cases = [p for p in cases if p.name == args.case]
    if not cases:
        print(f"未找到黄金案例（查找路径: {GOLDEN_ROOT}）")
        return 1

    all_passed = True
    for case_dir in cases:
        r = run_case(case_dir)
        if r.passed:
            print(f"✓ {r.case_id}（{r.actual_error_count} 个错误）")
        else:
            all_passed = False
            print(f"✗ {r.case_id}")
            for f in r.failures:
                print(f"    - {f}")

    if all_passed:
        print(f"\n✓ 全部 {len(cases)} 个黄金案例通过")
        return 0
    print("\n✗ 存在失败案例")
    return 1


if __name__ == "__main__":
    sys.exit(main())
