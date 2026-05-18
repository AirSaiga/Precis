"""@fileoverview AI 聊天命令执行器

功能概述:
- 执行 AI 聊天命令的主入口
- 辅助函数已拆分到 executor_utils.py / diff.py / display.py
"""

from __future__ import annotations

import logging

from app.cli.shell.commands.base import CommandContext, CommandResult
from app.cli.shell.formatter import Formatter
from app.shared.services.ai.chat_orchestrator import AIChatOrchestrator, ChatOptions

from .display import _display_execution_results
from .executor_utils import (
    SpinnerController,
    _collect_all_config_files,
    _get_provider_display,
    _get_provider_with_key,
)
from .interaction import confirm_actions as base_confirm_actions
from .resolver import resolve_ambiguities as base_resolve_ambiguities

logger = logging.getLogger(__name__)


def execute_ai_chat(
    message: str,
    context: CommandContext,
    interactive: bool = False,
    history: list[dict[str, str]] | None = None,
    use_streaming: bool = True,
) -> CommandResult:
    """执行 AI 对话（统一版本）。

    这是 CLI 中执行 AI 对话的核心入口函数，负责：
    1. 检查项目是否已打开
    2. 获取并验证 Provider 配置
    3. 构建 AIChatOrchestrator 和 ChatOptions
    4. 在后台运行异步对话任务
    5. 显示结果和 diff

    Args:
        message: 用户输入的消息内容
        context: 命令上下文，必须包含打开的项目路径
        interactive: 是否为交互模式（显示 spinner、提示确认等）
        history: 对话历史记录列表，每个元素包含 role 和 content
        use_streaming: 是否使用流式输出（当前参数保留但默认由交互模式控制）

    Returns:
        命令执行结果，成功时 data 包含 reply、actions 和 frontend_instructions
    """
    if not context.is_project_open:
        return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

    project_path = context.project_path

    # 获取用于显示的 Provider 配置（脱敏，用于日志或展示）
    provider_config_display = _get_provider_display()
    if not provider_config_display:
        return CommandResult.error("没有可用的 LLM Provider 配置，请先运行 'setup' 命令配置 AI Provider")

    # 获取包含完整 API Key 的 Provider 配置（用于实际调用 API）
    provider_config = _get_provider_with_key()
    if not provider_config:
        return CommandResult.error("无法获取 Provider 配置信息")

    # 创建 AI 对话编排器，负责与 AI 模型通信
    orchestrator = AIChatOrchestrator(provider_config)

    from app.cli.shell.commands.ai.base import build_context_data

    # 构建上下文数据：提取项目中的 schema 信息作为 AI 的上下文
    context_data = build_context_data(message, context)
    context_nodes = context_data.get("context", {}).get("selectedNodes", [])

    # 创建 spinner 控制器（仅在交互模式下启用）
    spinner = SpinnerController() if interactive else None

    # 包装回调函数，在调用前暂停 spinner，调用后恢复 spinner
    # 避免 spinner 动画与用户输入提示重叠
    def confirm_actions_wrapper(actions: list[dict], reply: str) -> bool:
        if spinner:
            spinner.pause()
        try:
            return base_confirm_actions(actions, reply)
        finally:
            if spinner:
                spinner.resume()

    def ambiguity_resolver_wrapper(actions: list[dict], project_path: str) -> bool:
        if spinner:
            spinner.pause()
        try:
            return base_resolve_ambiguities(actions, project_path)
        finally:
            if spinner:
                spinner.resume()

    # 配置对话选项
    options = ChatOptions(
        history=history or [],
        max_history_tokens=120000,
        temperature=0.1,
        enable_interactive=interactive,
        return_frontend_instructions=True,
        confirm_callback=confirm_actions_wrapper if interactive else None,
        ambiguity_resolver=ambiguity_resolver_wrapper if interactive else None,
    )

    try:
        import asyncio

        # 获取或创建 asyncio 事件循环（CLI 是同步环境，需要包装异步调用）
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # 如果当前线程没有事件循环，则创建一个新的
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # 收集原始文件内容（仅在交互模式下，用于 diff 对比）
        original_files_cache = {}
        if interactive and project_path:
            original_files_cache = _collect_all_config_files(project_path)

        # 启动 spinner 动画，提示用户 AI 正在处理
        if spinner:
            spinner.start()

        # 执行 AI 对话（异步方法在同步环境中通过 run_until_complete 调用）
        result = loop.run_until_complete(
            orchestrator.execute_chat(
                message=message,
                project_path=project_path,
                context_nodes=context_nodes,
                options=options,
            )
        )

        # 停止 spinner 动画
        if spinner:
            spinner.stop()

        # 处理结果：如果失败则返回错误
        if not result.success:
            error_msg = result.error or "AI 对话失败"
            if interactive:
                print(Formatter.error(f"\n{error_msg}"))
            return CommandResult.error(error_msg)

        reply = result.reply
        actions = result.actions

        # 在交互模式下显示 AI 的文本回复
        if interactive:
            if reply:
                print(reply)

        # 在交互模式下显示执行结果和 diff
        if interactive and actions:
            _display_execution_results(result, project_path, original_files_cache)

        return CommandResult.ok(
            reply if not interactive else "",
            data={
                "reply": reply,
                "actions": actions,
                "frontend_instructions": result.frontend_instructions,
            },
        )

    except Exception as e:
        # 发生异常时确保 spinner 停止，避免动画残留
        if spinner:
            spinner.stop()

        logger.error(f"AI 对话失败: {e}", exc_info=True)
        error_msg = f"AI 对话失败: {str(e)}"

        if interactive:
            print(Formatter.error(error_msg))
            # 针对 HTTP 400 错误提供诊断提示
            if "HTTP 400" in str(e) or "Bad Request" in str(e):
                print(Formatter.warning("\n[诊断提示]"))
                print(Formatter.info("  1. 检查模型名称是否正确（如 qwen-turbo, qwen-max 等）"))
                print(Formatter.info("  2. 检查 API Key 是否有效"))
                print(Formatter.info("  3. 检查网络连接是否正常"))
                print(Formatter.info("  4. 某些模型可能不支持某些参数，尝试切换模型"))

        return CommandResult.error(error_msg)
