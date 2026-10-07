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
"""@fileoverview AI 能力评估一键运行器

用法（仓库根目录执行）：
    python evals/run_evals.py                          # 探测本机 provider，跑全部三套件
    python evals/run_evals.py --suite generation        # 只跑生成套件
    python evals/run_evals.py --dry-run                 # FakeProvider 干跑（验证框架与判分逻辑）
    python evals/run_evals.py --provider deepseek       # 指定 provider
    python evals/run_evals.py --archive-baseline        # 真实运行并归档到 evals/baselines/

输出：成功率 JSON + 人读 Markdown 摘要，默认写 evals/results/，--archive-baseline
额外归档到 evals/baselines/（首轮基线留存）。
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

# 保证可从仓库任意位置启动
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows 控制台默认 GBK：评估输出含 ✓/✗ 与中文，统一重配为 UTF-8 防编码崩溃
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from precis_evals import common
from precis_evals.agent_suite import SUITE_NAME as AGENT_SUITE
from precis_evals.agent_suite import TASKS as AGENT_TASKS
from precis_evals.generation_suite import SUITE_NAME as GEN_SUITE
from precis_evals.generation_suite import TASKS as GEN_TASKS
from precis_evals.migration_suite import SUITE_NAME as MIG_SUITE
from precis_evals.migration_suite import TASKS as MIG_TASKS

SUITES: dict[str, list] = {
    GEN_SUITE: GEN_TASKS,
    MIG_SUITE: MIG_TASKS,
    AGENT_SUITE: AGENT_TASKS,
}

RESULTS_DIR = Path(__file__).resolve().parent / "results"
BASELINES_DIR = Path(__file__).resolve().parent / "baselines"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Precis AI 能力评估运行器")
    parser.add_argument(
        "--suite",
        choices=[*SUITES.keys(), "all"],
        default="all",
        help="运行哪个套件（默认 all）",
    )
    parser.add_argument(
        "--provider", default=None, help="指定 provider id（缺省探测用户级配置）"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="FakeProvider 干跑：验证框架与判分逻辑，不调真实模型",
    )
    parser.add_argument(
        "--archive-baseline",
        action="store_true",
        help="归档本次结果到 evals/baselines/（首轮基线）",
    )
    parser.add_argument(
        "--keep-workdirs", action="store_true", help="保留任务临时工作目录（调试用）"
    )
    parser.add_argument(
        "--output-stem", default=None, help="输出文件名主干（缺省按时间戳生成）"
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()

    info = common.probe_provider(provider_id=args.provider, dry_run=args.dry_run)
    if info is None:
        if args.dry_run:
            print("内部错误：dry-run provider 构造失败", file=sys.stderr)
            return 2
        print(
            "未探测到可用 AI Provider（~/.precis/ai_providers.yaml 无带密钥条目、相关环境变量未设置）。\n"
            "请先配置 provider，或用 --dry-run 做 FakeProvider 干跑验证框架。",
            file=sys.stderr,
        )
        return 2

    mode = info.mode
    print(
        f"评估模式: {mode} | Provider: {info.provider_id} ({info.provider_type}, model={info.model})"
    )

    selected = list(SUITES.keys()) if args.suite == "all" else [args.suite]
    workroot = Path(tempfile.mkdtemp(prefix="precis-evals-"))
    suites = []
    try:
        for name in selected:
            print(f"\n=== 套件: {name}（{len(SUITES[name])} 个任务） ===")
            report = await common.run_suite(name, SUITES[name], info, workroot)
            suites.append(report)
            print(
                f"--- {name}: {report.passed}/{report.total}（成功率 {report.success_rate:.0%}）"
            )
    finally:
        if args.keep_workdirs:
            print(f"\n任务工作目录保留于: {workroot}")
        else:
            shutil.rmtree(workroot, ignore_errors=True)

    from datetime import datetime, timezone

    stem = args.output_stem or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + (
        "-dryrun" if mode == "dry-run" else f"-{info.provider_id}"
    )
    report = common.build_report_json(mode, info, suites)

    json_path, md_path = common.write_report(report, RESULTS_DIR, stem)
    print(f"\n报告已写入:\n  {json_path}\n  {md_path}")
    print(
        f"总体: {report['overall']['passed']}/{report['overall']['total']}（成功率 {report['overall']['success_rate']:.0%}）"
    )

    if args.archive_baseline:
        if mode != "real":
            print("基线归档仅对真实模型运行有效（dry-run 不归档）", file=sys.stderr)
            return 1
        baseline_json, baseline_md = common.write_report(
            report, BASELINES_DIR, f"baseline-{stem}"
        )
        print(f"基线已归档:\n  {baseline_json}\n  {baseline_md}")

    # 有任务失败返回 1（CI 可判），全部通过返回 0
    return 0 if report["overall"]["passed"] == report["overall"]["total"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
