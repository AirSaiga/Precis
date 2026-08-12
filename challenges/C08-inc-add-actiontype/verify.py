"""
C08 verify — 验证 EXPORT_REPORT 正确加到 registry.py 和 actions.ts。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

本题为纯静态文件分析（读源文件 + 正则），不执行 agent 代码：
- verify 读的是 workspace/registry.py 和 workspace/actions.ts 的源文本
- agent 无法用 print("PASS") / sys.exit(0) 伪造通过（verify 根本不 import agent 代码）
- 所有检查项都对照"单一事实源 + codegen 派生规则"做正则匹配
"""

from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")


def main() -> int:
    checks: list[tuple[str, bool]] = []

    # 读 registry.py
    reg_path = os.path.join(WORKSPACE, "registry.py")
    reg_src = (
        open(reg_path, encoding="utf-8").read() if os.path.exists(reg_path) else ""
    )

    # 检查 1: registry.py 含 EXPORT_REPORT 条目（作为 ACTIONS 的 key）
    checks.append(
        (
            "registry.py 含 EXPORT_REPORT 条目",
            bool(re.search(r'["\']EXPORT_REPORT["\']\s*:\s*ActionTypeDef', reg_src)),
        )
    )
    # 检查 2: spec_field 正确
    checks.append(
        (
            "EXPORT_REPORT 的 spec_field 正确",
            bool(re.search(r'EXPORT_REPORT["\']?\s*,\s*["\']reportSpec["\']', reg_src)),
        )
    )
    # 检查 3: category 正确
    checks.append(
        (
            "EXPORT_REPORT 的 category 正确",
            bool(
                re.search(
                    r'EXPORT_REPORT["\']?\s*,\s*["\']reportSpec["\']\s*,\s*["\']validate["\']',
                    reg_src,
                )
            ),
        )
    )
    # 检查 4: read_only 正确
    checks.append(
        (
            "EXPORT_REPORT 的 read_only 正确",
            bool(
                re.search(
                    r'EXPORT_REPORT["\']?\s*,\s*["\']reportSpec["\']\s*,\s*["\']validate["\']\s*,\s*True',
                    reg_src,
                )
            ),
        )
    )

    # 读 actions.ts
    ts_path = os.path.join(WORKSPACE, "actions.ts")
    ts_src = open(ts_path, encoding="utf-8").read() if os.path.exists(ts_path) else ""

    # 检查 5: ActionType 联合类型块内含 'EXPORT_REPORT'
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
    # 检查 6 (双端奇偶): actions.ts 联合类型成员数 == registry.py ACTIONS 条目数。
    # 设计约束（codegen 单一事实源）：actions.ts 是 registry 的忠实投影——
    # 每个 ACTIONS 条目恰好对应联合类型的一个成员，不多不少。
    # 陷阱：agent 只加一端（registry 加了、联合类型没加，或反之），或某一端多加。
    # 解析：ACTIONS 按注册条目计数（"KEY": ActionTypeDef( 模式）；
    #       联合类型块按 `|` 分割，统计含字符串字面量的段（兼容前导 `|` 换行风格）。
    actions_entries = re.findall(
        r'["\'][A-Z0-9_]+["\']\s*:\s*ActionTypeDef\s*\(', reg_src
    )
    union_members = [
        seg for seg in union_block.split("|") if re.search(r"'[^']+'", seg)
    ]
    checks.append(
        (
            "双端奇偶：联合类型成员数 == ACTIONS 条目数（两端一一对应）",
            len(actions_entries) > 0 and len(union_members) == len(actions_entries),
        )
    )
    # 检查 7: EXPORT_REPORT 进入正确的只读/读写分组
    ro_match = re.search(r"READ_ONLY_ACTION_TYPES[^[]*\[([^\]]*)\]", ts_src)
    ro_block = ro_match.group(1) if ro_match else ""
    checks.append(
        (
            "EXPORT_REPORT 进入正确的读写分组",
            "EXPORT_REPORT" in ro_block,
        )
    )
    # 检查 8 (关键 ×4): EXPORT_REPORT 不应进入任何 family Set
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
    # 检查 9: EXPORT_REPORT 未进入错误的读写分组
    wm = re.search(r"WRITE_ACTION_TYPES[^[]*\[([^\]]*)\]", ts_src)
    wblock = wm.group(1) if wm else ""
    checks.append(
        (
            "EXPORT_REPORT 未进入错误的读写分组",
            "EXPORT_REPORT" not in wblock,
        )
    )
    # 检查 10: actions.ts 头部仍是 codegen 警告（agent 没把整段头部删掉）
    checks.append(
        (
            "actions.ts 头部仍含 codegen 警告",
            bool(re.search(r"禁止手改|codegen|自动生成", ts_src[:500])),
        )
    )

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
