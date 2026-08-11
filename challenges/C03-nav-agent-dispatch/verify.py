"""C03 verify — 导航理解答案 + export_csv 注册修复。"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import(mod_name):
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m in ("planner", "executor", "tool_registry"):
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module(mod_name)
    except BaseException:
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    # === 导航理解 ===
    ans_path = os.path.join(WORKSPACE, "answers.py")
    ans_src = (
        open(ans_path, encoding="utf-8").read() if os.path.exists(ans_path) else ""
    )
    checks.append(("answers.py 存在", os.path.exists(ans_path)))
    q1 = re.search(r"#\s*Q1[:：]\s*(\w+)", ans_src)
    checks.append(
        (
            "Q1 = planner（决定调用顺序的模块）",
            q1 is not None and q1.group(1) == "planner",
        )
    )
    q2 = re.search(r"#\s*Q2[:：]\s*(.+)", ans_src)
    q2_ok = q2 is not None and any(
        k in q2.group(1).lower()
        for k in ("成功", "执行成功", "succeed", "called", "实际执行")
    )
    checks.append(("Q2 描述 executed 跟踪成功执行的工具数", q2_ok))
    q3 = re.search(r"#\s*Q3[:：]\s*(.+)", ans_src)
    q3_ok = q3 is not None and any(
        k in q3.group(1)
        for k in ("跳过", "skip", "记录错误", "error", "continue", "继续", "不中断")
    )
    checks.append(("Q3 描述未注册工具被跳过/记错", q3_ok))

    # === 修复 ===
    tr, c1 = _safe_import("tool_registry")
    ex, c2 = _safe_import("executor")
    pl, c3 = _safe_import("planner")
    cheated = c1 or c2 or c3
    checks.append(("tool_registry 可导入", tr is not None))

    checks.append(
        (
            "'export_csv' 已注册",
            tr is not None and "export_csv" in (tr.list_tools() if tr else []),
        )
    )

    def _check_export_run():
        if tr is None or ex is None or pl is None:
            return False
        try:
            steps = pl.plan("export")
            result = ex.execute(steps)
            return (
                result["executed"] == 2
                and len(result["errors"]) == 0
                and len(result["results"]) == 2
            )
        except Exception:
            return False

    checks.append(("execute(plan('export')) 无错且执行 2 步", _check_export_run()))

    # validate_and_report 仍正常（3 步全过）
    def _check_validate_run():
        if ex is None or pl is None:
            return False
        try:
            result = ex.execute(pl.plan("validate_and_report"))
            return result["executed"] == 3 and len(result["errors"]) == 0
        except Exception:
            return False

    checks.append(("validate_and_report 流程仍正常（3 步全过）", _check_validate_run()))

    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊")
        return 1

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
