"""
C08 verify — 验证 EXPORT_REPORT 正确加到 registry.py 和 actions.ts。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

检查分两层：
- registry.py：**真实 import** 后核对 ACTIONS 对象（条目存在 + spec_field/category/read_only
  取值）。纯静态正则会被"注释里写假条目"骗过（`# "EXPORT_REPORT": ActionTypeDef(...)`
  一行注释即可命中所有模式），真实对象核对则不行——注释根本不会进 ACTIONS。
  registry.py 是纯标准库无副作用（seed 只有 dataclass + 字典），可安全 import。
  命名参数写法（ActionTypeDef(type=..., spec_field=..., ...)）与位置参数写法等价，
  真实对象核对天然兼容两种风格。
- actions.ts：静态文本分析（联合类型块、family Set、READ_ONLY/WRITE 分组、codegen 头部）。

防作弊：registry.py import 期间的 stdout 被捕获，输出含 PASS/FAIL/[✓]/[✗] 即判作弊。
"""

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


def _safe_import_registry():
    """真实 import workspace/registry.py，捕获 stdout 防作弊。"""
    buf = io.StringIO()
    mod = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m == "registry":
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module("registry")
    except BaseException:
        mod = None
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    # === registry.py：真实 import 核对 ACTIONS 对象 ===
    reg_mod, cheated = _safe_import_registry()
    actions = getattr(reg_mod, "ACTIONS", None) if reg_mod is not None else None
    entry = actions.get("EXPORT_REPORT") if isinstance(actions, dict) else None

    checks.append(
        (
            "registry.py 可安全导入（真实执行，无作弊输出）",
            reg_mod is not None and not cheated,
        )
    )
    checks.append(
        (
            "ACTIONS 含 EXPORT_REPORT 条目（真实对象）",
            isinstance(actions, dict) and "EXPORT_REPORT" in actions,
        )
    )
    checks.append(
        (
            "EXPORT_REPORT 的 spec_field 正确（真实对象）",
            entry is not None and getattr(entry, "spec_field", None) == "reportSpec",
        )
    )
    checks.append(
        (
            "EXPORT_REPORT 的 category 正确（真实对象）",
            entry is not None and getattr(entry, "category", None) == "validate",
        )
    )
    checks.append(
        (
            "EXPORT_REPORT 的 read_only 正确（真实对象）",
            entry is not None and getattr(entry, "read_only", None) is True,
        )
    )

    # === actions.ts：静态解析 ===
    ts_path = os.path.join(WORKSPACE, "actions.ts")
    ts_src = open(ts_path, encoding="utf-8").read() if os.path.exists(ts_path) else ""

    # 检查 6: ActionType 联合类型块内含 'EXPORT_REPORT'
    # 提取 `ActionType =` 到其后第一个 `export const`（或语句结束的 `;`）之间的
    # 联合类型文本块，只在块内断言——防止只在 READ_ONLY 等 Set 里加字符串蒙混
    # （联合类型是 codegen 平铺所有 actionType 的地方，必须包含新成员）。
    union_match = re.search(r"ActionType\s*=.*?(?=export const|;)", ts_src, re.DOTALL)
    union_block = union_match.group(0) if union_match else ""
    checks.append(
        (
            "ActionType 联合类型块内含 'EXPORT_REPORT'",
            "'EXPORT_REPORT'" in union_block,
        )
    )
    # 检查 7 (双端奇偶): actions.ts 联合类型成员数 == registry.py ACTIONS 条目数。
    # 设计约束（codegen 单一事实源）：actions.ts 是 registry 的忠实投影——
    # 每个 ACTIONS 条目恰好对应联合类型的一个成员，不多不少。
    # 陷阱：agent 只加一端（registry 加了、联合类型没加，或反之），或某一端多加。
    # ACTIONS 计数用真实导入对象的 len()——注释假条目不会混入计数。
    union_members = [
        seg for seg in union_block.split("|") if re.search(r"'[^']+'", seg)
    ]
    real_count = len(actions) if isinstance(actions, dict) else 0
    checks.append(
        (
            "双端奇偶：联合类型成员数 == ACTIONS 条目数（真实对象计数）",
            real_count > 0 and len(union_members) == real_count,
        )
    )
    # 检查 8: EXPORT_REPORT 进入正确的只读/读写分组
    ro_match = re.search(r"READ_ONLY_ACTION_TYPES[^[]*\[([^\]]*)\]", ts_src)
    ro_block = ro_match.group(1) if ro_match else ""
    checks.append(
        (
            "EXPORT_REPORT 进入正确的读写分组",
            "EXPORT_REPORT" in ro_block,
        )
    )
    # 检查 9-12 (关键 ×4): EXPORT_REPORT 不应进入任何 family Set
    for fam in [
        "CONSTRAINT_ACTION_TYPES",
        "SCHEMA_ACTION_TYPES",
        "REGEX_ACTION_TYPES",
        "TRANSFORM_ACTION_TYPES",
    ]:
        fm = re.search(rf"{fam}[^[]*\[([^\]]*)\]", ts_src)
        fblock = fm.group(1) if fm else ""
        checks.append(
            (
                f"{fam} 不含 EXPORT_REPORT",
                "EXPORT_REPORT" not in fblock,
            )
        )
    # 检查 13: EXPORT_REPORT 未进入错误的读写分组
    wm = re.search(r"WRITE_ACTION_TYPES[^[]*\[([^\]]*)\]", ts_src)
    wblock = wm.group(1) if wm else ""
    checks.append(
        (
            "EXPORT_REPORT 未进入错误的读写分组",
            "EXPORT_REPORT" not in wblock,
        )
    )
    # 检查 14: actions.ts 头部仍是 codegen 警告（agent 没把整段头部删掉）
    checks.append(
        (
            "actions.ts 头部仍含 codegen 警告",
            bool(re.search(r"禁止手改|codegen|自动生成", ts_src[:500])),
        )
    )

    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊：registry.py import 期间输出了 PASS/FAIL/[✓]/[✗]")
        return 1

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
