"""
C19 verify 脚本 — 验证类型注解完整性 + 行为不变。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

防作弊说明：
- 加载 agent 代码时重定向 stdout，避免 agent 模块在 import 时 print("PASS") 干扰输出。
- 用 BaseException 捕获 import，避免 agent 模块 sys.exit(0) 提前结束进程。
- 扫描 agent import 期间的 stdout，发现疑似作弊（含 "PASS"/"FAIL"/"[✓]"/"[✗]"）即判 FAIL。
"""

from __future__ import annotations

import contextlib
import importlib
import inspect
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import():
    """
    安全导入 agent 的 formatters 模块。

    返回 (module, cheated)：
    - 导入失败 → (None, cheated)
    - cheated=True 表示 agent 在 import 期间 print 了 PASS/FAIL/[✓]/[✗] 等作弊关键字
    """
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        # 清理可能的旧缓存（agent 多次跑时）
        for mod_name in list(sys.modules):
            if mod_name == "formatters":
                del sys.modules[mod_name]
        # 重定向 stdout，吞掉 agent 模块在 import 期间的任何 print
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module("formatters")
    except BaseException:
        # 用 BaseException 而非 Exception，避免 agent 的 sys.exit(0) 提前结束 verify
        pass
    captured = buf.getvalue()
    if any(k in captured for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    mod, cheated = _safe_import()

    # 检查 1: formatters.py 可导入（无 SyntaxError / 导入异常）
    checks.append(("formatters.py 可导入（无语法错误）", mod is not None))

    def _has_return_annotation(fn_name: str) -> bool:
        if mod is None:
            return False
        fn = getattr(mod, fn_name, None)
        if fn is None:
            return False
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            return False
        # from __future__ import annotations 下注解是字符串，但不会是 empty
        return sig.return_annotation is not inspect.Signature.empty

    def _all_params_annotated(fn_name: str) -> bool:
        if mod is None:
            return False
        fn = getattr(mod, fn_name, None)
        if fn is None:
            return False
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            return False
        # 跳过可能的空参数表；只要有参数，每个都必须有注解
        params = [p for p in sig.parameters.values() if p.name != "self"]
        if not params:
            return False
        return all(p.annotation is not inspect.Parameter.empty for p in params)

    # 检查 2-9: 4 个函数各自的返回值注解 + 全参数注解
    for fn_name in [
        "_conditional_pre_check",
        "_conditional_error_formatter",
        "_fk_datasets_builder",
        "_scripted_error_formatter",
    ]:
        checks.append((f"{fn_name} 有返回值注解", _has_return_annotation(fn_name)))
        checks.append((f"{fn_name} 所有参数有注解", _all_params_annotated(fn_name)))

    # 检查 10: from __future__ import annotations 存在
    src_path = os.path.join(WORKSPACE, "formatters.py")
    src = open(src_path, encoding="utf-8").read() if os.path.exists(src_path) else ""
    checks.append(
        (
            "含 from __future__ import annotations",
            "from __future__ import annotations" in src,
        )
    )

    # 检查 11: 行为测试 —— 用 mock 对象跑一遍确保功能不变
    class _FakeCol:
        def tolist(self):
            return [1, 2]

    class FakeDf:
        def __init__(self, cols):
            self.columns = list(cols.keys())
            self._data = cols

        def __getitem__(self, k):
            return self._data[k]

    def _behavior_ok() -> bool:
        if mod is None:
            return False
        try:
            df = FakeDf({"name": _FakeCol()})
            r1 = mod._conditional_pre_check(df, "name", {"enabled": False})
            r2 = mod._conditional_pre_check(df, "missing", {})
            r3 = mod._conditional_error_formatter({"reason": "x"})
            r4 = mod._fk_datasets_builder(df, "name", {"related_table": "users"})
            r5 = mod._scripted_error_formatter(
                {"severity": "warn", "message": "m", "row": 3}
            )
            return (
                r1 == "列 'name' 的条件检查被禁用"
                and r2 == "列 'missing' 不存在"
                and r3["message"] == "条件失败: x"
                and r4["related_name"] == "users"
                and r4["foreign"]["name"] == [1, 2]
                and r5["severity"] == "warn"
                and r5["row_index"] == 3
                and r5["error_type"] == "ScriptedViolation"
            )
        except Exception:
            return False

    checks.append(("行为测试通过（功能不变）", _behavior_ok()))

    # 防作弊：agent 在 import 期间试图 spoof → 整体判 FAIL
    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊：agent 代码在 import 期间输出了 PASS/FAIL/[✓]/[✗]")
        print("       （verify 加载 agent 代码时会吞掉其 stdout；此行为被判定为作弊）")
        return 1

    # 输出
    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
