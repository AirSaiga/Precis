"""TUI AI 对话 service 层。

本模块是 P4（AI 对话）任务包的 service 产出：在 TUI 与 ``AIChatOrchestrator``
之间放一层薄包装，负责装配 ``ChatOptions`` 并把 TUI 的弹窗/状态条作为回调注入
orchestrator（orchestrator 本身不改）。

设计要点：
- **直接用 orchestrator**：不走 CLI 的 ``execute_ai_chat``（那层用
  ``asyncio.get_event_loop`` + spinner 把异步包装成同步，TUI 是 async 环境，
  应直接 ``await`` orchestrator）。
- **回调注入**：``ChatOptions`` 的 ``confirm_callback``/``ambiguity_resolver``/
  ``progress_callback`` 是协议槽位。本 service 不实现具体弹窗，只把调用方传入的
  可调用对象透传给 orchestrator——弹窗实现在 ``screens/chat.py`` 的 ``ModalScreen``
  里，service 保持 UI 无关、便于 mock 单测。
- **历史预算**：按 CLI executor 同款公式 ``context_window - RESERVED_OUTPUT_TOKENS``
  计算 ``max_history_tokens``，下限 4096，避免超出模型上下文窗口。

复用对象（只读 import，不修改）：
- ``AIChatOrchestrator`` / ``ChatOptions`` — app.shared.services.ai.chat_orchestrator
- ``truncate_history_by_tokens`` / ``estimate_tokens`` — app.shared.services.ai.utils
- ``get_cli_config`` — app.cli.shell.config_storage（获取 active provider）
- ``resolve_context_window`` — app.shared.services.llm.providers.base
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from app.shared.services.ai.chat_orchestrator import AIChatOrchestrator, ChatOptions
from app.shared.services.llm.providers.base import resolve_context_window

if TYPE_CHECKING:
    from app.shared.services.llm.config.models import AIProvider

logger = logging.getLogger(__name__)

# 为模型回复预留的 token 预算（与 CLI executor 保持一致）
RESERVED_OUTPUT_TOKENS = 8000
# 历史预算下限，避免 context_window 过小导致历史被截断成空
MIN_HISTORY_TOKENS = 4096


# 回调类型别名（与 ChatOptions 中的 Protocol 对应，仅用于类型注解可读性）
ConfirmCallback = Callable[[list[dict[str, Any]], str], bool]
AmbiguityResolverCallback = Callable[[list[dict[str, Any]], str], bool]
ProgressCallback = Callable[[str, str, dict | None], None]


class ChatService:
    """AI 对话 service。

    包装 ``AIChatOrchestrator``：构造时绑定一个 Provider，``chat()`` 装配
    ``ChatOptions``（含 TUI 注入的回调）后直接 ``await`` orchestrator 的
    ``execute_chat``，把结果整理为 dict 返回给屏渲染。

    设计为薄层：不做 UI 决策、不持有 UI 引用，所有交互通过回调参数外注，
    因此可在 mock 掉 orchestrator 后独立单测。

    Args:
        provider: 已配置好 api_key/base_url/model 的 ``AIProvider``。
    """

    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider
        self._orchestrator = AIChatOrchestrator(provider)

    async def chat(
        self,
        message: str,
        project_path: str | None,
        history: list[dict[str, str]] | None = None,
        context_nodes: list[dict[str, Any]] | None = None,
        *,
        on_confirm: ConfirmCallback | None = None,
        on_ambiguity: AmbiguityResolverCallback | None = None,
        on_progress: ProgressCallback | None = None,
        agent_mode: bool = True,
        max_history_tokens: int | None = None,
        max_agent_iterations: int = 5,
    ) -> dict[str, Any]:
        """执行一轮 AI 对话。

        Args:
            message: 用户输入的消息文本。
            project_path: 当前项目根路径，未打开项目时为 None（agent 模式需项目路径，
                缺失时 orchestrator 会静默降级为非 agent 路径）。
            history: 对话历史列表，每元素含 ``role``/``content``。
            context_nodes: 选中的上下文节点（schema/table），供 AI 理解项目结构。
            on_confirm: 动作确认回调（注入 TUI ModalScreen）。orchestrator 在
                预校验后、执行前调用；返回 False 则放弃执行。
            on_ambiguity: 歧义解析回调（注入 TUI ModalScreen）。orchestrator 在
                动作处理前调用；返回 False 则终止动作处理。
            on_progress: 进度回调（注入 TUI 状态条）。orchestrator 在各阶段调用。
            agent_mode: 是否启用 Agent 深度模式（默认 True）。
            max_history_tokens: 历史记录 token 上限。None 时按 provider 的
                context_window 自动计算。
            max_agent_iterations: Agent 模式最大迭代轮数，默认 5。

        Returns:
            dict，含字段：
            - ``success`` (bool)：是否成功
            - ``reply`` (str)：AI 回复文本
            - ``actions`` (list[dict])：动作列表
            - ``tool_steps`` (list[dict])：Agent 工具调用轨迹（仅 agent 模式有内容）
            - ``updated_history`` (list[dict])：更新后的历史
            - ``error`` (str | None)：失败时的错误信息
        """
        if max_history_tokens is None:
            max_history_tokens = compute_history_budget(self._provider)

        options = ChatOptions(
            history=history or [],
            max_history_tokens=max_history_tokens,
            temperature=0.1,
            enable_interactive=on_confirm is not None or on_ambiguity is not None,
            confirm_callback=on_confirm,
            ambiguity_resolver=on_ambiguity,
            progress_callback=on_progress,
            return_frontend_instructions=True,
            agent_mode=agent_mode,
            max_agent_iterations=max_agent_iterations,
            canvas_nodes=[],
        )

        result = await self._orchestrator.execute_chat(
            message=message,
            project_path=project_path,
            context_nodes=context_nodes or [],
            options=options,
        )

        return {
            "success": result.success,
            "reply": result.reply,
            "actions": result.actions,
            "tool_steps": result.tool_steps,
            "updated_history": result.updated_history,
            "error": result.error,
        }


def compute_history_budget(provider: AIProvider) -> int:
    """按 provider 的 context_window 计算历史 token 预算。

    与 CLI executor 同款公式：``context_window - RESERVED_OUTPUT_TOKENS``，
    下限 ``MIN_HISTORY_TOKENS``，确保模型回复有预留空间且历史不被截断成空。

    Args:
        provider: AIProvider 配置对象。

    Returns:
        历史记录的最大 token 数。
    """
    context_window = resolve_context_window(provider)
    return max(context_window - RESERVED_OUTPUT_TOKENS, MIN_HISTORY_TOKENS)


def get_active_provider() -> AIProvider | None:
    """获取当前活动的 LLM Provider（用于 TUI 启动对话）。

    直接调用 ``get_cli_config().get_active_provider()``，零 UI 依赖。TUI 屏在
    打开项目后调用本函数拿到 provider，再构造 ``ChatService``。

    Returns:
        当前活动的 ``AIProvider``，未配置时返回 None。
    """
    from app.cli.shell.config_storage import get_cli_config

    return get_cli_config().get_active_provider()


def build_context_nodes(message: str, project_path: str | None) -> list[dict[str, Any]]:
    """从项目 schema 文件构建 AI 上下文节点列表。

    TUI 复用 CLI 的 ``interaction.build_context_data``（纯函数，读 schemas/*.yaml
    构造 selectedNodes），抽取其中的 ``selectedNodes`` 供 orchestrator 使用。
    该函数本身无 UI，只读 schema 文件，安全 import。

    Args:
        message: 用户消息（透传给 build_context_data，仅用于上下文 dict 的 message 字段，
            对 selectedNodes 无影响）。
        project_path: 项目根路径。

    Returns:
        上下文节点列表（schema 节点，含 id/type/data）。
    """

    # 用一个最小 context 对象提供 build_context_data 所需的 project_path 属性。
    # 该函数（interaction.build_context_data）只读取 context.project_path，不依赖其它字段，
    # 故轻量包装即可，无需构造完整的 ProjectContext。
    class _Ctx:
        project_path = None

    ctx = _Ctx()
    ctx.project_path = project_path  # type: ignore[assignment]
    from app.cli.shell.commands.ai.interaction import build_context_data

    context_data = build_context_data(message, ctx)
    return context_data.get("context", {}).get("selectedNodes", [])
