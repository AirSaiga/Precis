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


def main() -> int:
    """入口：解析参数、遍历案例、汇总结果、返回退出码。"""
    parser = argparse.ArgumentParser(description="黄金集校验")
    parser.add_argument("--case", help="只校验指定案例 ID")
    parser.add_argument("--update", help="用实际输出更新指定案例的 expected.json")
    args = parser.parse_args()

    cases = discover_cases()
    if args.case:
        cases = [p for p in cases if p.name == args.case]
    if not cases:
        print(f"未找到黄金案例（查找路径: {GOLDEN_ROOT}）")
        return 1

    # TODO Task 2: 实现 run_case 与校验逻辑
    print(f"发现 {len(cases)} 个案例（校验逻辑在 Task 2 实现）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
