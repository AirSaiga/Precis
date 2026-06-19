"""@fileoverview AI Chat 统一编排服务模块

功能概述:
- 为前端 API 和 CLI 提供统一的 AI Chat 底层能力
- 管理对话历史、上下文构建、响应解析与动作执行
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from app.shared.services.llm.actions.action_parser import (
    ActionParseError,
    ActionParser,
    process_actions,
)
from app.shared.services.llm.actions.action_validator import ActionValidator
from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt
from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest

logger = logging.getLogger(__name__)


# =============================================================================
# 回调协议（用于 CLI 交互）
# =============================================================================


class ConfirmCallback(Protocol):
    """操作确认回调协议"""

    def __call__(self, actions: list[dict[str, Any]], reply: str) -> bool: ...


class AmbiguityResolverCallback(Protocol):
    """歧义解析回调协议"""

    def __call__(self, actions: list[dict[str, Any]], project_path: str) -> bool: ...


class ProgressCallback(Protocol):
    """进度通知回调协议"""

    def __call__(self, stage: str, message: str, data: dict | None = None) -> None: ...


# =============================================================================
# 数据类
# =============================================================================


@dataclass
class ChatOptions:
    """Chat 执行选项"""

    # 对话相关
    history: list[dict[str, str]] = field(default_factory=list)
    max_history_tokens: int = 120000
    temperature: float = 0.1

    # 交互相关（CLI 使用）
    enable_interactive: bool = False
    confirm_callback: ConfirmCallback | None = None
    ambiguity_resolver: AmbiguityResolverCallback | None = None
    progress_callback: ProgressCallback | None = None
    pause_callback: Callable[[], None] | None = None

    # 功能开关
    skip_action_validation: bool = False
    skip_action_processing: bool = False
    return_frontend_instructions: bool = True
    agent_mode: bool = False
    max_agent_iterations: int = 3


@dataclass
class ChatExecutionResult:
    """Chat 执行结果"""

    success: bool
    reply: str
    actions: list[dict[str, Any]] = field(default_factory=list)
    frontend_instructions: list[Any] = field(default_factory=list)
    error: str | None = None
    updated_history: list[dict[str, str]] = field(default_factory=list)
    validation_result: dict[str, Any] | None = None
    action_results: list[dict[str, Any]] = field(default_factory=list)  # 动作执行结果
    iterations: int = 0  # Agent 模式下的实际迭代轮数
    tool_steps: list[dict[str, Any]] = field(default_factory=list)  # Agent 工具调用轨迹


# =============================================================================
# 核心编排器
# =============================================================================


class AIChatOrchestrator:
    """
    @classdesc AI Chat 统一编排器

    职责：
    1. 统一处理 API 和 CLI 的 AI Chat 请求
    2. 管理对话历史和 Token 截断
    3. 处理动作验证、歧义解析、执行
    4. 生成前端渲染指令
    """

    def __init__(self, provider: AIProvider):
        """
        初始化编排器

        Args:
            provider: AIProvider 配置对象（包含 api_key、base_url、model 等信息）
        """
        self._provider = provider

    async def execute_chat(
        self,
        message: str,
        project_path: str | None,
        context_nodes: list[dict[str, Any]],
        options: ChatOptions | None = None,
    ) -> ChatExecutionResult:
        """
        @methoddesc 执行 AI Chat（统一入口）

        完整处理流程：
        1. 构建上下文数据和系统提示词
        2. 组装消息列表（含历史截断）
        3. 调用 LLM 获取回复
        4. 解析响应中的 reply 和 actions
        5. 更新对话历史
        6. 如需则执行动作（歧义解析 → 预验证 → 执行 → 收集前端指令）

        参数:
            message: 用户输入的消息文本
            project_path: 项目路径（用于读取 schema、执行动作），可为 None
            context_nodes: 前端选中的上下文节点列表
            options: Chat 执行选项，None 则使用默认选项

        返回:
            ChatExecutionResult: 包含回复、动作、执行结果等的完整结果
        """
        options = options or ChatOptions()

        # =====================================================================
        # Agent 模式：走真正的工具循环（read/apply/validate 四件套）
        # 与下方旧路径（LLM 直接输出 {reply,actions}）互斥，提前返回
        # =====================================================================
        if options.agent_mode and project_path:
            return await self._execute_with_agent(message, project_path, context_nodes, options)

        # 请求了 agent 模式但没有 project_path：无法运行工具循环，静默降级到旧路径。
        # 记一条 warning 方便排查"为什么 agent 模式没生效"（如配置路径未透传）。
        if options.agent_mode and not project_path:
            logger.warning("agent_mode=True 但 project_path 为空，降级为非 agent 路径")

        # 步骤 1: 构建上下文数据（项目概览 + 选中节点）
        context_data = self._build_context_data(message, context_nodes, project_path)
        system_prompt = build_system_prompt(context_data)

        # 步骤 2: 构建消息列表（系统提示 + 截断历史 + 当前用户消息）
        messages = self._build_messages(
            system_prompt=system_prompt,
            history=options.history,
            user_message=message,
            max_tokens=options.max_history_tokens,
        )

        # 步骤 3: 调用 LLM
        # 直接 await provider.chat()，与 agent 路径（_execute_with_agent / agent/executor.py）对齐。
        # 不再走 ChatLLMService 同步包装层 —— 后者在 async 上下文里会开子线程跑 asyncio.run()，
        # 导致 httpx 连接池清理任务绑定到子线程的临时 loop，loop 关闭后泄漏
        # "Task exception was never retrieved: RuntimeError: Event loop is closed"。
        # create 用延迟导入，与 _execute_with_agent 一致，方便测试 patch providers.create。
        self._notify_progress(options, "llm_calling", "正在调用 AI...")
        try:
            from app.shared.services.llm.providers import create

            provider = create(self._provider)
            chat_messages = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]
            req = ChatRequest(
                messages=chat_messages,
                model=self._provider.model,
                temperature=options.temperature,
            )
            resp = await provider.chat(req)
            # resp.content 类型为 str | None（空响应场景），空字符串兜底交给后续解析阶段处理
            llm_response = resp.content or ""
        except Exception as e:
            logger.error(f"LLM 调用失败: {e}")
            return ChatExecutionResult(success=False, reply="", error=f"AI 服务调用失败: {str(e)}")

        # 步骤 4: 解析响应（提取 reply 和 actions）
        self._notify_progress(options, "parsing", "解析 AI 响应...")
        parsed = self._parse_llm_response(llm_response)

        if not parsed["valid"]:
            return ChatExecutionResult(
                success=False, reply=parsed.get("reply", ""), error=parsed.get("error", "解析响应失败")
            )

        reply = parsed.get("reply", "")
        actions = parsed.get("actions", []) or []

        # 步骤 5: 更新历史（供 CLI 多轮对话使用）
        updated_history = self._update_history(options.history, message, reply)

        # 步骤 6: 处理动作（如果存在且项目路径有效）
        frontend_instructions: list[Any] = []
        validation_result: dict | None = None
        action_results: list[dict[str, Any]] = []

        if actions and project_path and not options.skip_action_processing:
            actions, validation_result, action_results, frontend_instructions = self._process_actions(
                actions, project_path, reply, options, updated_history
            )
            if isinstance(actions, ChatExecutionResult):
                return actions

        # 非 agent 模式：process_actions 执行后直接返回（不再有 agent followup）
        return ChatExecutionResult(
            success=True,
            reply=reply,
            actions=actions,
            frontend_instructions=frontend_instructions,
            updated_history=updated_history,
            validation_result=validation_result,
            action_results=action_results,
        )

    def _build_context_data(
        self,
        message: str,
        context_nodes: list[dict[str, Any]],
        project_path: str | None,
    ) -> dict[str, Any]:
        """
        @methoddesc 构建 AI 所需的上下文数据字典

        包含用户消息、是否有选中节点、节点详情以及项目概览。

        参数:
            message: 用户原始消息
            context_nodes: 前端选中的节点列表
            project_path: 项目路径

        返回:
            上下文数据字典
        """
        from app.shared.services.ai.utils import get_project_overview

        # 如果项目路径存在，扫描项目结构生成概览
        project_overview = {}
        if project_path:
            project_overview = get_project_overview(project_path)

        return {
            "message": message,
            "context": {
                "hasContext": len(context_nodes) > 0,
                "selectedNodes": context_nodes,
            },
            "projectOverview": project_overview,
        }

    def _build_messages(
        self,
        system_prompt: str,
        history: list[dict[str, str]],
        user_message: str,
        max_tokens: int,
    ) -> list[dict[str, str]]:
        """
        @methoddesc 构建最终发送给 LLM 的消息列表

        顺序为：系统提示词 → 截断后的历史对话 → 当前用户消息。
        历史记录按 Token 上限截断，避免超出模型上下文窗口。

        参数:
            system_prompt: 系统提示词文本
            history: 历史对话列表
            user_message: 当前用户消息
            max_tokens: 历史记录的最大 Token 限制

        返回:
            组装好的消息列表
        """
        from app.shared.services.ai.utils import truncate_history_by_tokens

        messages: list[dict[str, str]] = []

        # 系统提示词放在首位
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        # 截断并添加历史（保留最近的对话）
        if history:
            truncated = truncate_history_by_tokens(
                history,
                system_prompt,
                max_tokens=max_tokens,
            )
            messages.extend(truncated)

        # 当前用户消息放在最后
        messages.append({"role": "user", "content": user_message})

        return messages

    def _parse_llm_response(self, response_text: str) -> dict[str, Any]:
        """
        @methoddesc 解析 LLM 返回的响应文本

        先尝试多种策略解析 JSON，再验证必须字段（reply 和 actions）。

        参数:
            response_text: LLM 返回的原始文本

        返回:
            包含 valid、reply、actions、error 的字典
        """
        try:
            parsed = ActionParser.parse_llm_response(response_text)
        except ActionParseError as e:
            logger.error(f"解析 LLM 响应失败: {e}")
            return {
                "valid": False,
                "reply": "抱歉，我无法理解您的请求。请尝试使用更清晰的描述。",
                "error": str(e),
                "actions": [],
            }

        if not ActionParser.validate_response(parsed):
            logger.warning(f"LLM 响应格式验证失败: {parsed}")
            return {
                "valid": False,
                "reply": parsed.get("reply", "响应格式不符合要求，请重试。"),
                "error": "响应格式验证失败",
                "actions": [],
            }

        return {
            "valid": True,
            "reply": parsed.get("reply", ""),
            "actions": parsed.get("actions", []),
        }

    def _update_history(
        self,
        history: list[dict[str, str]],
        user_message: str,
        assistant_reply: str,
    ) -> list[dict[str, str]]:
        """
        @methoddesc 将当前轮次的对话追加到历史记录中

        参数:
            history: 原有历史记录
            user_message: 用户消息
            assistant_reply: AI 回复

        返回:
            新的历史记录列表（不修改原列表）
        """
        new_history = history.copy()
        new_history.append({"role": "user", "content": user_message})
        new_history.append({"role": "assistant", "content": assistant_reply})
        return new_history

    def _notify_progress(
        self,
        options: ChatOptions,
        stage: str,
        message: str,
        data: dict | None = None,
    ) -> None:
        """
        @methoddesc 触发进度通知

        如果配置了进度回调，则调用回调函数通知当前执行阶段。

        参数:
            options: Chat 执行选项
            stage: 当前阶段标识（如 "llm_calling", "validating"）
            message: 进度描述文本
            data: 附加数据（可选）
        """
        if options.progress_callback:
            options.progress_callback(stage, message, data)

    async def _execute_with_agent(
        self,
        message: str,
        project_path: str,
        context_nodes: list[dict[str, Any]],
        options: ChatOptions,
    ) -> ChatExecutionResult:
        """
        @methoddesc Agent 模式执行路径

        走真正的工具循环：ChatAgentRunner 组装 4 个 chat 工具
        (read_project/read_table/apply_actions/validate_table)，
        调用 AgentExecutor 跑 plan→act→observe 循环，
        对外仍返回 ChatExecutionResult，保持契约不变。

        参数:
            message: 用户消息
            project_path: 项目路径
            context_nodes: 选中上下文节点
            options: Chat 执行选项

        返回:
            ChatExecutionResult: agent 产出的 reply + frontend_instructions
        """
        # 延迟导入，避免非 agent 模式下的额外加载
        from app.shared.services.ai.chat_agent_runner import ChatAgentRunner
        from app.shared.services.llm.providers import create

        self._notify_progress(options, "agent_running", "AI 正在分析并操作...")

        # self._provider 是 AIProvider 配置对象，AgentExecutor 需要的是 Provider 实例（有 chat 方法）
        # 此处与 ConfigGenerationService._get_provider() 模式一致：用 create() 实例化
        # 注意：create() 可能抛出 ImportError（如 openai 未安装），需在此捕获，
        # 否则异常会穿透到 endpoint 的 try/except 导致 502，而非返回 200 + status=error
        try:
            runner = ChatAgentRunner(
                provider=create(self._provider),
                project_path=project_path,
                context_nodes=context_nodes,
                max_iterations=options.max_agent_iterations,
                max_history_tokens=options.max_history_tokens,
            )
        except Exception as e:
            logger.error(f"Agent 模式初始化失败: {e}")
            return ChatExecutionResult(
                success=False,
                reply="",
                error=f"AI 服务初始化失败: {e}",
            )

        run_result = await runner.run(
            message=message,
            history=options.history,
        )

        if not run_result.success:
            return ChatExecutionResult(
                success=False,
                reply=run_result.reply,
                frontend_instructions=run_result.frontend_instructions,
                error=run_result.error,
            )

        # 更新对话历史（供 CLI 多轮对话使用）
        updated_history = self._update_history(options.history, message, run_result.reply)

        self._notify_progress(options, "completed", "AI 处理完成")

        return ChatExecutionResult(
            success=True,
            reply=run_result.reply,
            actions=run_result.actions,
            frontend_instructions=run_result.frontend_instructions,
            updated_history=updated_history,
            iterations=run_result.iterations,
            tool_steps=run_result.tool_steps,
        )

    def _process_actions(
        self,
        actions: list[dict[str, Any]],
        project_path: str,
        reply: str,
        options: ChatOptions,
        updated_history: list[dict[str, str]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]], list[Any]] | ChatExecutionResult:
        """
        @methoddesc 处理 AI 返回的动作列表

        包括歧义解析、预验证、执行和收集前端指令。

        参数:
            actions: 动作列表
            project_path: 项目路径
            reply: AI 回复文本
            options: Chat 执行选项
            updated_history: 更新后的历史记录

        返回:
            (actions, validation_result, action_results, frontend_instructions)
            或提前返回的 ChatExecutionResult
        """
        frontend_instructions: list[Any] = []
        validation_result: dict[str, Any] | None = None
        action_results: list[dict[str, Any]] = []

        # 6.1 歧义解析（交互式 CLI 使用）
        if options.enable_interactive and options.ambiguity_resolver:
            self._notify_progress(options, "resolving", "解析表名歧义...")
            should_continue = options.ambiguity_resolver(actions, project_path)
            if not should_continue:
                return ChatExecutionResult(
                    success=True,
                    reply=reply,
                    actions=actions,
                    updated_history=updated_history,
                )

        # 6.2 动作预验证
        if not options.skip_action_validation:
            self._notify_progress(options, "validating", "验证操作...")
            validator = ActionValidator(project_path)
            validation_result_obj = validator.validate(actions)
            validation_result = {
                "has_errors": validation_result_obj.has_errors,
                "has_warnings": validation_result_obj.has_warnings,
                "valid_actions": validation_result_obj.valid_actions,
            }

            # 交互式确认
            if options.enable_interactive and options.confirm_callback:
                if options.pause_callback:
                    options.pause_callback()
                confirmed = options.confirm_callback(actions, reply)
                if not confirmed:
                    return ChatExecutionResult(
                        success=True,
                        reply=reply,
                        actions=actions,
                        updated_history=updated_history,
                        validation_result=validation_result,
                    )

            # 过滤掉有错误的动作
            if validation_result_obj.valid_actions:
                actions = validation_result_obj.valid_actions

        # 6.3 执行动作
        self._notify_progress(options, "executing", "执行操作...")
        process_result = process_actions(actions, project_path)
        action_results = process_result.get("results", [])

        if not process_result.get("success", False):
            error_messages = [r.get("message", "未知错误") for r in action_results if not r.get("success", False)]
            return ChatExecutionResult(
                success=False,
                reply=reply,
                actions=actions,
                error="; ".join(error_messages),
                updated_history=updated_history,
                validation_result=validation_result,
                action_results=action_results,
            )

        # 6.4 收集前端指令
        if options.return_frontend_instructions:
            for result in action_results:
                instructions = result.get("frontendInstructions")
                if instructions:
                    frontend_instructions.append(instructions)

        return actions, validation_result, action_results, frontend_instructions


# =============================================================================
# 便捷函数
# =============================================================================


async def execute_ai_chat_unified(
    message: str,
    project_path: str | None,
    provider: AIProvider,
    context_nodes: list[dict[str, Any]] = None,
    history: list[dict[str, str]] = None,
    agent_mode: bool = True,
) -> ChatExecutionResult:
    """
    @methoddesc 便捷的统一 AI Chat 执行函数（用于 API 场景）

    参数:
        message: 用户消息
        project_path: 项目路径
        provider: AIProvider 配置对象
        context_nodes: 上下文节点
        history: 对话历史
        agent_mode: 是否启用 Agent 深度模式

    返回:
        ChatExecutionResult: 执行结果
    """
    orchestrator = AIChatOrchestrator(provider)
    options = ChatOptions(
        history=history or [],
        enable_interactive=False,  # API 模式禁用交互
        return_frontend_instructions=True,
        agent_mode=agent_mode,
        max_agent_iterations=3,
    )

    return await orchestrator.execute_chat(
        message=message,
        project_path=project_path,
        context_nodes=context_nodes or [],
        options=options,
    )
