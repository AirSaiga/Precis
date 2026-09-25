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

# 终端 diff 展示上限：超长 diff 只显示前 N 行，避免刷屏（完整内容在 dry-run 文件里）
_MAX_DIFF_LINES = 30


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
            decision = _read_apply_decision()
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
    """打印写盘计划摘要：文件清单 + 状态 + 截断 diff + 汇总行。"""
    files = payload.get("files") or []
    print(Formatter.warning(f"\nAI 请求写入 {len(files)} 个文件："))
    for f in files:
        status = f.get("status", "?")
        path = f.get("path", "?")
        print(f"  [{status}] {path}")
        diff = (f.get("diff") or "").strip()
        if diff:
            diff_lines = diff.splitlines()
            shown = diff_lines[:_MAX_DIFF_LINES]
            for line in shown:
                print(f"      {line}")
            if len(diff_lines) > _MAX_DIFF_LINES:
                print(f"      ...（共 {len(diff_lines)} 行，已截断）")
    summary = payload.get("summary")
    if summary:
        print(Formatter.info(f"  摘要: {summary}"))


def _read_apply_decision() -> str:
    """读取 y/n 决策；空输入与非 y 输入一律 reject（写盘默认保守）。"""
    try:
        raw = input(Formatter.warning("确认写入以上变更？[y/N]: ")).strip().lower()
    except EOFError:
        return "reject"
    return "confirm" if raw in ("y", "yes", "是") else "reject"


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
