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
# backend/app/cli/shell/commands/ai/stream_renderer.py
"""
@fileoverview CLI 终端流式渲染器（AI agent 聊天）

功能概述:
- 把 ChatAgentRunner 的流式回调（on_chunk/on_turn/on_tool_call/on_tool_result）渲染到终端
- LLM 文本逐字增量打印（flush 即时），工具调用/结果打紧凑单行状态
- 首个内容事件到达后永久停掉 spinner——流式反馈本身即"进行中"提示

渲染协调（三个交互点）:
- spinner: 首个 chunk / 工具事件停掉 spinner（spinner.stop 的清行序列会从行首覆盖，
  调用前必须保证光标已落在干净行首，否则抹掉未换行的流式文本）
- 交互提示（两阶段确认 / ask_user）: 提示在工具执行期触发，而 on_tool_call 先于工具执行
  收尾换行，故提示出现时流式文本已完整落行，不粘连
- 工具轨迹: 流式期间只给轻量单行状态；循环结束后的 _display_tool_trail 总结保留，
  两者角色不同（实时进度 vs 结束审计），不视为重复

输入示例:
    renderer = ChatStreamRenderer(spinner=spinner, interactive=True)
    options = ChatOptions(..., agent_stream_callbacks=renderer.callbacks())

输出示例:
    → 调用工具 修改配置...
    ✓ 修改配置 完成
    已为 users.nickname 创建 chinese_mixed 字符集约束。
"""

from __future__ import annotations

import sys
from typing import Any, TextIO

from app.cli.shell.commands.ai.executor_utils import SpinnerController
from app.cli.shell.formatter import Formatter

# 交互模式工具失败错误信息截断上限：单行状态不刷屏（完整 error 由结束后的
# _display_tool_trail 展示）；非交互模式 stderr 是唯一诊断通道（工具轨迹不运行），不截断
_MAX_ERROR_CHARS = 60

# 工具名 → 中文标签缓存（单一事实源：ChatAgentRunner._TOOL_LABELS；
# 延迟导入避免 CLI 启动时把 agent 工具链全部加载进 import 图）
_TOOL_LABELS: dict[str, str] | None = None


def _tool_label(name: str) -> str:
    """取工具的中文展示标签，未知工具回退原始名。"""
    global _TOOL_LABELS
    if _TOOL_LABELS is None:
        from app.shared.services.ai.chat_agent_runner import ChatAgentRunner

        _TOOL_LABELS = dict(ChatAgentRunner._TOOL_LABELS)
    return _TOOL_LABELS.get(name, name)


def _print_to(stream: TextIO, text: str, end: str = "\n") -> None:
    """向流打印；GBK 等本地编码管道下遇不可编码字符（✓/✗、emoji）降级替换输出。

    流式渲染发生在对话运行中途，一次编码异常会击穿整个 agent 循环——
    真实控制台（Windows console IO）不受影响，重定向/管道场景必须兜底。
    """
    try:
        print(text, end=end, file=stream, flush=True)
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "utf-8"
        fallback = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
        print(fallback, end=end, file=stream, flush=True)


class ChatStreamRenderer:
    """Agent 流式回调 → 终端渲染适配器。

    经 ChatOptions.agent_stream_callbacks 注入，由编排器转交给
    ChatAgentRunner.configure_callbacks；回调在事件循环协程内同步触发，
    仅做 print，无阻塞操作。

    Attributes:
        _spinner: 交互模式的 spinner 控制器（None 表示无动画）
        _interactive: 是否交互模式（决定错误信息截断策略）
        _status_stream: 过程状态（工具行/轮次分隔）输出流；非交互模式走 stderr，
            保证 `ai ask` 管道场景 stdout 只含回复正文
        _started: 首个内容事件已处理（spinner 已永久停止）
        _pending_newline: 当前行有未收尾的流式文本
        _turn_text: 最近一轮已流式打印的累积文本（判定最终回复是否已上屏）
    """

    def __init__(
        self,
        spinner: SpinnerController | None = None,
        interactive: bool = True,
    ) -> None:
        self._spinner = spinner
        self._interactive = interactive
        self._status_stream = sys.stdout if interactive else sys.stderr
        self._started = False
        self._pending_newline = False
        self._turn_text = ""

    def callbacks(self) -> dict[str, Any]:
        """构造注入 ChatOptions.agent_stream_callbacks 的回调字典。"""
        return {
            "on_chunk": self.on_chunk,
            "on_turn": self.on_turn,
            "on_tool_call": self.on_tool_call,
            "on_tool_result": self.on_tool_result,
        }

    def _stop_spinner_once(self) -> None:
        """首个内容事件到达后永久停掉 spinner（此后流式事件接管反馈）。"""
        if self._started:
            return
        self._started = True
        if self._spinner:
            self._spinner.stop()

    def _terminate_line(self) -> None:
        """收尾未换行的流式文本行，保证后续行式输出不粘连。"""
        if self._pending_newline:
            _print_to(sys.stdout, "")
            self._pending_newline = False

    def on_chunk(self, text: str) -> None:
        """LLM 文本增量：停 spinner 后逐字打印（不主动换行，随流自然收尾）。"""
        self._stop_spinner_once()
        if not text:
            return
        self._turn_text += text
        _print_to(sys.stdout, text, end="")
        self._pending_newline = not text.endswith("\n")

    def on_turn(self, turn: int) -> None:
        """轮次开始：重置本轮累积文本，仅在已有内容输出后打一个空行分隔（克制使用）。"""
        self._turn_text = ""
        if turn < 2 or not self._started:
            return
        self._terminate_line()
        _print_to(self._status_stream, "")

    def on_tool_call(self, name: str, call_id: str, turn: int) -> None:
        """工具调用开始：收尾流式文本行（先于停 spinner，见模块注释）后打单行状态。"""
        self._terminate_line()
        self._stop_spinner_once()
        _print_to(self._status_stream, Formatter.dim(f"→ 调用工具 {_tool_label(name)}..."))

    def on_tool_result(self, tr: Any) -> None:
        """工具调用结束：单行成败状态。

        失败错误信息：交互模式截断到单行上限并补 "…" 标记（完整 error 由
        _display_tool_trail 结束总结展示）；非交互模式 stderr 是唯一诊断通道
        （_display_tool_trail 不运行），不截断，仅把换行压成空格保持单行形状。
        """
        self._terminate_line()
        self._stop_spinner_once()
        label = _tool_label(tr.name)
        if tr.success:
            _print_to(self._status_stream, Formatter.success(f"✓ {label} 完成"))
        else:
            error = (tr.error or "").replace("\n", " ")
            if self._interactive and len(error) > _MAX_ERROR_CHARS:
                error = error[:_MAX_ERROR_CHARS] + "…"
            suffix = f" — {error}" if error else ""
            _print_to(self._status_stream, Formatter.error(f"✗ {label} 失败{suffix}"))

    def finish(self) -> None:
        """流结束后收尾：保证末行换行，终端留给后续输出（确认提示/轨迹/错误信息）。"""
        self._terminate_line()

    def final_reply_already_shown(self, reply: str) -> bool:
        """最终回复是否已随流式上屏。

        runner 的 reply 即最后一轮 content，而每轮 content 均由 on_chunk 逐段
        累积而来——两者完全相等说明全文已流式打印，调用方无需再整段重复输出。
        """
        return bool(reply) and reply == self._turn_text
