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
verify_exit_code/started/finished）。L 系列题目额外支持多级评分字段
（均可选，向后兼容）：score / max_score / dimension_scores / subscores。
report.py 解析 frontmatter，正文附加供人读。
"""

from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
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

# INDEX 元信息：{challenge_id: {...}}。L 系列条目额外含 int 型 max_score 与 dims 字符串。
IndexMeta = dict[str, dict[str, object]]


# ----------------------------------------------------------------------------
# INDEX.md 解析：拿题目元信息（ID/维度/栈/难度/满分）
# ----------------------------------------------------------------------------


def parse_index() -> IndexMeta:
    """
    解析 INDEX.md 的题目表格。

    返回 {challenge_id: {dimension, stack, difficulty, summary, status}}；
    L 系列额外含 dims（原样字符串）与 max_score（int）。
    C 系列表格行格式（6 列）：| C01 | nav | Python | ★☆☆ | 一句话 | ✅ ready |
    R 系列表格行格式（5 列，无维度列）：| R01 | Python | ★★★ | 一句话 | ✅ ready |
    R 系列统一记 dimension="real"（真实仓库导航）。
    L 系列表格行格式（7 列）：| L01 | Python | ★★★★+ | spec | 9 | 一句话 | ✅ ready |
    """
    if not INDEX_PATH.exists():
        return {}
    text = INDEX_PATH.read_text(encoding="utf-8")
    meta: IndexMeta = {}
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
    # L 系列（多级评分）：| L01 | Python | ★★★★+ | spec | 9 | 一句话 | ✅ ready |
    # 维度标签 dims 为原样字符串（可能含逗号分隔多维度），max_score 为 int。
    l_row_re = re.compile(
        r"^\|\s*(L\d+)\s*\|\s*([^|]+?)\s*\|\s*([★☆+]+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        re.MULTILINE,
    )
    for m in l_row_re.finditer(text):
        cid, stack, stars, dims, max_score, summary, status = m.groups()
        meta[cid] = {
            "dimension": dims.strip(),
            "stack": stack.strip(),
            "difficulty": stars.strip(),
            "dims": dims.strip(),
            "max_score": int(max_score),
            "summary": summary.strip(),
            "status": status.strip(),
        }
    return meta


# ----------------------------------------------------------------------------
# RESULT.md 解析：YAML frontmatter + 正文
# ----------------------------------------------------------------------------


def challenge_cid(challenge: str) -> str:
    """C01-nav-add-maxlength -> C01；无连字符则原样返回。"""
    return challenge.split("-")[0] if "-" in challenge else challenge


def is_l_result(r: dict, index_meta: IndexMeta) -> bool:
    """该结果是否属于 L 系列题目（INDEX 中该题带 max_score）。"""
    return isinstance(
        index_meta.get(challenge_cid(r["challenge"]), {}).get("max_score"), int
    )


def _as_int(v: object) -> int | None:
    """宽松转 int：int / 整数值 float / bool；其余返回 None。"""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def _parse_dimension_scores(raw: object) -> dict[str, dict[str, int | None]] | None:
    """
    宽松解析 dimension_scores：{dim: {score: int, max: int}} 或 {dim: int}。

    其他形态逐条跳过；整体缺失/空则返回 None。
    """
    if not isinstance(raw, dict):
        return None
    normalized: dict[str, dict[str, int | None]] = {}
    for k, v in raw.items():
        key = str(k).strip()
        if not key:
            continue
        if isinstance(v, dict):
            sc = _as_int(v.get("score"))
            mx = _as_int(v.get("max"))
            if sc is not None:
                normalized[key] = {"score": sc, "max": mx}
        else:
            sc = _as_int(v)
            if sc is not None:
                normalized[key] = {"score": sc, "max": None}
    return normalized or None


def parse_result(path: Path, index_meta: IndexMeta | None = None) -> dict | None:
    """
    解析一份 RESULT.md。

    返回 {challenge, agent, runner, verify_exit_code, started, finished,
          duration_min, score, max_score, dimension_scores, subscores, body}
    或 None（无 frontmatter / 格式错）。

    多级评分字段均可选，向后兼容旧格式：
    - 有 score → 直接采用；
    - 无 score → 按 verify_exit_code 映射：0 → max_score（frontmatter 的
      max_score，缺省取 INDEX 该题 max_score，再缺省 1）；非 0 → 0。
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
    challenge = str(data.get("challenge", "")).strip()
    verify_exit_code = int(data.get("verify_exit_code", -1))

    # ---- 多级评分（可选，向后兼容） ----
    index_max = (
        index_meta.get(challenge_cid(challenge), {}).get("max_score")
        if index_meta
        else None
    )
    fm_max = _as_int(data.get("max_score"))
    max_score = (
        fm_max
        if fm_max is not None
        else (index_max if isinstance(index_max, int) else 1)
    )
    score = _as_int(data.get("score"))
    if score is None:
        # 旧格式：无 score 字段时按 verify_exit_code 映射
        score = max_score if verify_exit_code == 0 else 0
    dimension_scores = _parse_dimension_scores(data.get("dimension_scores"))
    subscores_raw = data.get("subscores")
    subscores = str(subscores_raw).strip() if subscores_raw is not None else None

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
        "challenge": challenge,
        "agent": str(data.get("agent", "unknown")).strip(),
        "runner": str(data.get("runner", "unknown")).strip(),
        "verify_exit_code": verify_exit_code,
        "started": started or "",
        "finished": finished or "",
        "duration_min": duration_min,
        "score": score,
        "max_score": max_score,
        "dimension_scores": dimension_scores,
        "subscores": subscores,
        "body": body.strip(),
    }


# ----------------------------------------------------------------------------
# 收集某 run-id 的所有结果
# ----------------------------------------------------------------------------


def collect_run_dir(run_dir: Path, index_meta: IndexMeta | None = None) -> list[dict]:
    """返回某个 run 目录（可为外部路径）下所有 RESULT 解析结果（按 challenge 排序）。"""
    if not run_dir.is_dir():
        return []
    results: list[dict] = []
    for md in sorted(run_dir.glob("*.md")):
        if md.name.upper() == "REPORT.MD":
            continue  # 跳过自己生成的报告
        parsed = parse_result(md, index_meta)
        if parsed is not None:
            results.append(parsed)
    return results


def collect_run(
    run_id: str, base_dir: Path | None = None, index_meta: IndexMeta | None = None
) -> list[dict]:
    """返回某 run-id 目录下所有 RESULT 解析结果（按 challenge 排序）。"""
    return collect_run_dir((base_dir or RESULTS_DIR) / run_id, index_meta)


def list_run_ids() -> list[str]:
    """列出 results/ 下所有 run-id 目录（含 RESULT 的才算）。"""
    if not RESULTS_DIR.is_dir():
        return []
    ids: list[str] = []
    for d in sorted(RESULTS_DIR.iterdir()):
        if d.is_dir() and any(d.glob("*.md")):
            ids.append(d.name)
    return ids


def agent_label(results: list[dict], fallback: str) -> str:
    """取一组结果中出现最多的 agent（众数），无结果时返回 fallback。"""
    if not results:
        return fallback
    return Counter(r["agent"] for r in results).most_common(1)[0][0]


# ----------------------------------------------------------------------------
# 多级评分聚合（L 系列）：维度得分合计
# ----------------------------------------------------------------------------


def split_dims(dims_raw: object) -> list[str]:
    """把 INDEX 的 dims 原样字符串拆成维度列表（支持逗号/中文逗号/加号分隔）。"""
    return [d.strip() for d in re.split(r"[,，+]", str(dims_raw or "")) if d.strip()]


def dimension_totals(
    results: list[dict], index_meta: IndexMeta
) -> dict[str, list[int]]:
    """
    计算 L 系列各维度得分合计：{dim: [Σscore, Σmax]}。

    - dimension_scores 存在：逐条累加（键不区分大小写对齐 INDEX dims，对不齐按原键）；
      条目无 max 时按该题 max_score 兜底。
    - dimension_scores 缺失：该题 score/max_score 摊到 INDEX dims 首个维度。
    """
    totals: dict[str, list[int]] = {}
    for r in results:
        if not is_l_result(r, index_meta):
            continue
        meta = index_meta.get(challenge_cid(r["challenge"]), {})
        dims = split_dims(meta.get("dims"))
        ds = r.get("dimension_scores")
        if ds:
            for dk, entry in ds.items():
                key = next((d for d in dims if d.casefold() == dk.casefold()), dk)
                mx = entry["max"] if entry["max"] is not None else r["max_score"]
                totals.setdefault(key, [0, 0])
                totals[key][0] += entry["score"]
                totals[key][1] += mx
        elif dims:
            totals.setdefault(dims[0], [0, 0])
            totals[dims[0]][0] += r["score"]
            totals[dims[0]][1] += r["max_score"]
    return totals


# ----------------------------------------------------------------------------
# 单次运行报告
# ----------------------------------------------------------------------------


def fmt_pass(exit_code: int) -> str:
    if exit_code == 0:
        return "✅ PASS"
    return "❌ FAIL"


def generate_run_report(run_id: str, index_meta: IndexMeta) -> str:
    """生成单次运行的 REPORT.md 内容。"""
    results = collect_run(run_id, index_meta=index_meta)
    lines: list[str] = []
    lines.append(f"# Report — {run_id}")
    lines.append("")
    lines.append(f"生成时间：{datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"结果数：{len(results)}")

    # 通过率双轨：旧题按 pass/fail 计数，L 题按 Σscore/Σmax（无 L 题则省略该行）
    l_results = [r for r in results if is_l_result(r, index_meta)]
    old_results = [r for r in results if r not in l_results]
    if old_results:
        passed = sum(1 for r in old_results if r["verify_exit_code"] == 0)
        lines.append(f"通过率：{passed}/{len(old_results)}")
    else:
        lines.append("通过率：N/A")
    if l_results:
        total = sum(r["score"] for r in l_results)
        total_max = sum(r["max_score"] for r in l_results)
        lines.append(f"L 题得分：{total}/{total_max}")
    lines.append("")

    # 总览表（得分列：L 题 7/9，旧题 ✅/❌）
    lines.append("## 总览")
    lines.append("")
    lines.append("| 题目 | 维度 | 栈 | 难度 | 结果 | 得分 | 耗时(min) | agent |")
    lines.append("|------|------|----|----|------|------|----------|-------|")
    for r in results:
        cid_full = r["challenge"]
        meta = index_meta.get(challenge_cid(cid_full), {})
        dim = meta.get("dimension", "?")
        stack = meta.get("stack", "?")
        diff = meta.get("difficulty", "?")
        dur = r["duration_min"] if r["duration_min"] is not None else "—"
        if is_l_result(r, index_meta):
            score_cell = f"{r['score']}/{r['max_score']}"
        else:
            score_cell = "✅" if r["verify_exit_code"] == 0 else "❌"
        lines.append(
            f"| {cid_full} | {dim} | {stack} | {diff} | {fmt_pass(r['verify_exit_code'])} "
            f"| {score_cell} | {dur} | {r['agent']} |"
        )
    lines.append("")

    # 聚合：按维度/栈/难度（双轨：旧题通过率 + L 题得分）
    def aggregate(key_fn, label: str) -> None:
        groups: dict[str, list[dict]] = defaultdict(list)
        for r in results:
            meta = index_meta.get(challenge_cid(r["challenge"]), {})
            k = key_fn(meta) or "未知"
            groups[k].append(r)
        if not groups:
            return
        lines.append(f"## 按{label}聚合")
        lines.append("")
        lines.append(f"| {label} | 通过/总数 | 通过率 | 得分/满分 |")
        lines.append("|------|----------|--------|----------|")
        for k in sorted(groups.keys()):
            old_g = [r for r in groups[k] if not is_l_result(r, index_meta)]
            l_g = [r for r in groups[k] if is_l_result(r, index_meta)]
            if old_g:
                p = sum(1 for r in old_g if r["verify_exit_code"] == 0)
                rate = f"{p}/{len(old_g)}"
                pct = f"{p / len(old_g) * 100:.0f}%"
            else:
                rate = "—"
                pct = "—"
            if l_g:
                total = sum(r["score"] for r in l_g)
                total_max = sum(r["max_score"] for r in l_g)
                score_cell = f"{total}/{total_max}"
            else:
                score_cell = "—"
            lines.append(f"| {k} | {rate} | {pct} | {score_cell} |")
        lines.append("")

    aggregate(lambda m: m.get("dimension"), "维度")
    aggregate(lambda m: m.get("stack"), "栈")
    aggregate(lambda m: m.get("difficulty"), "难度")

    # 单模型维度得分表（L 系列：dimension_scores 求和归一化）
    dim_totals = dimension_totals(results, index_meta)
    if dim_totals:
        lines.append("## 按维度得分")
        lines.append("")
        lines.append("| 维度 | 得分 | 满分 | 得分率 |")
        lines.append("|------|------|------|--------|")
        for dim in sorted(dim_totals.keys()):
            sc, mx = dim_totals[dim]
            pct = f"{sc / mx * 100:.0f}%" if mx else "—"
            lines.append(f"| {dim} | {sc} | {mx} | {pct} |")
        lines.append("")

    # 各题详情（正文摘要）
    lines.append("## 各题详情")
    lines.append("")
    for r in results:
        lines.append(f"### {r['challenge']} — {fmt_pass(r['verify_exit_code'])}")
        lines.append("")
        body_first = r["body"].split("\n", 1)[0] if r["body"] else "（无正文）"
        lines.append(f"> {body_first[:200]}")
        if r.get("subscores"):
            lines.append("")
            lines.append(f"**分项得分**：{r['subscores']}")
        lines.append("")

    return "\n".join(lines)


# ----------------------------------------------------------------------------
# 跨模型对比榜单
# ----------------------------------------------------------------------------


def generate_radar(index_meta: IndexMeta, sources: dict[str, Path]) -> list[str]:
    """
    生成维度雷达段落：行=维度、列=模型（run），格=归一化 0-100（无数据 —）。

    返回 Markdown 行列表；没有任何 L 维度数据时返回空列表（不输出雷达段）。
    """
    run_totals: dict[str, dict[str, list[int]]] = {}
    labels: dict[str, str] = {}
    all_dims: set[str] = set()
    for rid, path in sources.items():
        results = collect_run_dir(path, index_meta=index_meta)
        labels[rid] = agent_label(results, rid)
        totals = dimension_totals(results, index_meta)
        run_totals[rid] = totals
        all_dims.update(totals.keys())
    if not all_dims:
        return []
    lines: list[str] = []
    lines.append("## 维度雷达（归一化 0-100）")
    lines.append("")
    header = "| 维度 |"
    sep = "|------|"
    for rid in sources:
        header += f" {labels[rid]} |"
        sep += "----|"
    lines.append(header)
    lines.append(sep)
    for dim in sorted(all_dims):
        row = f"| {dim} |"
        for rid in sources:
            t = run_totals[rid].get(dim)
            if t is None or t[1] <= 0:
                row += " — |"
            else:
                pct = max(0, min(100, round(t[0] / t[1] * 100)))
                row += f" {pct} |"
        lines.append(row)
    lines.append("")
    return lines


def generate_leaderboard(
    index_meta: IndexMeta,
    sources: dict[str, Path] | None = None,
) -> str:
    """
    生成 LEADERBOARD.md：行=题，列=run-id（含 agent）。

    单元格：L 题 `7/9`，旧题 ✅/❌。末尾附维度雷达（行=维度、列=模型，
    格=归一化 0-100，无数据 —）。

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
        results = collect_run_dir(sources[rid], index_meta=index_meta)
        run_results[rid] = {r["challenge"]: r for r in results}
        for r in results:
            all_cids.add(challenge_cid(r["challenge"]))

    if not all_cids:
        lines.append("（无结果）")
        return "\n".join(lines)

    # 表头
    lines.append("## 通过矩阵（行=题，列=运行）")
    lines.append("")
    header = "| 题目 | 维度 | 难度 |"
    sep = "|------|------|----|"
    for rid in run_ids:
        header += f" {agent_label(list(run_results[rid].values()), rid)} |"
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
                if challenge_cid(cid_full) == cid:
                    matched = r
                    break
            if matched is None:
                row += " — |"
            elif is_l_result(matched, index_meta):
                row += f" {matched['score']}/{matched['max_score']} |"
            else:
                row += f" {'✅' if matched['verify_exit_code'] == 0 else '❌'} |"
        lines.append(row)
    lines.append("")

    # 汇总：每个 run 的总分/满分 + 归一化百分比（旧题按 0/1 计分，L 题按 score/max_score）
    lines.append("## 总分汇总")
    lines.append("")
    lines.append("| 运行 | agent | 总分/满分 | 得分率 |")
    lines.append("|------|-------|----------|--------|")
    for rid in run_ids:
        results = list(run_results[rid].values())
        if not results:
            continue
        total = 0
        total_max = 0
        for r in results:
            if is_l_result(r, index_meta):
                total += r["score"]
                total_max += r["max_score"]
            else:
                total += 1 if r["verify_exit_code"] == 0 else 0
                total_max += 1
        pct = f"{total / total_max * 100:.0f}%" if total_max else "—"
        lines.append(
            f"| {rid} | {agent_label(results, rid)} | {total}/{total_max} | {pct} |"
        )
    lines.append("")

    # 维度雷达（行=维度、列=模型，归一化 0-100）
    radar = generate_radar(index_meta, sources)
    if radar:
        lines.extend(radar)

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
    results = collect_run(run_id, index_meta=index_meta)
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
