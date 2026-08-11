"""C02 verify — 验证导航理解答案 + 跨块重复修复。"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import re
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import(mod_name):
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m == mod_name:
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module(mod_name)
    except BaseException:
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks = []

    # === 导航理解题 ===
    ans_path = os.path.join(WORKSPACE, "answers.py")
    ans_src = (
        open(ans_path, encoding="utf-8").read() if os.path.exists(ans_path) else ""
    )
    checks.append(("answers.py 存在", os.path.exists(ans_path)))
    # Q1: 默认分块阈值（MB 数值）—— 不在描述里写出具体值，防泄漏
    q1_match = re.search(r"#\s*Q1[:：]\s*(\d+)", ans_src)
    checks.append(
        (
            "Q1 答案匹配（默认分块阈值 MB）",
            q1_match is not None and q1_match.group(1) == "500",
        )
    )
    # Q2: 分块决策的方法名 —— 不在描述里写出具体方法名，防泄漏
    q2_match = re.search(r"#\s*Q2[:：]\s*(\w+)", ans_src)
    checks.append(
        (
            "Q2 答案匹配（MemoryMonitor 分块决策方法名）",
            q2_match is not None and q2_match.group(1) == "should_chunk",
        )
    )

    # === 修复正确性 ===
    cc, cheated1 = _safe_import("chunked_checker")
    _mm, cheated2 = _safe_import("memory_monitor")
    cheated = cheated1 or cheated2
    checks.append(("chunked_checker 可导入", cc is not None))

    fn = getattr(cc, "find_cross_chunk_duplicates", None) if cc else None
    checks.append(("find_cross_chunk_duplicates 存在", fn is not None))

    def _run(chunks, col):
        if fn is None:
            return None
        try:
            return sorted(fn(chunks, col))
        except Exception as e:
            return f"ERR: {e}"

    # 单 chunk 内重复仍检测
    r1 = _run([pd.DataFrame({"id": ["a", "a", "b"]})], "id")
    checks.append(("单 chunk 内重复仍检测（(0,0),(0,1)）", r1 == [(0, 0), (0, 1)]))

    # 跨块重复（关键）
    r2 = _run(
        [
            pd.DataFrame({"id": ["a", "b"]}),
            pd.DataFrame({"id": ["a", "c"]}),
        ],
        "id",
    )
    # 'a' 在 chunk0 行0 和 chunk1 行0
    checks.append(("跨块重复检测（(0,0),(1,0)）", r2 == [(0, 0), (1, 0)]))

    # 多个跨块
    r3 = _run(
        [
            pd.DataFrame({"id": ["x", "y"]}),
            pd.DataFrame({"id": ["x", "y"]}),
        ],
        "id",
    )
    # x: (0,0),(1,0)  y: (0,1),(1,1)
    checks.append(("多值跨块重复全检", r3 == [(0, 0), (0, 1), (1, 0), (1, 1)]))

    # 无重复
    r4 = _run([pd.DataFrame({"id": ["a"]}), pd.DataFrame({"id": ["b"]})], "id")
    checks.append(("无重复 → 空列表", r4 == []))

    # 列缺失不崩
    r5 = _run([pd.DataFrame({"other": [1]})], "id")
    checks.append(("列不存在不崩", r5 == [] or (isinstance(r5, list) and len(r5) == 0)))

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
