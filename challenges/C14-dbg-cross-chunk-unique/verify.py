"""C14 verify — 验证跨块重复检测修复。"""

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
    buf = io.StringIO()
    fn = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m == "check_unique":
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module("check_unique")
            fn = getattr(mod, "check_unique", None)
    except BaseException:
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return fn, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []
    fn, cheated = _safe_import()
    checks.append(("check_unique 可导入", fn is not None))

    def _run(chunks, col):
        if fn is None:
            return None
        try:
            return sorted(fn(chunks, col))
        except Exception as e:
            return f"ERR: {e}"

    # 检查 1: 单 chunk 内的重复仍能检测（不回归）
    r1 = _run([pd.DataFrame({"id": ["a", "a", "b"]})], "id")
    checks.append(("单 chunk 内重复仍检测（行 0,1）", r1 == [0, 1]))

    # 检查 2 (关键): 跨块重复 —— 'a' 在 chunk0 行0，chunk1 行0
    r2 = _run(
        [
            pd.DataFrame({"id": ["a", "b"]}),
            pd.DataFrame({"id": ["a", "c"]}),
        ],
        "id",
    )
    # 全局行号：chunk0 的 'a' 是行0，chunk1 的 'a' 是行 2（chunk0 有2行）
    checks.append(("跨块重复检测（'a' 在全局行 0 和 2）", r2 == [0, 2]))

    # 检查 3: 多个跨块重复
    r3 = _run(
        [
            pd.DataFrame({"id": ["a", "b", "a"]}),
            pd.DataFrame({"id": ["c", "b"]}),
        ],
        "id",
    )
    # 'a' 在行0,2；'b' 在行1,4。全部应报
    checks.append(("多个跨块重复全检（行 0,1,2,4）", r3 == [0, 1, 2, 4]))

    # 检查 4: 无重复 → 空列表
    r4 = _run(
        [
            pd.DataFrame({"id": ["a", "b"]}),
            pd.DataFrame({"id": ["c", "d"]}),
        ],
        "id",
    )
    checks.append(("无重复 → 空列表", r4 == []))

    # 检查 5: 三个 chunk 的跨块重复
    r5 = _run(
        [
            pd.DataFrame({"id": ["x"]}),
            pd.DataFrame({"id": ["y"]}),
            pd.DataFrame({"id": ["x"]}),
        ],
        "id",
    )
    # 'x' 在行0（chunk0）和行2（chunk2，前面共2行）
    checks.append(("三块跨块重复（'x' 在行 0 和 2）", r5 == [0, 2]))

    # 检查 6: 列不存在不崩溃
    r6 = _run([pd.DataFrame({"other": [1]})], "id")
    checks.append(
        (
            "列不存在不崩溃（返回空列表）",
            r6 == [] or (isinstance(r6, list) and len(r6) == 0),
        )
    )

    # 检查 7 (关键): 中间 chunk 缺列仍占行号偏移
    # chunk1 无 id 列，但它的 2 行仍占全局行号空间：
    # chunk0 的 'a' 在全局行 0；chunk2 的 'a' 在全局行 2(chunk0) + 2(chunk1) + 0 = 4
    r7 = _run(
        [
            pd.DataFrame({"id": ["a", "b"]}),
            pd.DataFrame({"x": [1, 2]}),
            pd.DataFrame({"id": ["a"]}),
        ],
        "id",
    )
    checks.append(("中间 chunk 缺列仍占行号偏移（'a' 在全局行 0 和 4）", r7 == [0, 4]))

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
