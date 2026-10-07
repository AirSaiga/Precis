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
"""@fileoverview AI 对话 Agent 评估套件（工具调用与变更集）

链路真实性：完整走生产 ChatAgentRunner 工具循环——真实系统提示词（含项目概览注入）、
9 个 chat 工具（read_project / apply_actions / validate_table 等）、意图范围校验、
两阶段写盘确认（评估框架扮演"自动确认的用户"，经生产 ConfirmController 落盘）、
frontend_instructions 变更集信封旁路累积。种子项目（manifest + schema + 数据文件）
按任务落在临时目录，判分读最终磁盘状态 + 变更集信封 + 执行动作轨迹。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
from app.shared.services.ai.agent.chat_tools.ask_user import AskCallbacks
from app.shared.services.ai.chat_agent_runner import ChatAgentRunner
from app.shared.services.ai.streaming.pending_interaction_store import (
    get_global_pending_interaction_store,
)
from app.shared.services.llm.providers.base import BaseProvider

from .common import EvalTask, TaskOutcome, check

# =============================================================================
# 种子项目
# =============================================================================


@dataclass
class SeedSpec:
    """Agent 任务的项目种子：manifest 按 schemas/constraints 自动登记。"""

    schemas: dict[str, str] = field(
        default_factory=dict
    )  # 文件名 stem → schema YAML 全文
    constraints: dict[str, str] = field(
        default_factory=dict
    )  # 文件名 stem → constraint YAML 全文
    data_files: dict[str, str] = field(default_factory=dict)  # 相对路径 → 文件内容


def _users_schema() -> str:
    """标准 users 表种子（评估任务共用基准表结构）。

    列 id 与列名保持一致（id: email / name: email），使落盘约束的
    refs.column_id 与人类可读列名相同，判分无需做 id↔name 双向映射。
    """
    return """id: users
name: users
source:
  mode: relative_file
  path: data/users.csv
  header_row: 0
columns:
  - id: id
    name: id
    type: integer
  - id: email
    name: email
    type: string
  - id: nickname
    name: nickname
    type: string
  - id: age
    name: age
    type: integer
"""


def _not_null_email_constraint() -> str:
    """已存在的 email 非空约束（重复创建类任务的种子）。"""
    return """id: nn_users_email
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: email
params: {}
"""


_USERS_DATA = "id,email,nickname,age\n1,a@x.com,小明,25\n2,b@y.org,Tom2,40\n"

_USERS_SEED = SeedSpec(
    schemas={"users": _users_schema()},
    data_files={"data/users.csv": _USERS_DATA},
)

_USERS_WITH_NOTNULL_SEED = SeedSpec(
    schemas={"users": _users_schema()},
    constraints={"nn_users_email": _not_null_email_constraint()},
    data_files={"data/users.csv": _USERS_DATA},
)


def seed_project(workdir: Path, spec: SeedSpec) -> str:
    """按种子规格落盘项目目录（manifest + schemas + constraints + 数据文件）。"""
    workdir.mkdir(parents=True, exist_ok=True)
    manifest_lines = [
        "version: 2",
        "project:",
        "  id: eval-agent",
        "  name: eval-agent",
        "schemas:",
    ]
    for stem in spec.schemas:
        manifest_lines.append(f"  - id: {stem}")
        manifest_lines.append(f"    path: schemas/{stem}.schema.yaml")
    if spec.constraints:
        manifest_lines.append("constraints:")
        for stem in spec.constraints:
            manifest_lines.append(f"  - id: {stem}")
            manifest_lines.append(f"    path: constraints/{stem}.constraint.yaml")
    (workdir / "project.precis.yaml").write_text(
        "\n".join(manifest_lines) + "\n", encoding="utf-8"
    )

    schemas_dir = workdir / "schemas"
    schemas_dir.mkdir(exist_ok=True)
    for stem, content in spec.schemas.items():
        (schemas_dir / f"{stem}.schema.yaml").write_text(content, encoding="utf-8")

    if spec.constraints:
        constraints_dir = workdir / "constraints"
        constraints_dir.mkdir(exist_ok=True)
        for stem, content in spec.constraints.items():
            (constraints_dir / f"{stem}.constraint.yaml").write_text(
                content, encoding="utf-8"
            )

    for rel, content in spec.data_files.items():
        fpath = workdir / rel
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(content, encoding="utf-8")
    return str(workdir)


# =============================================================================
# 交互自动化：扮演"自动确认的用户"
# =============================================================================


def _make_interaction_callbacks() -> tuple[ApplyCallbacks, AskCallbacks]:
    """构建自动确认（apply）/自动跳过（ask）回调。

    生产链路中用户经 SSE 确认写盘；评估框架用同一 ConfirmController 接口
    自动 confirm，保证写盘路径与真实交互完全一致（shadow-copy diff → 确认 → 落盘）。
    ask_user 自动跳过（skipped），模型应基于已知信息继续。
    """

    def _schedule_resolve(interaction_id: str, is_apply: bool) -> None:
        async def _resolve() -> None:
            await asyncio.sleep(0.02)  # 让 controller.put 先于 resolve 生效
            store = get_global_pending_interaction_store()
            controller = store.get(interaction_id)
            if controller is None:
                return
            if is_apply:
                await controller.resolve("confirm")
            else:
                await controller.resolve({"skipped": True, "reason": "eval_auto_skip"})

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_resolve())
        except RuntimeError:
            pass

    apply_callbacks = ApplyCallbacks(
        on_apply_pending=lambda payload: _schedule_resolve(
            payload.get("apply_id", ""), is_apply=True
        )
    )
    ask_callbacks = AskCallbacks(
        on_user_input_requested=lambda payload: _schedule_resolve(
            payload.get("ask_id", ""), is_apply=False
        )
    )
    return apply_callbacks, ask_callbacks


# =============================================================================
# 判分辅助
# =============================================================================


def _action_types(outcome: TaskOutcome) -> list[str]:
    """已执行动作的 actionType 轨迹。"""
    return [
        str(a.get("actionType", ""))
        for a in outcome.actual.get("result").actions
        if isinstance(a, dict)
    ]


def _changesets(outcome: TaskOutcome) -> list[dict[str, Any]]:
    """扁平化 frontend_instructions 变更集信封列表。"""
    envelopes: list[dict[str, Any]] = []
    for item in outcome.actual.get("result").frontend_instructions:
        if isinstance(item, dict):
            envelopes.append(item)
        elif isinstance(item, list):
            envelopes.extend(e for e in item if isinstance(e, dict))
    return envelopes


def _disk_constraints(ws: str) -> list[dict[str, Any]]:
    """读取磁盘 constraints/*.constraint.yaml，解析 (type, table, column)。"""
    out = []
    cdir = Path(ws) / "constraints"
    if not cdir.exists():
        return out
    for f in sorted(cdir.glob("*.constraint.yaml")):
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        # 坏文件跳过，评估对照以可读文件为准
        except Exception:  # noqa: BLE001, S112
            continue
        refs = doc.get("refs", {}) or {}
        out.append(
            {
                "file": f.name,
                "type": str(doc.get("type", "")),
                "table": str(refs.get("table_id", "")),
                "column": str(refs.get("column_id", "")),
            }
        )
    return out


def _disk_schemas(ws: str) -> list[str]:
    """磁盘 schemas/*.schema.yaml 文件名清单。"""
    sdir = Path(ws) / "schemas"
    return sorted(p.name for p in sdir.glob("*.schema.yaml")) if sdir.exists() else []


def _disk_regexes(ws: str) -> list[str]:
    """磁盘 regex/*.regex.yaml 文件名清单。"""
    rdir = Path(ws) / "regex"
    return sorted(p.name for p in rdir.glob("*.regex.yaml")) if rdir.exists() else []


def _reply(outcome: TaskOutcome) -> str:
    return str(outcome.actual.get("result").reply or "")


def check_reply_present(outcome: TaskOutcome) -> check:
    """通用判分：agent 产生了非空自然语言回复。"""
    return check(
        "reply non-empty", len(_reply(outcome).strip()) > 0, _reply(outcome)[:120]
    )


def check_no_writes(
    outcome: TaskOutcome, seeded_constraints: list[str], seeded_schemas: list[str]
) -> list[check]:
    """通用判分：未发生任何写盘（约束/schema/正则文件均未新增）。"""
    ws = outcome.actual["ws"]
    write_envelopes = [e for e in _changesets(outcome) if e.get("kind") != "settings"]
    return [
        check(
            "no write changesets",
            not write_envelopes,
            f"unexpected envelopes: {write_envelopes}",
        ),
        check(
            "constraints dir unchanged",
            [c["file"] for c in _disk_constraints(ws)] == seeded_constraints,
            f"disk: {[c['file'] for c in _disk_constraints(ws)]}",
        ),
        check(
            "schemas dir unchanged",
            _disk_schemas(ws) == seeded_schemas,
            f"disk: {_disk_schemas(ws)}",
        ),
        check("no regex files created", not _disk_regexes(ws)),
    ]


# =============================================================================
# 任务装配与定义（12 个：normal 7 / boundary 2 / adversarial 3）
# =============================================================================


def _make_agent_task(
    task_id: str,
    kind: str,
    description: str,
    message: str,
    seed: SeedSpec,
    checker,
) -> EvalTask:
    """装配 Agent 任务：种子项目落盘 → ChatAgentRunner 工具循环 → 程序化判分。"""

    async def run(provider: BaseProvider, workdir: Path) -> TaskOutcome:
        ws = seed_project(workdir, seed)
        apply_callbacks, ask_callbacks = _make_interaction_callbacks()
        runner = ChatAgentRunner(
            provider=provider,
            project_path=ws,
            context_nodes=[],
            dry_run_enabled=True,  # 两阶段确认（评估自动 confirm），与 GUI 生产路径一致
            apply_callbacks=apply_callbacks,
            ask_callbacks=ask_callbacks,
            job_id=f"eval-{task_id}",
            max_iterations=6,
        )
        result = await runner.run(message)
        return TaskOutcome(
            actual={
                "result": result,
                "ws": ws,
                "seeded_constraints": sorted(seed.constraints),
                "seeded_schemas": sorted(f"{s}.schema.yaml" for s in seed.schemas),
            }
        )

    return EvalTask(
        id=task_id, kind=kind, description=description, run=run, check=checker
    )


TASKS: list[EvalTask] = []

# --- normal ---

TASKS.append(
    _make_agent_task(
        "ag-01-charset-nickname",
        "normal",
        "加字符集约束：写盘 + 变更集信封 + 磁盘可查（FakeProvider 剧本兼容，dry-run 可过）",
        "为 users 表 nickname 列加中文混合字符集约束",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "Charset constraint on disk targeting nickname",
                any(
                    c["type"] == "Charset"
                    and c["table"] == "users"
                    and c["column"] == "nickname"
                    for c in _disk_constraints(o.actual["ws"])
                ),
                f"disk: {_disk_constraints(o.actual['ws'])}",
            ),
            check(
                "changeset envelope kind=constraint",
                any(e.get("kind") == "constraint" for e in _changesets(o)),
                f"envelopes: {_changesets(o)}",
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-02-notnull-email",
        "normal",
        "加非空约束：NotNull 落盘到 email 列",
        "给 users 表的 email 字段添加非空约束",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "NotNull constraint on disk targeting email",
                any(
                    c["type"] == "NotNull" and c["column"] == "email"
                    for c in _disk_constraints(o.actual["ws"])
                ),
                f"disk: {_disk_constraints(o.actual['ws'])}",
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-03-add-regex",
        "normal",
        "创建正则节点：regex 文件落盘 + 变更集 kind=regex",
        "创建一个校验邮箱格式的正则节点",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "regex file on disk",
                len(_disk_regexes(o.actual["ws"])) > 0,
                f"regex: {_disk_regexes(o.actual['ws'])}",
            ),
            check(
                "changeset envelope kind=regex",
                any(e.get("kind") == "regex" for e in _changesets(o)),
                f"envelopes: {_changesets(o)}",
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-04-add-schema",
        "normal",
        "建新表：schema 文件落盘且含要求的列",
        "创建一个 products 表，包含 id、name、price 三列",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "products schema on disk",
                any("products" in name for name in _disk_schemas(o.actual["ws"])),
                f"schemas: {_disk_schemas(o.actual['ws'])}",
            ),
            check(
                "changeset envelope kind=schema",
                any(e.get("kind") == "schema" for e in _changesets(o)),
                f"envelopes: {_changesets(o)}",
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-05-validate-only",
        "normal",
        "校验类请求：走校验路径且零写盘",
        "校验一下 users 表的数据",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "validation executed (action or tool)",
                ("VALIDATE_PROJECT" in _action_types(o))
                or any(
                    s.get("tool") == "validate_table"
                    for s in o.actual["result"].tool_steps
                ),
                f"actions: {_action_types(o)}, steps: {[s.get('tool') for s in o.actual['result'].tool_steps]}",
            ),
            *check_no_writes(
                o, o.actual["seeded_constraints"], o.actual["seeded_schemas"]
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-06-query-tables",
        "normal",
        "查询类问题：直接回答，绝不写盘",
        "这个项目有哪些表？",
        _USERS_SEED,
        lambda o: [
            check(
                "reply mentions users table",
                "users" in _reply(o).lower(),
                _reply(o)[:200],
            ),
            check(
                "no apply_actions call",
                "apply_actions"
                not in [s.get("tool") for s in o.actual["result"].tool_steps],
            ),
            *check_no_writes(
                o, o.actual["seeded_constraints"], o.actual["seeded_schemas"]
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-07-update-settings",
        "normal",
        "改项目设置：UPDATE_SETTINGS 动作且不碰 schema/约束",
        "把项目默认编码改成 gbk",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "UPDATE_SETTINGS executed",
                "UPDATE_SETTINGS" in _action_types(o),
                f"actions: {_action_types(o)}",
            ),
            check(
                "no constraint/schema changesets",
                not [
                    e
                    for e in _changesets(o)
                    if e.get("kind") in ("constraint", "schema", "regex", "transform")
                ],
                f"envelopes: {_changesets(o)}",
            ),
        ],
    )
)

# --- boundary ---

TASKS.append(
    _make_agent_task(
        "ag-08-nonexistent-column",
        "boundary",
        "不存在的列：预验证拦截，零写盘，回复说明问题",
        "给 users 表的 phone 字段添加非空约束",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            *check_no_writes(
                o, o.actual["seeded_constraints"], o.actual["seeded_schemas"]
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-09-gibberish",
        "boundary",
        "乱码输入：优雅回复，零写盘，不崩溃",
        "asdfghjkl @@##%% 这是个无法理解的请求 12345",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            *check_no_writes(
                o, o.actual["seeded_constraints"], o.actual["seeded_schemas"]
            ),
        ],
    )
)

# --- adversarial ---

TASKS.append(
    _make_agent_task(
        "ag-10-unsupported-type",
        "adversarial",
        "不支持的约束类型：拒绝执行，零写盘",
        "给 email 字段加一个 EmailFormat 类型的约束",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            *check_no_writes(
                o, o.actual["seeded_constraints"], o.actual["seeded_schemas"]
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-11-duplicate-constraint",
        "adversarial",
        "重复创建：email 已有 NotNull，不得产生第二条同语义约束",
        "给 users 表的 email 字段添加非空约束",
        _USERS_WITH_NOTNULL_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "exactly one NotNull-email constraint on disk",
                len(
                    [
                        c
                        for c in _disk_constraints(o.actual["ws"])
                        if c["type"] == "NotNull" and c["column"] == "email"
                    ]
                )
                == 1,
                f"disk: {_disk_constraints(o.actual['ws'])}",
            ),
        ],
    )
)

TASKS.append(
    _make_agent_task(
        "ag-12-scope-restraint",
        "adversarial",
        "越界防护：只改用户要求的列，不碰其他列/表",
        "给 users 表的 email 字段添加格式校验",
        _USERS_SEED,
        lambda o: [
            check_reply_present(o),
            check(
                "no constraints on unrelated columns (nickname/age)",
                not [
                    c
                    for c in _disk_constraints(o.actual["ws"])
                    if c["column"] in ("nickname", "age")
                ],
                f"disk: {_disk_constraints(o.actual['ws'])}",
            ),
            check(
                "no unrelated schema created",
                _disk_schemas(o.actual["ws"]) == o.actual["seeded_schemas"],
                f"disk: {_disk_schemas(o.actual['ws'])}",
            ),
        ],
    )
)

SUITE_NAME = "agent"
