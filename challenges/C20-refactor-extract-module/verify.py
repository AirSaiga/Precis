"""C20 verify — 验证提取正确性 + 行为不变。

退出码：0 = PASS，非 0 = FAIL。stdout 首行 PASS/FAIL，后续 `  [✓]/[✗]` 详情。

防作弊：加载 agent 代码时重定向 stdout，扫描 import 期间的 PASS/FAIL/[✓]/[✗] 关键字。
"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import(mod_name):
    """安全导入 agent 模块，返回 (module, cheated)。"""
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m in (mod_name, "formatters", "service"):
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module(mod_name)
    except BaseException:
        # 用 BaseException 避免 agent 的 sys.exit(0) 提前结束 verify
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks = []

    fmt, cheated1 = _safe_import("formatters")
    svc, cheated2 = _safe_import("service")
    cheated = cheated1 or cheated2

    # formatters.py 存在且含 4 个公开函数
    checks.append(("formatters.py 可导入", fmt is not None))
    for name in [
        "format_not_null_error",
        "format_unique_error",
        "format_range_error",
        "format_foreign_key_error",
    ]:
        checks.append(
            (f"formatters.{name} 存在", fmt is not None and hasattr(fmt, name))
        )

    # service.py 不再含 _format_ 私有定义（已移走）
    svc_path = os.path.join(WORKSPACE, "service.py")
    svc_src = (
        open(svc_path, encoding="utf-8").read() if os.path.exists(svc_path) else ""
    )
    checks.append(
        (
            "service.py 不再含 def _format_not_null_error 定义",
            "def _format_not_null_error" not in svc_src,
        )
    )
    checks.append(
        (
            "service.py 不再含 def _format_unique_error 定义",
            "def _format_unique_error" not in svc_src,
        )
    )
    checks.append(
        (
            "service.py 不再含 def _format_range_error 定义",
            "def _format_range_error" not in svc_src,
        )
    )
    checks.append(
        (
            "service.py 不再含 def _format_foreign_key_error 定义",
            "def _format_foreign_key_error" not in svc_src,
        )
    )
    checks.append(
        ("service.py import 自 formatters", "from formatters import" in svc_src)
    )

    # 行为不变：UnifiedValidationService 仍工作
    checks.append(
        (
            "service.UnifiedValidationService 可导入",
            svc is not None and hasattr(svc, "UnifiedValidationService"),
        )
    )

    def _behavior_ok():
        if svc is None:
            return False
        try:
            S = svc.UnifiedValidationService()
            r1 = S.validate_not_null("name", [0, 2])
            r2 = S.validate_unique("id", [(1, "dup"), (3, "dup")])
            return (
                len(r1) == 2
                and r1[0]["error_type"] == "NotNullViolation"
                and r1[0]["row_index"] == 0
                and len(r2) == 2
                and r2[0]["error_type"] == "UniqueViolation"
                and r2[1]["value"] == "dup"
            )
        except Exception:
            return False

    checks.append(
        ("行为不变：validate_not_null + validate_unique 正确", _behavior_ok())
    )

    # formatters 函数本身行为正确（独立可用）
    def _fmt_ok():
        if fmt is None:
            return False
        try:
            e1 = fmt.format_range_error("age", 0, 200, 0, 150)
            e2 = fmt.format_foreign_key_error("uid", 1, 99, "users")
            return (
                e1["error_type"] == "RangeViolation"
                and e1["value"] == 200
                and e2["error_type"] == "ForeignKeyViolation"
                and e2["message"].find("users") >= 0
            )
        except Exception:
            return False

    checks.append(
        (
            "formatters 函数独立可用（format_range_error + format_foreign_key_error）",
            _fmt_ok(),
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
