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
"""@fileoverview Agent 模式终端交互适配器（CLI）

为 CLI `ai chat`（默认 agent 模式）提供 apply_actions 两阶段确认与 ask_user
交互问答的终端实现，解开非流式环境的 fail-closed 写盘/提问闸门。

机制与 GUI 流式路径同源：回调在事件循环协程内触发（on_apply_pending /
on_user_input_requested），此处打印摘要后在独立 daemon 线程阻塞读终端输入，
经 pending interaction store 线程安全 resolve 唤醒挂起的 await_decision() /
await_response()。超时（5 分钟）由 controller 兜底自动 reject/skip。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from app.cli.shell.commands.ai.executor_utils import SpinnerController
from app.cli.shell.formatter import Formatter
from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
from app.shared.services.ai.agent.chat_tools.ask_user import AskCallbacks

logger = logging.getLogger(__name__)

# 确认清单（动作/文件）的展示上限：超长清单只显示前 N 项 + 总数，避免刷屏；
# diff 正文不在此处展示，用户按 [d] 可查看全量内容
_MAX_LIST_ITEMS = 10


def build_agent_interaction(spinner: SpinnerController | None) -> tuple[ApplyCallbacks, AskCallbacks]:
    """构建 CLI 终端的 apply/ask 回调集合。

    参数:
        spinner: CLI 交互模式的 spinner 控制器（None 表示无动画，静默模式）

    返回:
        (ApplyCallbacks, AskCallbacks)，注入 ChatOptions 后经 ChatAgentRunner 生效
    """

    def on_apply_pending(payload: dict[str, Any]) -> None:
        # 回调在事件循环协程内同步触发，捕获运行中的 loop 供工作线程 resolve
        loop = asyncio.get_running_loop()
        apply_id = payload.get("apply_id", "")
        if spinner:
            spinner.pause()
        _print_apply_summary(payload)

        def _worker() -> None:
            decision = _read_apply_decision(payload)
            try:
                future = asyncio.run_coroutine_threadsafe(_resolve_apply(apply_id, decision), loop)
                future.result(timeout=10)
            except Exception:
                logger.exception("[agent-confirm] 终端确认 resolve 失败: apply_id=%s", apply_id)
            finally:
                if spinner:
                    spinner.resume()

        threading.Thread(target=_worker, daemon=True, name="agent-apply-confirm").start()

    def on_user_input_requested(payload: dict[str, Any]) -> None:
        loop = asyncio.get_running_loop()
        ask_id = payload.get("ask_id", "")
        if spinner:
            spinner.pause()
        _print_ask_question(payload)

        def _worker() -> None:
            response = _read_ask_response(payload)
            try:
                future = asyncio.run_coroutine_threadsafe(_resolve_ask(ask_id, response), loop)
                future.result(timeout=10)
            except Exception:
                logger.exception("[agent-ask] 终端问答 resolve 失败: ask_id=%s", ask_id)
            finally:
                if spinner:
                    spinner.resume()

        threading.Thread(target=_worker, daemon=True, name="agent-ask-input").start()

    apply_callbacks = ApplyCallbacks(on_apply_pending=on_apply_pending)
    ask_callbacks = AskCallbacks(on_user_input_requested=on_user_input_requested)
    return apply_callbacks, ask_callbacks


async def _resolve_apply(apply_id: str, decision: str) -> None:
    """按 apply_id 从全局 store 取 controller 并写入决策（幂等）。"""
    # 延迟导入与 apply_actions._run_two_phase 一致（避免 streaming 包初始化链循环导入）
    from app.shared.services.ai.streaming.pending_interaction_store import (
        ConfirmController,
        get_global_pending_interaction_store,
    )

    controller = get_global_pending_interaction_store().get(apply_id)
    if isinstance(controller, ConfirmController):
        await controller.resolve(decision)


async def _resolve_ask(ask_id: str, response: dict[str, Any]) -> None:
    from app.shared.services.ai.streaming.pending_interaction_store import (
        InteractionController,
        get_global_pending_interaction_store,
    )

    controller = get_global_pending_interaction_store().get(ask_id)
    if isinstance(controller, InteractionController):
        await controller.resolve(response)


def _print_apply_summary(payload: dict[str, Any]) -> None:
    """打印写盘计划摘要：动作语义清单 + 文件状态清单（不打印 diff 正文）。

    摘要优先——用户先确认"AI 要干什么"（动作清单），再看"动了哪些文件"；
    diff 正文体积大（新建文件即全文），改为在决策提示中按 [d] 按需查看全量。
    """
    actions = payload.get("actions") or []
    files = payload.get("files") or []

    # 动作语义清单：一行一个动作（如 "添加约束：users.email — NotNull"）
    if actions:
        print(Formatter.warning(f"\n将执行 {len(actions)} 个动作："))
        for i, action in enumerate(actions[:_MAX_LIST_ITEMS], start=1):
            description = str(action.get("description") or action.get("action_type") or "")
            print(f"  {i}. {description}")
        if len(actions) > _MAX_LIST_ITEMS:
            print(f"  ... 共 {len(actions)} 个")

    # 文件清单：状态 + 路径（无 diff 正文）
    counts = {"created": 0, "modified": 0, "deleted": 0}
    for f in files:
        status = str(f.get("status", ""))
        if status in counts:
            counts[status] += 1
    print(
        Formatter.warning(
            f"\nAI 请求写入 {len(files)} 个文件"
            f"（新增 {counts['created']}，修改 {counts['modified']}，删除 {counts['deleted']}）："
        )
    )
    for f in files[:_MAX_LIST_ITEMS]:
        print(f"  [{f.get('status', '?')}] {f.get('path', '?')}")
    if len(files) > _MAX_LIST_ITEMS:
        print(f"  ... 共 {len(files)} 个")

    summary = payload.get("summary")
    if summary:
        print(Formatter.info(f"  摘要: {summary}"))


def _print_full_diff(payload: dict[str, Any]) -> None:
    """打印全量 diff（[d] 按需查看）：payload 携带的就是完整内容，不做截断。"""
    files = payload.get("files") or []
    if not files:
        print(Formatter.info("  （无文件变更）"))
        return
    for f in files:
        print(Formatter.info(f"\n--- {f.get('path', '?')}（{f.get('status', '?')}）---"))
        diff = (f.get("diff") or "").strip()
        print(diff if diff else "  （无 diff 内容）")


def _read_apply_decision(payload: dict[str, Any]) -> str:
    """三态决策循环：y 确认写入 / d 查看全量 diff 后回到提示 / 其余（含空输入）拒绝。

    空输入与非 y 输入一律 reject（写盘默认保守），与旧版语义一致。
    """
    while True:
        try:
            raw = (
                input(Formatter.warning("确认写入以上变更？[y]确认写入 / [d]查看详细 diff / [N]拒绝: ")).strip().lower()
            )
        except EOFError:
            return "reject"
        if raw in ("y", "yes", "是"):
            return "confirm"
        if raw in ("d", "diff", "查看"):
            _print_full_diff(payload)
            continue
        return "reject"


def _print_ask_question(payload: dict[str, Any]) -> None:
    print(Formatter.warning(f"\nAI 提问: {payload.get('prompt', '')}"))
    options = payload.get("options")
    if isinstance(options, list) and options:
        for idx, opt in enumerate(options, start=1):
            _, text = _split_option(opt)
            print(f"  {idx}. {text}")
    if payload.get("optional"):
        print(Formatter.info("  （直接回车跳过此问题）"))


def _split_option(opt: Any) -> tuple[str, str]:
    """解析单个选项为 (value, 展示文本)。

    ask_user 工具 schema 声明 options 为 {label, value, description?} 对象；
    纯字符串形态（历史/测试用例）兼容处理，value 即字符串本身。
    """
    if isinstance(opt, dict):
        value = str(opt.get("value", opt.get("label", "")))
        label = str(opt.get("label", value))
        desc = str(opt.get("description") or "")
        text = f"{label} — {desc}" if desc else label
        return value, text
    return str(opt), str(opt)


def _read_ask_response(payload: dict[str, Any]) -> dict[str, Any]:
    """按 question_type 读取终端回答，构造 AskResponseBody 形态。

    形态与前端 AskUserCard 一致：{answer: str|num|bool|str[]} / {skipped: true, reason}。
    """
    question_type = payload.get("question_type", "free_text")
    optional = bool(payload.get("optional"))
    try:
        if question_type == "confirm":
            raw = input("[y/N]: ").strip().lower()
            return {"answer": raw in ("y", "yes", "是")}
        if question_type == "choice":
            options = payload.get("options") or []
            raw = input(("(多选，逗号分隔) " if payload.get("multiple") else "") + "选项编号: ").strip()
            if not raw and optional:
                return {"skipped": True, "reason": "user_skipped"}
            indexes = [part.strip() for part in raw.split(",") if part.strip()]
            picked: list[str] = []
            for part in indexes:
                if part.isdigit() and 1 <= int(part) <= len(options):
                    # 按编号选中：回灌选项的 value 字段（与前端 AskUserCard 契约一致）
                    picked.append(_split_option(options[int(part) - 1])[0])
                else:
                    picked.append(part)
            if payload.get("multiple"):
                return {"answer": picked}
            return {"answer": picked[0] if picked else ""}
        if question_type == "value":
            value_type = payload.get("value_type", "string")
            raw = input(f"输入值({value_type}): ").strip()
            if not raw and optional:
                return {"skipped": True, "reason": "user_skipped"}
            if value_type in ("integer", "float"):
                try:
                    return {"answer": float(raw) if value_type == "float" else int(raw)}
                except ValueError:
                    return {"answer": raw}
            if value_type == "boolean":
                return {"answer": raw.lower() in ("y", "yes", "true", "1", "是")}
            return {"answer": raw}
        # free_text
        raw = input("回答: ").strip()
        if not raw and optional:
            return {"skipped": True, "reason": "user_skipped"}
        return {"answer": raw}
    except EOFError:
        return {"skipped": True, "reason": "eof"}
