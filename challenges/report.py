"""
Precis LLM Challenges 报告聚合器。

用法：
    python challenges/report.py --init <run-id>      初始化空 run-id 目录
    python challenges/report.py <run-id>             生成单次运行报告
    python challenges/report.py                      生成跨模型对比榜单（扫描主仓库 results/）
    python challenges/report.py <外部run目录...>       从各 eval worktree 的结果目录只读生成
                                                      跨模型榜单（不复制任何文件，目录作为
                                                      存档原地保留，worktree 无需删除）

RESULT.md 必须含 YAML frontmatter（6 字段：challenge/agent/runner/
verify_exit_code/started/finished）。report.py 解析 frontmatter，正文附加供人读。
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    import yaml  # PyYAML，后端环境自带
except ImportError:
    print("缺少 PyYAML：请在 backend 环境运行（pip install pyyaml）", file=sys.stderr)
    sys.exit(2)

# 路径
HERE = Path(__file__).resolve().parent
INDEX_PATH = HERE / "INDEX.md"
RESULTS_DIR = HERE / "results"


# ----------------------------------------------------------------------------
# INDEX.md 解析：拿题目元信息（ID/维度/栈/难度）
# ----------------------------------------------------------------------------


def parse_index() -> dict[str, dict[str, str]]:
    """
    解析 INDEX.md 的题目表格。

    返回 {challenge_id: {dimension, stack, difficulty, summary, status}}。
    C 系列表格行格式（6 列）：| C01 | nav | Python | ★☆☆ | 一句话 | ✅ ready |
    R 系列表格行格式（5 列，无维度列）：| R01 | Python | ★★★ | 一句话 | ✅ ready |
    R 系列统一记 dimension="real"（真实仓库导航）。
    """
    if not INDEX_PATH.exists():
        return {}
    text = INDEX_PATH.read_text(encoding="utf-8")
    meta: dict[str, dict[str, str]] = {}
    # C 系列：| C01 | nav | Python | ★☆☆ | ... | ✅ ready |
    row_re = re.compile(
        r"^\|\s*(C\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([★☆]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        re.MULTILINE,
    )
    for m in row_re.finditer(text):
        cid, dim, stack, stars, summary, status = m.groups()
        meta[cid] = {
            "dimension": dim.strip(),
            "stack": stack.strip(),
            "difficulty": stars.strip(),
            "summary": summary.strip(),
            "status": status.strip(),
        }
    # R 系列：| R01 | Python | ★★★ | ... | ✅ ready |
    r_row_re = re.compile(
        r"^\|\s*(R\d+)\s*\|\s*([^|]+?)\s*\|\s*([★☆]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        re.MULTILINE,
    )
    for m in r_row_re.finditer(text):
        cid, stack, stars, summary, status = m.groups()
        meta[cid] = {
            "dimension": "real",
            "stack": stack.strip(),
            "difficulty": stars.strip(),
            "summary": summary.strip(),
            "status": status.strip(),
        }
    # X 系列（专家级，真实仓库长链条）：| X01 | Python+TS | ★★★+ | ... | ✅ ready |
    x_row_re = re.compile(
        r"^\|\s*(X\d+)\s*\|\s*([^|]+?)\s*\|\s*([★☆+]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        re.MULTILINE,
    )
    for m in x_row_re.finditer(text):
        cid, stack, stars, summary, status = m.groups()
        meta[cid] = {
            "dimension": "x",
            "stack": stack.strip(),
            "difficulty": stars.strip(),
            "summary": summary.strip(),
            "status": status.strip(),
        }
    return meta


# ----------------------------------------------------------------------------
# RESULT.md 解析：YAML frontmatter + 正文
# ----------------------------------------------------------------------------


def parse_result(path: Path) -> dict | None:
    """
    解析一份 RESULT.md。

    返回 {challenge, agent, runner, verify_exit_code, started, finished,
          duration_min, body} 或 None（无 frontmatter / 格式错）。
    """
    text = path.read_text(encoding="utf-8")
    # 提取 --- ... --- frontmatter
    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not fm_match:
        return None
    fm_text, body = fm_match.group(1), fm_match.group(2)
    try:
        data = yaml.safe_load(fm_text)
    except yaml.YAMLError:
        return None
    if not isinstance(data, dict):
        return None
    # 必需字段
    if "challenge" not in data or "verify_exit_code" not in data:
        return None
    # 计算耗时（分钟）—— PyYAML 可能把时间戳解析成 datetime 对象，统一处理
    duration_min = None
    started_raw = data.get("started")
    finished_raw = data.get("finished")
    started = (
        started_raw.isoformat()
        if isinstance(started_raw, datetime)
        else (str(started_raw) if started_raw else "")
    )
    finished = (
        finished_raw.isoformat()
        if isinstance(finished_raw, datetime)
        else (str(finished_raw) if finished_raw else "")
    )
    if started and finished:
        try:
            ts1 = datetime.fromisoformat(started.replace("Z", "+00:00"))
            ts2 = datetime.fromisoformat(finished.replace("Z", "+00:00"))
            duration_min = round((ts2 - ts1).total_seconds() / 60.0, 1)
        except (ValueError, TypeError):
            pass
    return {
        "challenge": str(data.get("challenge", "")).strip(),
        "agent": str(data.get("agent", "unknown")).strip(),
        "runner": str(data.get("runner", "unknown")).strip(),
        "verify_exit_code": int(data.get("verify_exit_code", -1)),
        "started": started or "",
        "finished": finished or "",
        "duration_min": duration_min,
        "body": body.strip(),
    }


# ----------------------------------------------------------------------------
# 收集某 run-id 的所有结果
# ----------------------------------------------------------------------------


def collect_run_dir(run_dir: Path) -> list[dict]:
    """返回某个 run 目录（可为外部路径）下所有 RESULT 解析结果（按 challenge 排序）。"""
    if not run_dir.is_dir():
        return []
    results: list[dict] = []
    for md in sorted(run_dir.glob("*.md")):
        if md.name.upper() == "REPORT.MD":
            continue  # 跳过自己生成的报告
        parsed = parse_result(md)
        if parsed is not None:
            results.append(parsed)
    return results


def collect_run(run_id: str, base_dir: Path | None = None) -> list[dict]:
    """返回某 run-id 目录下所有 RESULT 解析结果（按 challenge 排序）。"""
    return collect_run_dir((base_dir or RESULTS_DIR) / run_id)


def list_run_ids() -> list[str]:
    """列出 results/ 下所有 run-id 目录（含 RESULT 的才算）。"""
    if not RESULTS_DIR.is_dir():
        return []
    ids: list[str] = []
    for d in sorted(RESULTS_DIR.iterdir()):
        if d.is_dir() and any(d.glob("*.md")):
            ids.append(d.name)
    return ids


# ----------------------------------------------------------------------------
# 单次运行报告
# ----------------------------------------------------------------------------


def fmt_pass(exit_code: int) -> str:
    if exit_code == 0:
        return "✅ PASS"
    return "❌ FAIL"


def generate_run_report(run_id: str, index_meta: dict[str, dict[str, str]]) -> str:
    """生成单次运行的 REPORT.md 内容。"""
    results = collect_run(run_id)
    lines: list[str] = []
    lines.append(f"# Report — {run_id}")
    lines.append("")
    lines.append(f"生成时间：{datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"结果数：{len(results)}")
    passed = sum(1 for r in results if r["verify_exit_code"] == 0)
    lines.append(f"通过率：{passed}/{len(results)}" if results else "通过率：N/A")
    lines.append("")

    # 总览表
    lines.append("## 总览")
    lines.append("")
    lines.append("| 题目 | 维度 | 栈 | 难度 | 结果 | 耗时(min) | agent |")
    lines.append("|------|------|----|----|------|----------|-------|")
    for r in results:
        cid_full = r["challenge"]
        cid_num = cid_full.split("-")[0] if "-" in cid_full else cid_full
        meta = index_meta.get(cid_num, {})
        dim = meta.get("dimension", "?")
        stack = meta.get("stack", "?")
        diff = meta.get("difficulty", "?")
        dur = r["duration_min"] if r["duration_min"] is not None else "—"
        lines.append(
            f"| {cid_full} | {dim} | {stack} | {diff} | {fmt_pass(r['verify_exit_code'])} | {dur} | {r['agent']} |"
        )
    lines.append("")

    # 聚合：按维度/栈/难度
    def aggregate(key_fn, label: str) -> None:
        groups: dict[str, list[int]] = defaultdict(list)
        for r in results:
            cid_num = (
                r["challenge"].split("-")[0]
                if "-" in r["challenge"]
                else r["challenge"]
            )
            meta = index_meta.get(cid_num, {})
            k = key_fn(meta) or "未知"
            groups[k].append(r["verify_exit_code"])
        if not groups:
            return
        lines.append(f"## 按{label}聚合")
        lines.append("")
        lines.append(f"| {label} | 通过/总数 | 通过率 |")
        lines.append("|------|----------|--------|")
        for k in sorted(groups.keys()):
            codes = groups[k]
            p = sum(1 for c in codes if c == 0)
            rate = f"{p}/{len(codes)}"
            pct = f"{p / len(codes) * 100:.0f}%" if codes else "—"
            lines.append(f"| {k} | {rate} | {pct} |")
        lines.append("")

    aggregate(lambda m: m.get("dimension"), "维度")
    aggregate(lambda m: m.get("stack"), "栈")
    aggregate(lambda m: m.get("difficulty"), "难度")

    # 各题详情（正文摘要）
    lines.append("## 各题详情")
    lines.append("")
    for r in results:
        lines.append(f"### {r['challenge']} — {fmt_pass(r['verify_exit_code'])}")
        lines.append("")
        body_first = r["body"].split("\n", 1)[0] if r["body"] else "（无正文）"
        lines.append(f"> {body_first[:200]}")
        lines.append("")

    return "\n".join(lines)


# ----------------------------------------------------------------------------
# 跨模型对比榜单
# ----------------------------------------------------------------------------


def generate_leaderboard(
    index_meta: dict[str, dict[str, str]],
    sources: dict[str, Path] | None = None,
) -> str:
    """
    生成 LEADERBOARD.md：行=题，列=run-id（含 agent），格=pass/fail。

    sources：{run 标签: run 目录路径}。为 None 时扫描主仓库 results/ 下的 run-id
    （向后兼容）；显式传入时直接读取外部目录（如各 eval worktree 的 results/），
    不复制任何文件。
    """
    if sources is None:
        run_ids = list_run_ids()
        sources = {rid: RESULTS_DIR / rid for rid in run_ids}
    else:
        run_ids = list(sources.keys())
    lines: list[str] = []
    lines.append("# Leaderboard — 跨运行对比")
    lines.append("")
    lines.append(f"生成时间：{datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"运行数：{len(run_ids)}")
    lines.append("")

    # 收集所有题目 ID（跨运行并集，按 ID 排序）
    all_cids: set[str] = set()
    run_results: dict[str, dict[str, dict]] = {}  # run_id -> {cid_full -> result}
    for rid in run_ids:
        results = collect_run_dir(sources[rid])
        run_results[rid] = {r["challenge"]: r for r in results}
        for r in results:
            cid_num = (
                r["challenge"].split("-")[0]
                if "-" in r["challenge"]
                else r["challenge"]
            )
            all_cids.add(cid_num)

    if not all_cids:
        lines.append("（无结果）")
        return "\n".join(lines)

    # 收集每个 run 的 agent 标签（取该 run 里出现最多的 agent）
    def agent_label(rid: str) -> str:
        agents = [r["agent"] for r in run_results[rid].values()]
        if not agents:
            return rid
        # 取众数
        from collections import Counter

        return Counter(agents).most_common(1)[0][0]

    # 表头
    lines.append("## 通过矩阵（行=题，列=运行）")
    lines.append("")
    header = "| 题目 | 维度 | 难度 |"
    sep = "|------|------|----|"
    for rid in run_ids:
        header += f" {agent_label(rid)} |"
        sep += "----|"
    lines.append(header)
    lines.append(sep)

    for cid in sorted(all_cids):
        meta = index_meta.get(cid, {})
        dim = meta.get("dimension", "?")
        diff = meta.get("difficulty", "?")
        row = f"| {cid} | {dim} | {diff} |"
        for rid in run_ids:
            # 找该 run 里属于这个 cid 的结果（challenge 字段可能是 Cxx-full-name）
            matched = None
            for cid_full, r in run_results[rid].items():
                if cid_full.split("-")[0] == cid:
                    matched = r
                    break
            if matched is None:
                row += " — |"
            else:
                row += f" {'✅' if matched['verify_exit_code'] == 0 else '❌'} |"
        lines.append(row)
    lines.append("")

    # 汇总行：每个 run 的总通过率
    lines.append("## 总通过率")
    lines.append("")
    lines.append("| 运行 | agent | 通过/总数 | 通过率 |")
    lines.append("|------|-------|----------|--------|")
    for rid in run_ids:
        results = list(run_results[rid].values())
        if not results:
            continue
        p = sum(1 for r in results if r["verify_exit_code"] == 0)
        pct = f"{p / len(results) * 100:.0f}%"
        lines.append(f"| {rid} | {agent_label(rid)} | {p}/{len(results)} | {pct} |")
    lines.append("")

    return "\n".join(lines)


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    # --init <run-id>
    if len(argv) >= 2 and argv[0] == "--init":
        run_id = argv[1]
        run_dir = RESULTS_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        print(f"已初始化 {run_dir}")
        return 0

    index_meta = parse_index()

    # 无参：跨模型榜单（扫描主仓库 results/ 下的 run-id）
    if not argv:
        if not list_run_ids():
            print(
                "无运行结果。先用 --init <run-id> 建目录，再把 RESULT.md 复制进去。",
                file=sys.stderr,
            )
            return 1
        content = generate_leaderboard(index_meta)
        out = RESULTS_DIR / "LEADERBOARD.md"
        out.write_text(content, encoding="utf-8")
        print(f"REPORT leaderboard\n生成 {out}")
        return 0

    # 外部 run 目录（各 eval worktree 的 results/<run-id>/）：只读生成跨模型榜单，不复制文件
    # 注意：Path / 绝对路径会直接返回该绝对路径，故用 resolve().parent 判断归属
    args = [Path(a) for a in argv]
    external = [
        a for a in args if a.is_dir() and a.resolve().parent != RESULTS_DIR.resolve()
    ]
    if external:
        missing = [a for a in args if not a.is_dir()]
        if missing:
            for a in missing:
                print(f"结果目录不存在：{a}", file=sys.stderr)
            return 1
        sources = {a.name: a for a in args}
        content = generate_leaderboard(index_meta, sources)
        out = RESULTS_DIR / "LEADERBOARD.md"
        out.write_text(content, encoding="utf-8")
        print(
            "REPORT leaderboard（外部目录）\n"
            + "\n".join(f"  - {a}" for a in args)
            + f"\n生成 {out}"
        )
        return 0

    # 单次报告（run-id，results/<run-id>/ 下）
    run_id = argv[0]
    run_dir = RESULTS_DIR / run_id
    if not run_dir.is_dir():
        if Path(run_id).is_absolute() or "/" in run_id or "\\" in run_id:
            print(f"结果目录不存在：{run_id}", file=sys.stderr)
            return 1
        print(f"运行 {run_id} 不存在。先用 --init {run_id} 创建。", file=sys.stderr)
        return 1
    results = collect_run(run_id)
    if not results:
        print(
            f"运行 {run_id} 下无 RESULT.md。把各题的 workspace/RESULT.md 复制为 results/{run_id}/<Cxx>.md。",
            file=sys.stderr,
        )
        return 1
    content = generate_run_report(run_id, index_meta)
    out = run_dir / "REPORT.md"
    out.write_text(content, encoding="utf-8")
    print(f"REPORT {run_id}\n生成 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
