"""TUI AI 对话屏。

P4（AI 对话）任务包的 UI 产出：完整 AI Chat 交互界面——消息流 + 输入框 +
动作确认弹窗 + 歧义解析弹窗 + 工具轨迹树 + 进度状态条。

关键设计——回调注入与线程桥接：
    ``ChatOptions.confirm_callback`` / ``ambiguity_resolver`` 是**同步**协议
    （``__call__(...) -> bool``），orchestrator 在动作处理阶段**同步调用**它们
    （``chat_orchestrator.py:508/532``，不 ``await``）。因此 TUI 注入的回调必须
    是同步可调用对象，不能是 ``async def``（否则返回协程，恒为真 → 静默确认）。

    但 TUI 的确认 UI 是 ``ModalScreen``（异步 push/dismiss）。要在同步回调里
    等待用户点击又不阻塞 Textual 事件循环（否则弹窗永不渲染），本屏把整个
    orchestrator 执行放到 **工作线程**（``asyncio.to_thread`` + 独立事件循环），
    这样：

    - 工作线程跑 orchestrator（含 httpx 异步调用，用线程内 ``asyncio.run``）；
    - 当 orchestrator 同步调用 confirm 回调时，回调在工作线程里通过
      ``app.call_from_thread`` 把"弹模态框"派发到 UI 线程，并阻塞在
      ``threading.Event`` 上等待结果；
    - UI 线程未被阻塞，正常渲染模态框；用户点击 → ``dismiss`` 回调 set 事件 →
      工作线程回调解除阻塞、返回 bool → orchestrator 继续。

    注：``agent_mode=True``（默认）路径走 ``_execute_with_agent``，**不调用**
    confirm/ambiguity 回调（agent 直接用工具 apply_actions）。这些弹窗仅在
    非 agent 路径（``agent_mode=False``）生效。本屏默认 agent 模式，弹窗作为
    非 agent 交互能力保留。

复用（只读 import）：
- ``ChatService`` — app.cli.tui.services.ai_service
- ``register_screen`` — app.cli.tui.protocols
- ``get_active_provider`` — app.cli.tui.services.ai_service（启动时取 provider）
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, Input, Label, RichLog, Static, Tree
from textual.widgets.tree import TreeNode

from app.cli.tui.protocols import register_screen
from app.cli.tui.services.ai_service import (
    ChatService,
    build_context_nodes,
    get_active_provider,
)

if TYPE_CHECKING:
    from textual.widgets.tree import Tree as TreeWidget

logger = logging.getLogger(__name__)

# 动作类型到中文描述的映射（与 CLI interaction.confirm_actions 保持一致）
_ACTION_DESC: dict[str, str] = {
    "ADD_TO_CANVAS": "显示到画布（只读）",
    "ADD_CONSTRAINT_NODE": "添加约束",
    "UPDATE_CONSTRAINT_NODE": "更新约束",
    "DELETE_CONSTRAINT_NODE": "删除约束",
    "ADD_SCHEMA": "创建表",
    "UPDATE_SCHEMA": "修改表结构",
    "DELETE_SCHEMA": "删除表",
    "ADD_REGEX": "创建正则校验",
    "UPDATE_REGEX": "更新正则校验",
    "DELETE_REGEX": "删除正则校验",
    "ADD_TRANSFORM": "创建数据转换",
    "UPDATE_TRANSFORM": "更新数据转换",
    "DELETE_TRANSFORM": "删除数据转换",
    "UPDATE_SETTINGS": "修改项目设置",
    "VALIDATE_PROJECT": "校验项目",
}

# 工具名到中文标签（与 CLI display._TOOL_LABELS 一致）
_TOOL_LABELS = {
    "read_project": "读取项目",
    "read_table": "查看数据",
    "apply_actions": "修改配置",
    "validate_table": "校验数据",
    "read_canvas": "读取画布",
}


def _format_action(action: dict[str, Any]) -> str:
    """把单个动作格式化为单行人类可读描述。

    与 CLI ``interaction.confirm_actions`` 的展示逻辑保持一致，但收敛为单行
    （TUI 弹窗空间有限，详情不展开）。

    Args:
        action: 动作 dict，含 actionType 及对应 spec。

    Returns:
        形如 "创建表: users" 的描述字符串。
    """
    action_type = action.get("actionType", "UNKNOWN")
    desc = _ACTION_DESC.get(action_type, action_type)

    if action_type == "VALIDATE_PROJECT":
        spec = action.get("constraintSpec", {})
        tables = spec.get("tables") or spec.get("tableIds")
        if tables:
            if len(tables) == 1:
                return f"校验表: {tables[0]}"
            return f"校验 {len(tables)} 张表: {', '.join(tables)}"
        table_name = spec.get("tableName", spec.get("targetNodeId"))
        return f"校验表: {table_name}" if table_name and table_name != "所有表" else "校验所有表"

    if action_type == "ADD_TO_CANVAS":
        spec = action.get("canvasSpec", {})
        return f"{desc}: {spec.get('resourceKind', '?')} / {spec.get('name', spec.get('resourceId', '?'))}"

    if action_type in ("ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"):
        spec = action.get("constraintSpec", {})
        return (
            f"{desc}: 表 {spec.get('tableName', spec.get('targetNodeId', '?'))} / "
            f"字段 {spec.get('targetColumn', spec.get('targetColumnId', '?'))} ({spec.get('type', '?')})"
        )

    if action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"):
        spec = action.get("schemaSpec", {})
        return f"{desc}: {spec.get('name', spec.get('schemaId', '?'))}"

    if action_type in ("ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"):
        spec = action.get("regexSpec", {})
        return f"{desc}: {spec.get('name', spec.get('regexId', '?'))}"

    if action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
        spec = action.get("transformSpec", {})
        return f"{desc}: {spec.get('type', '?')}"

    if action_type == "UPDATE_SETTINGS":
        spec = action.get("settingsSpec", {})
        return f"{desc}: {spec.get('category', '?')}"

    return desc


class ConfirmModal(ModalScreen[bool]):
    """动作确认模态框。

    列出 AI 计划执行的动作，用户选择"确认执行"或"取消"。作为
    ``ChatService.chat(on_confirm=...)`` 回调的 UI 实现：被调用时 push 该屏，
    用户选择后通过 ``dismiss(result)`` 返回 bool 给回调。
    """

    def __init__(self, actions: list[dict[str, Any]], reply: str) -> None:
        super().__init__()
        self._actions = actions
        self._reply = reply

    def compose(self) -> ComposeResult:
        with VerticalScroll(classes="confirm-modal"):
            yield Static("即将执行以下操作", classes="confirm-title")
            if self._reply:
                yield Static(self._reply, classes="confirm-reply")
            for i, action in enumerate(self._actions, 1):
                yield Static(f"{i}. {_format_action(action)}")
            with Horizontal(classes="confirm-buttons"):
                yield Button("确认执行", id="confirm-yes", variant="success")
                yield Button("取消", id="confirm-no", variant="error")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """按钮按下后以对应 bool 关闭模态框。"""
        self.dismiss(event.button.id == "confirm-yes")


class AmbiguityModal(ModalScreen[bool]):
    """歧义解析模态框。

    当 AI 动作涉及表名歧义时弹出，让用户决定是否继续。作为
    ``ChatService.chat(on_ambiguity=...)`` 回调的 UI 实现。
    """

    def __init__(self, actions: list[dict[str, Any]], project_path: str) -> None:
        super().__init__()
        self._actions = actions
        self._project_path = project_path

    def compose(self) -> ComposeResult:
        with VerticalScroll(classes="ambiguity-modal"):
            yield Static("检测到表名歧义", classes="confirm-title")
            yield Static(
                f"项目: {self._project_path}\n以下动作的表名存在歧义，请确认是否继续：",
                classes="confirm-reply",
            )
            for i, action in enumerate(self._actions, 1):
                yield Static(f"{i}. {_format_action(action)}")
            with Horizontal(classes="confirm-buttons"):
                yield Button("继续", id="ambiguity-yes", variant="warning")
                yield Button("取消", id="ambiguity-no", variant="default")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "ambiguity-yes")


@register_screen("chat")
class ChatScreen(Screen):
    """AI 对话主屏。

    布局：顶部进度状态条 → 中部消息流（RichLog）+ 工具轨迹树（Tree）→ 底部输入框。

    用户在输入框输入消息回车后，调用 ``ChatService.chat()`` 执行对话，
    把 reply 写入消息流、tool_steps 渲染到工具树。对话过程中，
    orchestrator 通过回调触发本屏的确认/歧义弹窗。
    """

    CSS = """
    ChatScreen {
        layout: vertical;
        padding: 0 1;
    }
    #chat-progress {
        height: 1;
        background: $panel;
        color: $text-muted;
        padding: 0 1;
        text-style: bold;
    }
    #chat-main {
        height: 1fr;
    }
    #chat-log {
        border: round $background;
        background: $surface;
        height: 2fr;
        padding: 0 1;
    }
    #chat-tree-container {
        border: round $background;
        background: $surface;
        height: 1fr;
        padding: 0 1;
        margin-top: 1;
    }
    #chat-tree-label {
        color: $text-muted;
        background: $boost;
        padding: 0 1;
        text-style: bold;
    }
    #chat-tool-tree {
        height: 1fr;
    }
    #chat-input {
        dock: bottom;
        height: 3;
        margin: 1 0 0 0;
        border: tall $background;
        background: $surface;
    }
    #chat-input:focus {
        border: tall $primary;
    }
    .confirm-modal, .ambiguity-modal {
        width: 70;
        max-width: 90%;
        height: auto;
        max-height: 80%;
        padding: 1 2;
        border: thick $primary;
        background: $surface;
    }
    .confirm-title {
        text-style: bold;
        color: $text;
        margin-bottom: 1;
    }
    .confirm-reply {
        color: $text-muted;
        margin-bottom: 1;
        background: $boost;
        padding: 0 1;
    }
    .confirm-buttons {
        height: 3;
        align-horizontal: right;
        margin-top: 1;
    }
    .confirm-buttons Button {
        margin-left: 1;
    }
    """

    BINDINGS = [
        Binding("escape", "app.pop_screen", "返回", show=True),
    ]

    def __init__(self, project_path: str | None = None, agent_mode: bool = True) -> None:
        super().__init__()
        self._project_path = project_path
        self._agent_mode = agent_mode
        self._history: list[dict[str, str]] = []
        self._service: ChatService | None = None

    # ------------------------------------------------------------------ #
    # 布局
    # ------------------------------------------------------------------ #

    def compose(self) -> ComposeResult:
        yield Static("就绪", id="chat-progress")
        with Vertical(id="chat-main"):
            yield RichLog(id="chat-log", wrap=True, markup=True, auto_scroll=True)
            with Vertical(id="chat-tree-container"):
                yield Label("工具轨迹", id="chat-tree-label")
                yield Tree("Agent 工具轨迹", id="chat-tool-tree")
        yield Input(placeholder="输入消息，回车发送…", id="chat-input")

    def on_mount(self) -> None:
        """挂载时初始化 ChatService。

        若已有活动 provider 则立即构造 service；否则提示用户先配置 provider。
        """
        provider = get_active_provider()
        if provider is None:
            self._write_log("[yellow]未检测到可用的 LLM Provider，请先在 Provider 屏配置。[/]")
            self._set_progress("无 Provider")
            return
        self._service = ChatService(provider)
        self._set_progress("就绪")
        if self._project_path:
            self._write_log(f"[dim]项目: {self._project_path}[/]")

    # ------------------------------------------------------------------ #
    # 输入处理
    # ------------------------------------------------------------------ #

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        """输入框回车：发送消息并执行对话。"""
        message = event.value.strip()
        if not message:
            return
        if self._service is None:
            self._write_log("[yellow]无可用的 Provider，无法发送消息。[/]")
            return

        # 清空输入框、写入用户消息、置忙态
        event.input.value = ""
        self._write_log(f"[bold cyan]你:[/] {message}")
        self._set_progress("AI 思考中…")
        event.input.disabled = True

        try:
            await self._run_chat(message)
        except Exception as e:  # noqa: BLE001 - UI 层兜底，避免异常穿透导致屏崩溃
            logger.error("AI 对话失败: %s", e, exc_info=True)
            self._write_log(f"[red]对话失败: {e}[/]")
        finally:
            event.input.disabled = False
            self._set_progress("就绪" if self._service is not None else "无 Provider")
            self.query_one("#chat-input", Input).focus()

    async def _run_chat(self, message: str) -> None:
        """执行一轮对话：构建上下文、注入回调、调用 service、渲染结果。

        orchestrator 执行放到工作线程（``asyncio.to_thread``），使 confirm/
        ambiguity 的同步阻塞回调不会卡死 UI 事件循环——弹窗能在 UI 线程正常
        渲染（见模块 docstring 的线程桥接说明）。
        """
        assert self._service is not None

        # 构建上下文节点（读 schemas/*.yaml）。失败不阻断对话——orchestrator
        # 在 context_nodes 为空时仍可基于 project_overview 工作。
        context_nodes: list[dict[str, Any]] = []
        if self._project_path:
            try:
                context_nodes = build_context_nodes(message, self._project_path)
            except Exception as e:  # noqa: BLE001
                logger.debug("构建上下文节点失败（不阻断对话）: %s", e)

        # 工作线程内用独立事件循环跑 async service.chat，避免同步回调阻塞 UI 循环
        result = await asyncio.to_thread(self._run_chat_blocking, message, context_nodes)

        # 更新历史（service 已从 orchestrator 回传 updated_history）
        if result.get("updated_history"):
            self._history = result["updated_history"]

        if not result.get("success"):
            err = result.get("error") or "AI 对话失败"
            self._write_log(f"[red]错误: {err}[/]")
            return

        reply = result.get("reply") or ""
        if reply:
            self._write_log(f"[bold green]AI:[/] {reply}")

        actions = result.get("actions") or []
        if actions:
            self._write_log(f"[dim]已执行 {len(actions)} 个动作[/]")

        tool_steps = result.get("tool_steps") or []
        if tool_steps:
            # 树渲染需在 UI 线程操作 widget；to_thread 返回后已在 UI 上下文
            self._render_tool_steps(tool_steps)

    def _run_chat_blocking(self, message: str, context_nodes: list[dict[str, Any]]) -> dict[str, Any]:
        """工作线程入口：用独立事件循环执行 async ``service.chat``。

        线程内 ``asyncio.run`` 创建临时循环跑 orchestrator。当 orchestrator
        同步调用 confirm/ambiguity 回调时，回调在本线程阻塞（``threading.Event``），
        UI 线程不受影响可渲染弹窗。
        """
        assert self._service is not None
        coro = self._service.chat(
            message=message,
            project_path=self._project_path,
            history=self._history,
            context_nodes=context_nodes,
            on_confirm=self._on_confirm,
            on_ambiguity=self._on_ambiguity,
            on_progress=self._on_progress,
            agent_mode=self._agent_mode,
        )
        return asyncio.run(coro)

    # ------------------------------------------------------------------ #
    # 回调（同步签名，匹配 ChatOptions 协议；注入 orchestrator）
    # ------------------------------------------------------------------ #

    def _on_progress(self, stage: str, message: str, data: dict | None = None) -> None:
        """进度回调：写入顶部状态条。

        orchestrator 在 llm_calling/parsing/validating/executing/completed 等阶段调用。
        回调是同步签名（与 ``ProgressCallback`` Protocol 一致）。进度更新对 UI
        线程的派发用 ``call_from_thread`` 兜底（工作线程内调用时安全；UI 线程
        内调用 ``call_from_thread`` 也可正常入队）。
        """
        self.app.call_from_thread(self._set_progress, message)

    def _on_confirm(self, actions: list[dict[str, Any]], reply: str) -> bool:
        """动作确认回调：弹出 ConfirmModal 等待用户选择（同步阻塞）。

        匹配 ``ConfirmCallback`` 同步协议。在工作线程内被 orchestrator 调用时，
        通过 ``call_from_thread`` 把弹窗派发到 UI 线程，本线程阻塞在
        ``threading.Event`` 上直到用户点击。
        """
        if not actions:
            return True
        return self._show_modal_sync(ConfirmModal(actions, reply))

    def _on_ambiguity(self, actions: list[dict[str, Any]], project_path: str) -> bool:
        """歧义解析回调：弹出 AmbiguityModal 等待用户选择（同步阻塞）。"""
        if not actions:
            return True
        return self._show_modal_sync(AmbiguityModal(actions, project_path))

    def _show_modal_sync(self, modal: ModalScreen[bool]) -> bool:
        """同步阻塞地展示模态框并等待用户结果。

        把模态框 push 派发到 UI 线程（``call_from_thread``），本线程阻塞在
        ``threading.Event`` 上；用户点击后 ``dismiss`` 回调 set 事件、回传 bool。

        若调用方已在 UI 线程（无独立工作线程），``call_from_thread`` 仍会把
        push 排入 UI 队列，但本线程阻塞会导致 UI 循环无法处理该队列而死锁。
        故非 agent 交互模式必须经由 ``_run_chat`` 的工作线程路径调用本回调。
        agent 模式（默认）不触发本回调，无此风险。
        """
        done = threading.Event()
        result_box: list[bool] = [False]

        def _on_result(result: bool | None) -> None:
            result_box[0] = bool(result) if result is not None else False
            done.set()

        def _push() -> None:
            self.app.push_screen(modal, _on_result)

        self.app.call_from_thread(_push)
        done.wait()
        return result_box[0]

    # ------------------------------------------------------------------ #
    # 渲染辅助
    # ------------------------------------------------------------------ #

    def _render_tool_steps(self, tool_steps: list[dict[str, Any]]) -> None:
        """把 Agent 工具调用轨迹渲染到 Tree widget。

        每个 step 是一次工具调用（read_project/apply_actions/...），
        渲染为树的一个根节点；其下的 action_count/error 等作为子节点。
        """
        tree = self.query_one("#chat-tool-tree", TreeWidget)
        # 清空已有子节点（保留根标签），避免多轮对话后树无限增长
        tree.reset("Agent 工具轨迹")
        for step in tool_steps:
            tool = step.get("tool", "未知")
            label = step.get("label") or _TOOL_LABELS.get(tool, tool)
            status = step.get("status", "success")
            action_count = step.get("action_count")
            error = step.get("error")

            marker = "[green]✓[/]" if status == "success" else "[red]✗[/]" if status == "failed" else "[dim]•[/]"
            count_str = f" ({action_count})" if action_count else ""
            node: TreeNode = tree.add_root(f"{marker} {label}{count_str}")

            node.add_leaf(f"工具: {tool}")
            if action_count:
                node.add_leaf(f"动作数: {action_count}")
            if status != "success":
                node.add_leaf(f"状态: {status}")
            if error:
                node.add_leaf(f"[red]错误: {error}[/]")
        tree.expand_all()

    def _write_log(self, text: str) -> None:
        """写入消息流 RichLog。"""
        self.query_one("#chat-log", RichLog).write(text)

    def _set_progress(self, text: str) -> None:
        """更新顶部进度状态条文本。"""
        self.query_one("#chat-progress", Static).update(text)
