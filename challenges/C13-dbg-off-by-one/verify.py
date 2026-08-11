"""C13 verify — 验证 3 个校验辅助函数的 bug 已修复。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL，后续行为 `  [✓] / [✗] 描述`。

防作弊（加载 agent 代码时）：
- 重定向 stdout，吞掉 validators 模块 import 期间的 print
- 捕获 BaseException，防止 sys.exit(0) 提前结束
- 扫描 import 期间输出，发现 PASS/FAIL/[✓]/[✗] 即判作弊
"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import():
    """安全导入 validators 模块，返回 (mod, cheated)。"""
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m == "validators":
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module("validators")
    except BaseException:
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []
    mod, cheated = _safe_import()
    checks.append(("validators.py 可导入", mod is not None))

    # validate_range：闭区间，边界值合规，越界值返回索引
    def _check_range():
        if mod is None:
            return False
        try:
            fn = mod.validate_range
            # 边界值合规（闭区间 [0, 10]）：0,5,10 合规；15 越界
            r1 = fn([0, 5, 10, 15], 0, 10)
            if r1 != [3]:
                return False
            # 全合规
            r2 = fn([1, 2, 3], 1, 3)
            if r2 != []:
                return False
            # 全越界
            r3 = fn([-1, 11], 0, 10)
            return sorted(r3) == [0, 1]
        except Exception:
            return False

    checks.append(
        ("validate_range 闭区间正确（边界值合规，越界值返回索引）", _check_range())
    )

    # find_first_null：扫描所有元素含最后一个
    def _check_null():
        if mod is None:
            return False
        try:
            fn = mod.find_first_null
            # 最后一个元素是 null（off-by-one 最容易漏检的位置）
            s1 = pd.Series([1.0, 2.0, None])
            if fn(s1) != 2:
                return False
            # 中间 null
            s2 = pd.Series([1.0, None, 3.0])
            if fn(s2) != 1:
                return False
            # 无 null
            s3 = pd.Series([1.0, 2.0, 3.0])
            return fn(s3) is None
        except Exception:
            return False

    checks.append(("find_first_null 能找到最后一个元素的空值", _check_null()))

    # count_violations：处理 None + 正确计数
    def _check_count():
        if mod is None:
            return False
        try:
            fn = mod.count_violations
            # None 不崩
            if fn(None) != 0:
                return False
            # 正常计数（默认 severity="error"）
            errs = [
                {"severity": "error"},
                {"severity": "warn"},
                {"severity": "error"},
            ]
            if fn(errs) != 2:
                return False
            # 不同 severity
            return fn(errs, "warn") == 1
        except Exception:
            return False

    checks.append(("count_violations 处理 None 不崩 + 正确计数", _check_count()))

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
