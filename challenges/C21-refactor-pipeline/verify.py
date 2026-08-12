"""C21 verify — 验证 pipeline 重构正确性 + 行为不变。

退出码：0 = PASS，非 0 = FAIL。stdout 首行 PASS/FAIL，后续 `  [✓]/[✗]` 详情。

防作弊：加载 agent 代码时重定向 stdout，扫描 import 期间的 PASS/FAIL/[✓]/[✗] 关键字。
"""

from __future__ import annotations

import ast
import contextlib
import importlib
import io
import os
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)

STAGE_NAMES = (
    "stage_filter_none",
    "stage_convert",
    "stage_range_check",
    "stage_collect",
)


def _safe_import() -> tuple[Any, bool]:
    """安全导入 agent 的 validator 模块，返回 (module, cheated)。"""
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m == "validator":
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module("validator")
    except BaseException:
        # 用 BaseException 避免 agent 的 sys.exit(0) 提前结束 verify
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def _golden(values: list[Any], min_val: int, max_val: int) -> dict[str, Any]:
    """原始命令式实现的输出（黄金参考）。"""
    filtered = [v for v in values if v is not None]
    converted: list[int] = []
    for v in filtered:
        try:
            converted.append(int(v))
        except (ValueError, TypeError):
            converted.append(0)
    valid: list[int] = []
    violations: list[int] = []
    for i, v in enumerate(converted):
        if min_val <= v <= max_val:
            valid.append(v)
        else:
            violations.append(i)
    return {
        "valid": valid,
        "violations": violations,
        "total_input": len(values),
        "total_filtered": len(filtered),
        "total_valid": len(valid),
    }


def _process_def() -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    """ast.parse workspace 的 validator.py，返回顶层 process 函数定义节点。

    用 AST 而非源码子串做"process 是否调用了 stage"的判定——
    注释/字符串里写 stage 名（如 `# 调用了 stage_filter_none ...`）不会产生 ast.Call，
    无法蒙混。
    """
    src_path = os.path.join(WORKSPACE, "validator.py")
    if not os.path.exists(src_path):
        return None
    try:
        tree = ast.parse(open(src_path, encoding="utf-8").read())
    except (SyntaxError, ValueError):
        return None
    for node in tree.body:
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "process"
        ):
            return node
    return None


def _stages_ok(mod: Any) -> bool:
    """4 个 stage 各自行为正确（独立调用）。"""
    if mod is None:
        return False
    try:
        if mod.stage_filter_none([1, None, 2, None, 3]) != [1, 2, 3]:
            return False
        if mod.stage_convert(["5", "abc", 10]) != [5, 0, 10]:
            return False
        valid, violations = mod.stage_range_check([1, 20, 5, 30], 0, 10)
        if valid != [1, 5] or violations != [1, 3]:
            return False
        result = mod.stage_collect([1, 5], [1, 3], 4, 4)
        if result["total_valid"] != 2 or result["violations"] != [1, 3]:
            return False
        return True
    except Exception:
        return False


def _process_behavior_ok(mod: Any) -> bool:
    """process 行为与原始命令式实现完全一致（对照黄金）。"""
    if mod is None:
        return False
    test_cases: list[tuple[list[Any], int, int]] = [
        ([1, 2, 3, 4, 5], 0, 10),
        ([None, "abc", 5, None, 20], 0, 10),
        ([], 0, 10),
        ([None, None], 0, 10),
        (["1", "2", "3"], 1, 2),
        ([100, -1, 50, 0], 0, 50),
    ]
    try:
        for values, lo, hi in test_cases:
            if mod.process(values, lo, hi) != _golden(values, lo, hi):
                return False
        return True
    except Exception:
        return False


def main() -> int:
    checks: list[tuple[str, bool]] = []

    mod, cheated = _safe_import()
    checks.append(("validator.py 可导入", mod is not None))

    # 4 个 stage 函数存在且可调用
    for name in STAGE_NAMES:
        checks.append(
            (
                f"{name} 函数存在",
                mod is not None and hasattr(mod, name) and callable(getattr(mod, name)),
            )
        )

    # 4 个 stage 各自行为正确
    checks.append(("4 个 stage 各自行为正确", _stages_ok(mod)))

    # process 行为与原始完全一致（6 组测试对照黄金）
    checks.append(
        ("process 行为与原始完全一致（6 组测试对照黄金）", _process_behavior_ok(mod))
    )

    # process 函数体真实调用了 4 个 stage（AST 级检查：存在 func 为对应 Name 的 ast.Call；
    # 注释/字符串里提及 stage 名不算）
    process_def = _process_def()
    called: set[str] = set()
    if process_def is not None:
        for node in ast.walk(process_def):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                called.add(node.func.id)
    for stage in STAGE_NAMES:
        checks.append(
            (f"process 函数体真实调用了 {stage}（AST 级，注释不算）", stage in called)
        )

    # process 函数体不含逐元素 for 循环（命令式循环应已搬进各 stage）
    has_for = process_def is not None and any(
        isinstance(n, (ast.For, ast.AsyncFor)) for n in ast.walk(process_def)
    )
    checks.append(
        (
            "process 函数体不含 for 循环（逐元素循环已搬进各 stage）",
            process_def is not None and not has_for,
        )
    )

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
