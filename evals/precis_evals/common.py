# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 评估框架公共层：路径引导、Provider 探测、任务/检查数据模型与报告输出

被三个能力套件（generation / migration / agent）与一键运行器 run_evals.py 共用。
设计要点：
- 运行前把 backend/ 注入 sys.path，评估脚本可在仓库任意位置启动
- Provider 探测顺序：--provider 显式指定 > ~/.precis/ai_providers.yaml 的
  defaults.generate/defaults.chat > 首个带可用凭据的 provider；无凭据时返回 None
  （调用方据此降级为 FakeProvider dry-run）
- 每个任务的判分结果是 Check 列表（程序化断言），套件汇总为成功率 JSON + 人读 Markdown
"""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# 仓库根目录（evals/precis_evals/common.py → 上溯两级）
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"

# backend 以可编辑安装（pip install -e）时可直接 import；未安装环境兜底注入 sys.path
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider
from app.shared.services.llm.providers.fake import (
    FAKE_MODEL_ID,
    FakeProvider,
)
from app.shared.services.llm.providers.registry import (
    create as create_provider,
)

# 单任务硬超时（秒）：真实模型偶发长响应不能卡死整个评估
TASK_TIMEOUT_SECONDS = 300.0


# =============================================================================
# 数据模型
# =============================================================================


@dataclass
class Check:
    """单条程序化判分结果。"""

    name: str
    passed: bool
    detail: str = ""


@dataclass
class TaskOutcome:
    """单任务执行产出（run 阶段与判分阶段分离，便于异常归因）。"""

    actual: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass
class EvalTask:
    """一个评估任务：输入由 run 闭包携带，期望产物由 check 闭包程序化判分。"""

    id: str
    kind: str  # normal / adversarial / boundary
    description: str
    run: Callable[[BaseProvider, Path], Awaitable[TaskOutcome]]
    check: Callable[[TaskOutcome], list[Check]]


@dataclass
class TaskReport:
    """单任务报告条目。"""

    id: str
    kind: str
    description: str
    passed: bool
    duration_ms: int
    error: str | None
    checks: list[dict[str, Any]]


@dataclass
class SuiteReport:
    """单套件报告。"""

    suite: str
    tasks: list[TaskReport] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.tasks)

    @property
    def passed(self) -> int:
        return sum(1 for t in self.tasks if t.passed)

    @property
    def success_rate(self) -> float:
        return round(self.passed / self.total, 4) if self.total else 0.0

    def by_kind(self) -> dict[str, dict[str, int]]:
        """按任务类型（normal/adversarial/boundary）分组统计。"""
        stats: dict[str, dict[str, int]] = {}
        for t in self.tasks:
            bucket = stats.setdefault(t.kind, {"passed": 0, "total": 0})
            bucket["total"] += 1
            if t.passed:
                bucket["passed"] += 1
        return stats


# =============================================================================
# 判分辅助
# =============================================================================


def check(name: str, passed: bool, detail: str = "") -> Check:
    """构造一条 Check 的简写。"""
    return Check(name=name, passed=bool(passed), detail=detail)


def iter_constraints(config: dict[str, Any]) -> list[dict[str, Any]]:
    """从 build_config 产物中统一抽取约束（独立 + 内嵌），归一为可比对形态。

    独立约束（config["constraints"] dict 值）：refs/params 分离，snake_case。
    内嵌约束（schema_doc["constraints"] 列表项）：column/columns/from_column 承载引用。
    归一输出统一含 table/columns/type/params，便于任务判分按 (表, 列, 类型) 匹配。
    """
    out: list[dict[str, Any]] = []
    for cdef in (config.get("constraints") or {}).values():
        refs = cdef.get("refs", {}) or {}
        table = refs.get("table_id") or refs.get("from_table_id") or ""
        if cdef.get("type") == "Unique" and refs.get("column_ids"):
            columns = list(refs["column_ids"])
        else:
            columns = [refs.get("column_id") or refs.get("then_column_id") or ""]
        out.append(
            {
                "table": str(table),
                "columns": [str(c) for c in columns],
                "type": str(cdef.get("type", "")),
                "params": cdef.get("params", {}) or {},
                "storage": "standalone",
            }
        )
    for schema_id, schema_doc in (config.get("schemas") or {}).items():
        if not isinstance(schema_doc, dict):
            continue
        for item in schema_doc.get("constraints", []) or []:
            if not isinstance(item, dict):
                continue
            if item.get("columns"):
                columns = [str(c) for c in item["columns"]]
            elif item.get("from_column"):
                columns = [str(item["from_column"])]
            else:
                columns = [str(item.get("column", ""))]
            out.append(
                {
                    "table": str(schema_id),
                    "columns": columns,
                    "type": str(item.get("type", "")),
                    "params": item.get("params", {}) or {},
                    "storage": "inline",
                }
            )
    return out


def find_constraints(
    config: dict[str, Any],
    ctype: str,
    column: str | None = None,
    table: str | None = None,
) -> list[dict[str, Any]]:
    """按类型（可选按列/表）过滤归一化约束。列匹配对大小写不敏感。"""
    matched = []
    for c in iter_constraints(config):
        if c["type"] != ctype:
            continue
        if column is not None and column.lower() not in [
            c.lower() for c in c["columns"]
        ]:
            continue
        if table is not None and c["table"] != table:
            continue
        matched.append(c)
    return matched


def iter_regex_nodes(config: dict[str, Any]) -> list[dict[str, Any]]:
    """从 build_config 产物中抽取正则节点（dict 值形态）。"""
    nodes = config.get("regex_nodes") or {}
    if isinstance(nodes, dict):
        return [v for v in nodes.values() if isinstance(v, dict)]
    return [v for v in nodes if isinstance(v, dict)]


def check_constraint_present(
    config: dict[str, Any],
    ctype: str,
    column: str,
    table: str | None = None,
    param_predicates: dict[str, Any] | None = None,
    label: str | None = None,
) -> Check:
    """通用判分：指定 (类型, 列[, 表][, 参数谓词]) 的约束存在。

    param_predicates 的值支持：
    - 标量：相等比对（数值做 float 容差比对）
    - ("contains", x)：参数集合/字符串包含
    - ("ge", x) / ("le", x)：数值下/上界（半开区间场景，单边 Range）
    """
    label = label or f"constraint {ctype} on {column}"
    found = find_constraints(config, ctype, column=column, table=table)
    if not found:
        detail = f"no {ctype} constraint on column '{column}'; got: " + "; ".join(
            f"{c['type']}@{c['table']}.{','.join(c['columns'])}"
            for c in iter_constraints(config)
        )
        return check(label, False, detail[:500])
    for c in found:
        params = c.get("params", {})
        ok = True
        for key, expected in (param_predicates or {}).items():
            actual = params.get(key)
            if (
                isinstance(expected, tuple)
                and len(expected) == 2
                and expected[0] in ("contains", "ge", "le")
            ):
                op, operand = expected
                if op == "contains":
                    ok = ok and actual is not None and operand in actual
                elif op == "ge":
                    try:
                        ok = (
                            ok
                            and actual is not None
                            and float(actual) >= float(operand)
                        )
                    except (TypeError, ValueError):
                        ok = False
                else:
                    try:
                        ok = (
                            ok
                            and actual is not None
                            and float(actual) <= float(operand)
                        )
                    except (TypeError, ValueError):
                        ok = False
            elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
                try:
                    ok = (
                        ok
                        and actual is not None
                        and abs(float(actual) - float(expected)) < 1e-9
                    )
                except (TypeError, ValueError):
                    ok = False
            else:
                ok = ok and actual == expected
            if not ok:
                break
        if ok:
            return check(label, True, f"params={params}")
    return check(
        label,
        False,
        f"found {ctype} on {column} but params mismatch: {[c['params'] for c in found]}",
    )


def check_no_constraint_on(config: dict[str, Any], ctype: str, column: str) -> Check:
    """对抗判分：指定列上不得出现某类型约束（幻觉/越界防护）。"""
    found = find_constraints(config, ctype, column=column)
    return check(
        f"no {ctype} on '{column}'",
        not found,
        f"unexpected: {[c['params'] for c in found]}" if found else "",
    )


def check_columns_exist(
    config: dict[str, Any], table: str, expected_columns: list[str]
) -> Check:
    """判分：schema 存在且包含全部期望列（列名大小写不敏感）。"""
    schemas = config.get("schemas") or {}
    doc = schemas.get(table)
    if doc is None:
        # 兜底：按 name 匹配（LLM 可能生成不同 schema id）
        for v in schemas.values():
            if isinstance(v, dict) and v.get("name") == table:
                doc = v
                break
    if not isinstance(doc, dict):
        return check(f"schema '{table}' exists", False, f"schemas: {list(schemas)}")
    cols = {
        str(c.get("name", c.get("id", ""))).lower()
        for c in doc.get("columns", [])
        if isinstance(c, dict)
    }
    missing = [c for c in expected_columns if c.lower() not in cols]
    return check(
        f"schema '{table}' has columns {expected_columns}",
        not missing,
        f"missing: {missing}" if missing else "",
    )


# =============================================================================
# Provider 探测
# =============================================================================


@dataclass
class ProviderInfo:
    """探测结果：provider 实例 + 展示元数据。"""

    provider: BaseProvider
    provider_id: str
    provider_type: str
    model: str
    mode: str  # real / dry-run


def make_fake_provider() -> FakeProvider:
    """构造确定性 FakeProvider（dry-run 模式用，零网络零密钥）。"""
    return FakeProvider(
        AIProvider(
            id="fake-eval",
            name="fake-eval",
            type=ProviderType.FAKE,
            base_url="http://localhost/fake",
            model=FAKE_MODEL_ID,
        )
    )


def probe_provider(
    provider_id: str | None = None, dry_run: bool = False
) -> ProviderInfo | None:
    """探测可用的 AI Provider。

    优先级：dry_run 显式指定 > provider_id 显式指定 > 用户级配置 defaults.generate >
    defaults.chat > 首个带可用凭据的 provider。无任何可用凭据时返回 None
    （调用方应降级为 FakeProvider dry-run 或提示补配密钥）。
    """
    if dry_run:
        p = make_fake_provider()
        return ProviderInfo(p, "fake-eval", "fake", FAKE_MODEL_ID, "dry-run")

    from app.shared.services.llm.config.loader import ConfigLoader

    try:
        config = ConfigLoader().load()
    # 探测失败视为无可用配置，不阻断评估入口
    except Exception:  # noqa: BLE001
        return None

    providers = list(config.providers or [])
    if not providers:
        return None

    chosen: AIProvider | None = None
    if provider_id:
        chosen = next((p for p in providers if p.id == provider_id), None)
        if chosen is None:
            return None
    else:
        default_pid = (config.defaults or {}).get("generate") or (
            config.defaults or {}
        ).get("chat")
        if default_pid:
            chosen = next((p for p in providers if p.id == default_pid), None)
        if chosen is None:
            # 回退首个带可用凭据的 provider（openai 型需要 api_key；ollama 本地免钥）
            chosen = next(
                (
                    p
                    for p in providers
                    if p.api_key
                    or p.type == ProviderType.OLLAMA
                    or p.type == ProviderType.FAKE
                ),
                None,
            )
    if chosen is None:
        return None
    # api_key 可能经环境变量注入（loader._load_api_keys_from_env 已合并）
    if not chosen.api_key and chosen.type not in (
        ProviderType.OLLAMA,
        ProviderType.FAKE,
    ):
        return None

    instance = create_provider(chosen)
    return ProviderInfo(
        provider=instance,
        provider_id=chosen.id,
        provider_type=chosen.type.value
        if hasattr(chosen.type, "value")
        else str(chosen.type),
        model=chosen.model or "",
        mode="real",
    )


# =============================================================================
# 运行与报告
# =============================================================================


async def run_task(task: EvalTask, info: ProviderInfo, workdir: Path) -> TaskReport:
    """执行单个任务：run（带超时兜底）→ check → 汇总报告条目。"""
    import asyncio

    started = time.monotonic()
    error: str | None = None
    outcome = TaskOutcome()
    try:
        outcome = await asyncio.wait_for(
            task.run(info.provider, workdir), timeout=TASK_TIMEOUT_SECONDS
        )
    except TimeoutError:
        error = f"task timed out after {TASK_TIMEOUT_SECONDS:.0f}s"
    except Exception as e:  # noqa: BLE001 — 评估框架必须吞掉单任务异常继续跑完套件
        error = f"{type(e).__name__}: {e}"

    checks: list[Check] = []
    if error is None:
        try:
            checks = task.check(outcome) or []
        except Exception as e:  # noqa: BLE001
            error = f"check error: {type(e).__name__}: {e}"

    if error is not None:
        outcome.error = error
        # 执行/判分异常视为整体失败（无检查结果）
        passed = False
    else:
        passed = bool(checks) and all(c.passed for c in checks)

    return TaskReport(
        id=task.id,
        kind=task.kind,
        description=task.description,
        passed=passed,
        duration_ms=int((time.monotonic() - started) * 1000),
        error=error or outcome.error,
        checks=[
            {"name": c.name, "passed": c.passed, "detail": c.detail} for c in checks
        ],
    )


async def run_suite(
    suite: str, tasks: list[EvalTask], info: ProviderInfo, workroot: Path
) -> SuiteReport:
    """顺序执行一个套件的全部任务（真实模型按序调用，避免并发限流干扰）。"""
    report = SuiteReport(suite=suite)
    for task in tasks:
        workdir = workroot / suite / task.id
        workdir.mkdir(parents=True, exist_ok=True)
        tr = await run_task(task, info, workdir)
        report.tasks.append(tr)
        status = "PASS" if tr.passed else "FAIL"
        print(
            f"  [{status}] {task.id} ({tr.kind}) {tr.duration_ms}ms"
            + (f" — {tr.error}" if tr.error else "")
        )
        for c in tr.checks:
            if not c["passed"]:
                print(f"         ✗ {c['name']}: {c['detail'][:200]}")
    return report


def build_report_json(
    mode: str, info: ProviderInfo, suites: list[SuiteReport]
) -> dict[str, Any]:
    """汇总全部套件为成功率 JSON。"""
    return {
        "eval_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "provider": {
            "id": info.provider_id,
            "type": info.provider_type,
            "model": info.model,
        },
        "overall": {
            "total": sum(s.total for s in suites),
            "passed": sum(s.passed for s in suites),
            "success_rate": round(
                sum(s.passed for s in suites) / sum(s.total for s in suites), 4
            )
            if suites
            else 0.0,
        },
        "suites": [
            {
                "suite": s.suite,
                "total": s.total,
                "passed": s.passed,
                "success_rate": s.success_rate,
                "by_kind": s.by_kind(),
                "tasks": [t.__dict__ for t in s.tasks],
            }
            for s in suites
        ],
    }


def render_report_markdown(report: dict[str, Any]) -> str:
    """渲染人读 Markdown 摘要。"""
    lines = ["# Precis AI 评估报告", ""]
    p = report["provider"]
    lines.append(
        f"- 生成时间: {report['generated_at']}  \n"
        f"- 模式: {report['mode']}  \n"
        f"- Provider: `{p['id']}` ({p['type']}, model={p['model']})"
    )
    lines.append("")
    lines.append("| 套件 | 通过/总数 | 成功率 | normal | adversarial | boundary |")
    lines.append("|------|-----------|--------|--------|-------------|----------|")
    for s in report["suites"]:
        bk = s["by_kind"]

        # B023：经默认参绑定循环变量，避免闭包晚绑定读到别的套件的桶
        def fmt(kind: str, bk: dict[str, Any] = bk) -> str:
            b = bk.get(kind)
            return f"{b['passed']}/{b['total']}" if b else "-"

        lines.append(
            f"| {s['suite']} | {s['passed']}/{s['total']} | {s['success_rate']:.0%} | "
            f"{fmt('normal')} | {fmt('adversarial')} | {fmt('boundary')} |"
        )
    ov = report["overall"]
    lines.append("")
    lines.append(
        f"**总体: {ov['passed']}/{ov['total']}（成功率 {ov['success_rate']:.0%}）**"
    )
    lines.append("")
    for s in report["suites"]:
        lines.append(f"## {s['suite']}")
        lines.append("")
        lines.append("| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |")
        lines.append("|------|------|------|------|----------------|")
        for t in s["tasks"]:
            failed = [c["name"] for c in t["checks"] if not c["passed"]]
            note = "; ".join(failed) if failed else (t["error"] or "")
            lines.append(
                f"| {t['id']} | {t['kind']} | {'✅' if t['passed'] else '❌'} | {t['duration_ms']}ms | {note} |"
            )
        lines.append("")
    return "\n".join(lines)


def write_report(report: dict[str, Any], out_dir: Path, stem: str) -> tuple[Path, Path]:
    """落盘 JSON + Markdown 双格式报告，返回两个文件路径。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md_path.write_text(render_report_markdown(report), encoding="utf-8")
    return json_path, md_path
