"""@fileoverview Agent 执行器

功能概述:
- 实现 Agent 主循环：LLM 调用 → 工具执行 → 结果回传 → 下一轮
- 支持最大迭代轮数、取消检查、checkpoint 回调
- 约定：名为 generate_config 的工具是最终输出工具，调用成功并返回 config 时任务结束

架构设计:
- AgentExecutor 组合 AIProvider、ToolRegistry、AgentMemory
- 每轮调用 LLM，若返回 tool_calls 则执行工具
- 若工具调用中包含 generate_config 且成功返回 config，则以该 config 作为最终结果结束
- 若 LLM 直接返回可解析为配置 JSON 的文本，也接受为最终结果
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.shared.services.llm.providers.base import BaseProvider, ChatMessage, ChatRequest

from .memory import AgentMemory
from .tool_registry import ToolRegistry
from .types import AgentMetrics, AgentResult, AgentTurn, ToolResult

logger = logging.getLogger(__name__)

# 默认系统提示词
DEFAULT_SYSTEM_PROMPT = """你是一个数据治理专家 Agent，擅长分析数据文件并生成数据验证配置。
你可以调用工具来完成任务。每一步请根据观察结果决定下一步行动。
当需要输出最终结果时，请调用 generate_config 工具，其返回的 config 会被作为最终结果。"""

# 最终输出工具名
FINAL_OUTPUT_TOOL = "generate_config"


# 进度回调签名：stage, progress(0-1), extra dict
def default_progress_callback(stage: str, progress: float, extra: dict[str, Any] | None = None) -> None:
    pass


# 默认取消回调
def default_cancelled_callback() -> bool:
    return False


# 默认 tool result 回调
def default_on_tool_result(tr: ToolResult) -> None:
    pass


class AgentExecutor:
    """
    @classdesc Agent 执行器

    实现规划-执行-观察的循环。
    """

    def __init__(
        self,
        provider: BaseProvider,
        registry: ToolRegistry,
        system_prompt: str | None = None,
        max_iterations: int = 5,
        max_tokens: int = 120000,
        progress_callback: Callable[[str, float, dict[str, Any] | None], None] | None = None,
        checkpoint_callback: Callable[[dict[str, Any]], None] | None = None,
        cancelled_callback: Callable[[], bool] | None = None,
        on_tool_result: Callable[[ToolResult], None] | None = None,
        on_chunk: Callable[[str], None] | None = None,
        on_turn: Callable[[int], None] | None = None,
        on_tool_call: Callable[[str, str, int], None] | None = None,
    ):
        """
        @methoddesc 初始化 Agent 执行器

        参数:
            provider: AIProvider 配置
            registry: 工具注册表
            system_prompt: 系统提示词，None 使用默认
            max_iterations: 最大迭代轮数
            max_tokens: 记忆最大 token 预算
            progress_callback: 进度回调
            checkpoint_callback: checkpoint 保存回调
            cancelled_callback: 取消检查回调
            on_tool_result: 工具结果回调，用于提取 metrics
            on_chunk: 流式文本增量回调（逐字触发），用于 SSE 流式输出
            on_turn: 新轮次开始回调，参数为轮次序号
            on_tool_call: 工具调用开始回调，参数为 (tool_name, call_id, turn)
        """
        self.provider = provider
        self.registry = registry
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self.max_iterations = max_iterations
        self.max_tokens = max_tokens
        self.progress_callback = progress_callback or default_progress_callback
        self.checkpoint_callback = checkpoint_callback or (lambda x: None)
        self.cancelled_callback = cancelled_callback or default_cancelled_callback
        self.on_tool_result = on_tool_result or default_on_tool_result
        self.on_chunk = on_chunk or (lambda text: None)
        self.on_turn = on_turn or (lambda turn: None)
        self.on_tool_call = on_tool_call or (lambda name, call_id, turn: None)
        self._chat_service: Any | None = None
        self._memory: AgentMemory | None = None

    async def run(
        self,
        task_message: str,
        initial_checkpoint: dict[str, Any] | None = None,
    ) -> AgentResult:
        """
        @methoddesc 运行 Agent

        参数:
            task_message: 用户任务描述
            initial_checkpoint: 可选的初始 checkpoint 数据

        返回:
            AgentResult 执行结果
        """
        self._memory = AgentMemory(self.system_prompt, max_tokens=self.max_tokens)
        self._memory.set_task(task_message)

        tools = self.registry.get_definitions()

        result = AgentResult(success=True, iterations=0)

        for turn_idx in range(1, self.max_iterations + 1):
            # 取消检查点 1: turn 开始
            if self.cancelled_callback():
                result.success = False
                result.cancelled = True
                result.error = "任务已取消"
                return result

            self.on_turn(turn_idx)
            self.progress_callback(
                f"agent_turn_{turn_idx}",
                turn_idx / self.max_iterations,
                {"iterations": turn_idx, "max_iterations": self.max_iterations},
            )

            messages = self._memory.get_messages()
            logger.debug(f"Agent turn {turn_idx}, messages={len(messages)}")

            chat_messages = []
            for m in messages:
                chat_messages.append(
                    ChatMessage(
                        role=m["role"],
                        content=m.get("content"),
                        tool_calls=m.get("tool_calls"),
                        tool_call_id=m.get("tool_call_id"),
                    )
                )
            req = ChatRequest(
                messages=chat_messages,
                model=self.provider.model if hasattr(self.provider, "model") else None,
                temperature=0.3,
                tools=tools,
                tool_choice="auto",
            )

            # 流式调用: 累积文本 + tool_calls，逐字触发 on_chunk
            # chat_stream 是 async generator function（async def + yield），直接 async for 即可
            content = ""
            raw_tool_calls: list[dict[str, Any]] = []
            try:
                async for chunk in self.provider.chat_stream(req):
                    # 取消检查点 2: 流内 chunk 间
                    if self.cancelled_callback():
                        result.success = False
                        result.cancelled = True
                        result.error = "任务已取消"
                        return result
                    if chunk.type == "delta":
                        content += chunk.text or ""
                        self.on_chunk(chunk.text or "")
                    elif chunk.type == "tool_calls" and chunk.tool_calls:
                        raw_tool_calls.extend(chunk.tool_calls)
            except Exception as e:
                logger.error(f"Agent LLM 流式调用失败: {e}")
                result.success = False
                result.error = f"AI 服务调用失败: {e}"
                return result

            tool_calls = [self.registry.parse_tool_call(tc) for tc in raw_tool_calls]

            self._memory.add_assistant_message(content=content or None, tool_calls=raw_tool_calls or None)

            turn = AgentTurn(
                turn=turn_idx,
                content=content,
                tool_calls=tool_calls,
            )

            if tool_calls:
                # 触发工具调用开始回调
                for tc in tool_calls:
                    self.on_tool_call(tc.name, tc.id, turn_idx)
                # 执行工具
                self.progress_callback("agent_executing_tools", turn_idx / self.max_iterations, None)
                tool_results = await self.registry.execute_many(tool_calls)
                turn.tool_results = tool_results

                final_config = self._extract_final_config(tool_results)
                if final_config is not None:
                    # 最终输出工具已生成配置，任务结束
                    result.config = final_config
                    result.success = True
                    result.iterations = turn_idx
                    result.content = content
                    self._memory.add_turn(turn)
                    result.turns.append(turn)
                    final_checkpoint = self._make_checkpoint(turn_idx, turn, result.metrics.to_dict())
                    self.checkpoint_callback(final_checkpoint)
                    return result

                for tr in tool_results:
                    self.on_tool_result(tr)
                    observation = tr.observation
                    if isinstance(observation, dict):
                        observation_text = self._dict_to_text(observation)
                    else:
                        observation_text = str(observation)
                    self._memory.add_tool_result(tr.call_id, tr.name, observation_text)

                # 更新 checkpoint
                checkpoint = self._make_checkpoint(turn_idx, turn, None)
                self.checkpoint_callback(checkpoint)
                self._memory.add_turn(turn)
                result.turns.append(turn)
                result.iterations = turn_idx
                continue

            # 没有 tool_calls 且 content 非空，视为最终结果
            if content:
                self._memory.add_turn(turn)
                result.turns.append(turn)
                result.iterations = turn_idx
                result.content = content

                # 尝试从 content 解析配置
                config = self._try_parse_config(content)
                if config:
                    result.config = config

                final_checkpoint = self._make_checkpoint(turn_idx, turn, result.metrics.to_dict())
                self.checkpoint_callback(final_checkpoint)
                break

            # content 为空且无 tool_calls，记录 turn 后继续
            self._memory.add_turn(turn)
            result.turns.append(turn)
            result.iterations = turn_idx

        # 如果达到最大轮数仍未结束
        if result.iterations >= self.max_iterations and result.config is None:
            result.success = False
            result.error = f"达到最大迭代轮数 {self.max_iterations}，仍未获得最终结果"

        return result

    def _extract_final_config(self, tool_results: list[ToolResult]) -> dict[str, Any] | None:
        """从工具结果中提取最终配置（generate_config 工具的返回值）。"""
        for tr in tool_results:
            if tr.name != FINAL_OUTPUT_TOOL:
                continue
            if not tr.success:
                continue
            observation = tr.observation
            if isinstance(observation, dict) and observation.get("success"):
                config = observation.get("config")
                if isinstance(config, dict):
                    return config
        return None

    def _make_checkpoint(
        self,
        turn: int,
        agent_turn: AgentTurn,
        metrics: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """构造 checkpoint。"""
        return {
            "turn": turn,
            "content": agent_turn.content,
            "tool_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in agent_turn.tool_calls],
            "tool_results": [
                {
                    "call_id": r.call_id,
                    "name": r.name,
                    "success": r.success,
                    "observation": r.observation if isinstance(r.observation, dict) else str(r.observation),
                    "error": r.error,
                }
                for r in agent_turn.tool_results
            ],
            "metrics": metrics,
        }

    @staticmethod
    def _dict_to_text(data: dict[str, Any]) -> str:
        """将字典转为文本。"""
        import json

        try:
            return json.dumps(data, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(data)

    @staticmethod
    def _try_parse_config(content: str | None) -> dict[str, Any] | None:
        """尝试从文本中提取 JSON 配置。"""
        if not content:
            return None
        import json
        import re

        # 尝试找到 Markdown JSON 代码块
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
        text = match.group(1).strip() if match else content

        start = text.find("{")
        if start == -1:
            return None
        balance = 0
        for i, char in enumerate(text[start:], start=start):
            if char == "{":
                balance += 1
            elif char == "}":
                balance -= 1
                if balance == 0:
                    try:
                        parsed: Any = json.loads(text[start : i + 1])
                        if isinstance(parsed, dict):
                            return parsed
                    except json.JSONDecodeError:
                        return None
        return None

    @staticmethod
    def build_metrics_from_issues(issues: list[dict[str, Any]]) -> AgentMetrics:
        """根据校验问题构造 metrics。"""
        metrics = AgentMetrics()
        metrics.issues = issues
        metrics.failed_rules = len(issues)
        return metrics
