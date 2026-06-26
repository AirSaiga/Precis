"""@fileoverview Chat Agent Runner 模块

Chat mini-agent 的编排器。在 agent_mode=true 时，
让 Chat 路径真正跑起 plan→act→observe 工具循环。

核心职责:
- 组装 4 个 chat 专用工具(read_project/read_table/apply_actions/validate_table)
- 构建 chat agent 系统提示词
- 调用 AgentExecutor 跑工具循环
- 从循环结果提取 reply + 旁路收集的 frontend_instructions
- 对外保持 ChatExecutionResult 契约不变(前端零改动)

设计要点:
- 复用 AgentExecutor/Memory/ToolRegistry 通用内核，不改动它们
- apply_actions 工具持有的 collected_instructions 列表由 runner 创建并共享，
  工具 append、runner 最终读取，实现 frontend_instructions 的旁路累积
- 当 LLM 不再调用工具、输出纯文本时，循环自然终止，该文本即为 reply
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.shared.services.ai.agent.chat_tools import (
    ApplyActionsTool,
    ReadProjectTool,
    ReadTableTool,
    ValidateTableTool,
)
from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.chat.chat_system_prompt import SYSTEM_PROMPT_CORE

logger = logging.getLogger(__name__)


# =============================================================================
# 系统提示词
# =============================================================================

# 工具使用指引：定义 LLM 如何使用 4 个工具完成查-改-验闭环
_CHAT_AGENT_TOOL_GUIDE = """## 工具使用指引

你有以下 4 个工具可用。请根据用户需求自主决定调用顺序和次数：

### 1. read_project（查询，无参数）
读取当前项目的完整概览：所有表结构、约束、转换、正则节点、设置。
**使用时机**：用户询问"有哪些表"、"某表有哪些约束"、"当前配置"等查询类问题时，先调用此工具。

### 2. read_table（查询，参数: table_name, sample_rows?）
读取指定表的数据样本（前 N 行）和列结构。
**使用时机**：需要为某列设计约束（如 Range/AllowedValues）时，先看真实数据分布再决定参数。

### 3. apply_actions（修改，参数: actions）
执行配置修改动作。actions 是动作列表，每个动作含 actionType 和对应 spec。
**使用时机**：用户明确要求添加/修改/删除约束、表结构、正则、转换或设置时。
**注意**：纯查询类问题绝不调用此工具。

### 4. validate_table（校验，参数: table_name?）
执行数据校验，返回错误数量和列表。不传 table_name 校验所有表。
**使用时机**：用户要求"校验项目/表"，或在 apply_actions 后想验证改动效果。

## 工作流程

1. **查询类问题**（如"有哪些表"）：read_project → 用自然语言回答，不要 apply_actions。
2. **修改类问题**（如"给 email 加唯一约束"）：
   - 如需确认结构：先 read_project 或 read_table
   - apply_actions 执行修改
   - 可选：validate_table 验证效果
   - 用自然语言总结结果
3. **校验类问题**（如"校验数据"）：直接 validate_table → 用自然语言汇报结果。

## 终止条件

当你准备好回答用户、不再需要调用任何工具时，直接输出自然语言文本（不带 tool_calls），
循环即结束，该文本会作为最终回复返回给用户。回答应简洁明了。"""

# 措辞规范（复用自原 chat_system_prompt）
_WORDING_RULES = """## 措辞规范

- 当执行了修改操作时：使用"我将..."、"准备..."等未来时态描述即将执行的动作。
  ❌ 错误："已为 email 添加唯一约束"
  ✅ 正确："我将为 email 添加唯一约束"
- 当汇报校验结果时：客观陈述错误数量和内容，不夸大不缩小。"""

# 完整的 chat agent 系统提示词
CHAT_AGENT_SYSTEM_PROMPT = f"""{SYSTEM_PROMPT_CORE}

---

# Chat Agent 模式说明

你现在处于 Agent 工具调用模式。与直接输出 JSON 不同，你可以通过调用工具来
查询项目信息、修改配置、校验数据。请根据用户需求自主决定如何组合使用工具。

{_CHAT_AGENT_TOOL_GUIDE}

{_WORDING_RULES}

## actions 格式说明

调用 apply_actions 时，actions 数组中每个元素的格式与下方"动作说明"一致。
actionType 可选值（17种）：
- 约束: ADD_CONSTRAINT_NODE / UPDATE_CONSTRAINT_NODE / DELETE_CONSTRAINT_NODE
- Schema: ADD_SCHEMA / UPDATE_SCHEMA / DELETE_SCHEMA
- 正则: ADD_REGEX / UPDATE_REGEX / DELETE_REGEX
- 转换: ADD_TRANSFORM / UPDATE_TRANSFORM / DELETE_TRANSFORM
- 设置: UPDATE_SETTINGS
- 校验: VALIDATE_PROJECT

每个动作需带对应 spec 字段：
- 约束动作 → constraintSpec (含 type, tableName, targetColumn, isInline, params 等)
- Schema 动作 → schemaSpec (含 name, columns)
- 正则动作 → regexSpec (含 name, pattern, matchMode)
- 转换动作 → transformSpec (含 type, inputColumn, params, outputColumns)
- 设置动作 → settingsSpec (含 category, settings)
- 校验动作 → constraintSpec (含 tableName，可选)"""


# =============================================================================
# 运行结果
# =============================================================================


@dataclass
class ChatAgentRunResult:
    """Chat Agent 单次运行的产出

    reply: 最终回复给用户的自然语言文本
    frontend_instructions: apply_actions 旁路累积的前端指令列表
    actions: 已执行的动作列表（用于审计，可空）
    tool_steps: 工具调用轨迹（有序的工具名 + 简要描述列表，供前端展示）
    iterations: 实际迭代轮数
    success: 是否成功完成
    error: 失败时的错误信息
    """

    reply: str
    frontend_instructions: list[Any] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    tool_steps: list[dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    success: bool = True
    error: str | None = None


# =============================================================================
# Runner 核心
# =============================================================================


class ChatAgentRunner:
    """
    @classdesc Chat Agent 编排器

    组装工具 → 构建提示词 → 调用 AgentExecutor → 提取结果。
    对 ChatOrchestrator 屏蔽 AgentExecutor 的内部细节。
    """

    def __init__(
        self,
        provider: Any,
        project_path: str,
        context_nodes: list[dict[str, Any]],
        max_iterations: int = 3,
        max_history_tokens: int = 120000,
    ):
        """
        @methoddesc 初始化 Chat Agent Runner

        参数:
            provider: Provider 实例（BaseProvider 子类，有 chat 方法），由调用方通过 create() 创建
            project_path: 项目配置目录路径
            context_nodes: 前端选中的上下文节点列表
            max_iterations: Agent 最大迭代轮数
            max_history_tokens: 历史消息 token 预算
        """
        self.provider = provider
        self.project_path = project_path
        self.context_nodes = context_nodes
        self.max_iterations = max_iterations
        self.max_history_tokens = max_history_tokens

        # 关键：frontend_instructions 的旁路累积容器
        # apply_actions 工具持有此列表引用，append 后 runner 最终读取
        self.collected_instructions: list[Any] = []

        # 流式回调容器：由 StreamingOrchestrator 通过 configure_callbacks 注入，
        # run 时透传给 AgentExecutor（未配置时为空，executor 用默认 noop）。
        self._callbacks: dict[str, Any] = {}

        # 组装系统提示词（含上下文）
        self.system_prompt = self._build_system_prompt()

    def configure_callbacks(self, **kwargs: Any) -> None:
        """@methoddesc 配置流式回调，run 时透传给 AgentExecutor。

        由 StreamingOrchestrator 调用，把 on_chunk/on_turn/on_tool_call/on_tool_result/cancelled
        注入，实现 service 输出 → 事件流的桥接。未配置的回调在 executor 内部使用默认 noop。

        参数:
            **kwargs: 回调键值对，支持的键: on_chunk, on_turn, on_tool_call, on_tool_result, cancelled
        """
        self._callbacks = kwargs

    def _build_system_prompt(self) -> str:
        """
        @methoddesc 构建完整的 chat agent 系统提示词

        在基础 agent 提示词后，附加当前项目概览和选中上下文，
        让 LLM 开局即了解项目状态（但仍可用 read_project 刷新）。
        """
        from app.shared.services.ai.utils import get_project_overview
        from app.shared.services.llm.chat.chat_system_prompt import (
            build_context_section,
            build_project_overview_section,
        )

        parts = [CHAT_AGENT_SYSTEM_PROMPT]

        # 附加项目概览（让 LLM 无需首轮必调 read_project）
        try:
            overview = get_project_overview(self.project_path)
            overview_section = build_project_overview_section(overview)
            if overview_section:
                parts.append(overview_section)
        except Exception as e:
            logger.warning(f"构建项目概览失败，LLM 可自行调用 read_project: {e}")

        # 附加选中上下文节点
        context_section = build_context_section(self.context_nodes)
        if context_section:
            parts.append(context_section)

        return "\n\n".join(parts)

    def _create_registry(self) -> ToolRegistry:
        """
        @methoddesc 创建并注册 chat 工具集

        4 个工具全部注入 project_path，apply_actions 额外注入
        collected_instructions 共享引用。
        """
        registry = ToolRegistry()

        read_project_tool = ReadProjectTool(project_path=self.project_path)
        registry.register(
            name=read_project_tool.NAME,
            description=read_project_tool.get_definition()["function"]["description"],
            parameters=read_project_tool.get_definition()["function"]["parameters"],
            handler=lambda args: read_project_tool.run(args),
        )

        read_table_tool = ReadTableTool(project_path=self.project_path)
        registry.register(
            name=read_table_tool.NAME,
            description=read_table_tool.get_definition()["function"]["description"],
            parameters=read_table_tool.get_definition()["function"]["parameters"],
            handler=lambda args: read_table_tool.run(args),
        )

        # 关键：apply_actions 注入 collected_instructions 共享引用
        apply_actions_tool = ApplyActionsTool(
            project_path=self.project_path,
            collected_instructions=self.collected_instructions,
        )
        registry.register(
            name=apply_actions_tool.NAME,
            description=apply_actions_tool.get_definition()["function"]["description"],
            parameters=apply_actions_tool.get_definition()["function"]["parameters"],
            handler=lambda args: apply_actions_tool.run(args),
        )

        validate_tool = ValidateTableTool(project_path=self.project_path)
        registry.register(
            name=validate_tool.NAME,
            description=validate_tool.get_definition()["function"]["description"],
            parameters=validate_tool.get_definition()["function"]["parameters"],
            handler=lambda args: validate_tool.run(args),
        )

        return registry

    # 工具名到人类可读标签的映射，用于前端展示轨迹
    _TOOL_LABELS = {
        ReadProjectTool.NAME: "读取项目",
        ReadTableTool.NAME: "查看数据",
        ApplyActionsTool.NAME: "修改配置",
        ValidateTableTool.NAME: "校验数据",
    }

    def _collect_audit_trail(self, agent_result: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        @methoddesc 从 agent 执行记录中收集审计轨迹

        返回两个列表：
        - executed_actions: 所有 apply_actions 工具调用中的 actions 参数（扁平化）
        - tool_steps: 工具调用轨迹（每步含 tool 名、标签、轮次），供前端展示
        """
        executed: list[dict[str, Any]] = []
        tool_steps: list[dict[str, Any]] = []
        for turn in agent_result.turns:
            for tc in turn.tool_calls:
                label = self._TOOL_LABELS.get(tc.name, tc.name)
                step = {"tool": tc.name, "label": label, "turn": turn.turn}
                # apply_actions 额外记录动作数量
                if tc.name == ApplyActionsTool.NAME:
                    args = tc.arguments
                    if isinstance(args, dict):
                        actions = args.get("actions", [])
                        if isinstance(actions, list):
                            executed.extend(actions)
                            step["action_count"] = len(actions)
                tool_steps.append(step)
        return executed, tool_steps

    async def run(self, message: str, history: list[dict[str, str]] | None = None) -> ChatAgentRunResult:
        """
        @methoddesc 运行 Chat Agent

        组装 registry + executor，跑工具循环，提取结果。

        参数:
            message: 用户消息
            history: 对话历史（可选，用于多轮上下文）

        返回:
            ChatAgentRunResult: 含 reply、frontend_instructions、actions 等
        """
        registry = self._create_registry()

        # 构建任务消息：用户消息 + 历史摘要
        task_message = self._build_task_message(message, history)

        executor = AgentExecutor(
            provider=self.provider,
            registry=registry,
            system_prompt=self.system_prompt,
            max_iterations=self.max_iterations,
            max_tokens=self.max_history_tokens,
            # 流式回调透传（未配置时为 None，AgentExecutor 内部用默认 noop）
            on_chunk=self._callbacks.get("on_chunk"),
            on_turn=self._callbacks.get("on_turn"),
            on_tool_call=self._callbacks.get("on_tool_call"),
            on_tool_result=self._callbacks.get("on_tool_result"),
            cancelled_callback=self._callbacks.get("cancelled"),
        )

        try:
            agent_result = await executor.run(task_message)
        except Exception as e:
            logger.exception("ChatAgentRunner 执行失败")
            return ChatAgentRunResult(
                reply="抱歉，我在处理时遇到了问题，请稍后重试。",
                frontend_instructions=[],
                success=False,
                error=f"Agent 执行失败: {e}",
            )

        # 提取最终回复（无 tool_calls 的最后一轮 content）
        reply = agent_result.content or ""
        if not reply:
            # 兜底：循环用尽但仍无文本回复
            if agent_result.error:
                reply = f"处理未能完成：{agent_result.error}"
            else:
                reply = "我已完成处理，但没有生成回复文本。"

        # 收集审计轨迹（已执行动作 + 工具步骤）
        executed_actions, tool_steps = self._collect_audit_trail(agent_result)

        return ChatAgentRunResult(
            reply=reply,
            frontend_instructions=list(self.collected_instructions),
            actions=executed_actions,
            tool_steps=tool_steps,
            iterations=agent_result.iterations,
            success=agent_result.success,
            error=agent_result.error,
        )

    def _build_task_message(self, message: str, history: list[dict[str, str]] | None) -> str:
        """
        @methoddesc 构建 Agent 任务消息

        AgentExecutor.run 的 task_message 会作为初始 user 消息。
        在用户原始消息前，附加简要的历史摘要（如有），
        让 Agent 在多轮对话中保持上下文。
        """
        if not history:
            return message

        # 截取最近几轮历史作为摘要（避免 task_message 过长）
        recent = history[-6:]  # 最近 3 轮（user+assistant 各算一条）
        if not recent:
            return message

        history_lines = []
        for msg in recent:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                history_lines.append(f"用户: {content}")
            elif role == "assistant":
                history_lines.append(f"助手: {content}")

        history_text = "\n".join(history_lines)
        return f"## 对话历史摘要\n{history_text}\n\n## 当前用户需求\n{message}"
