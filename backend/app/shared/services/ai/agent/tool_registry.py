"""@fileoverview Agent 工具注册表

功能概述:
- 注册和管理 Agent 可调用的工具
- 提供工具定义（OpenAI tools 格式）和分发执行
- 支持同步和异步工具函数

架构设计:
- 每个工具包含：名称、描述、参数 schema、执行函数
- 工具描述和参数 schema 用于构造 OpenAI tools 定义
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from collections.abc import Callable
from typing import Any

from app.shared.services.ai.agent.types import ToolCall, ToolResult

logger = logging.getLogger(__name__)

ToolHandler = Callable[[dict[str, Any]], Any]


class ToolRegistry:
    """
    @classdesc Agent 工具注册表

    管理工具定义和分发执行。
    """

    def __init__(self):
        """初始化空注册表。"""
        self._tools: dict[str, dict[str, Any]] = {}
        self._handlers: dict[str, ToolHandler] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        """
        @methoddesc 注册工具

        参数:
            name: 工具名称
            description: 工具描述
            parameters: JSON Schema 格式的参数定义
            handler: 工具执行函数，接收 arguments dict，返回 dict 或 str
        """
        self._tools[name] = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            },
        }
        self._handlers[name] = handler

    def get_definitions(self) -> list[dict[str, Any]]:
        """获取 OpenAI tools 定义列表。"""
        return list(self._tools.values())

    async def execute(self, call: ToolCall) -> ToolResult:
        """
        @methoddesc 执行工具调用

        参数:
            call: 工具调用请求

        返回:
            ToolResult 结果对象
        """
        handler = self._handlers.get(call.name)
        if handler is None:
            return ToolResult(
                call_id=call.id,
                name=call.name,
                success=False,
                observation="",
                error=f"未知工具: {call.name}",
            )

        try:
            result = handler(call.arguments)
            if inspect.isawaitable(result):
                result = await result

            if isinstance(result, ToolResult):
                return result

            if isinstance(result, dict):
                return ToolResult(
                    call_id=call.id,
                    name=call.name,
                    success=result.get("success", True),
                    observation=result,
                    error=result.get("error"),
                )

            return ToolResult(
                call_id=call.id,
                name=call.name,
                success=True,
                observation=str(result),
            )
        except Exception as e:
            logger.exception(f"工具执行失败 {call.name}: {e}")
            return ToolResult(
                call_id=call.id,
                name=call.name,
                success=False,
                observation="",
                error=f"工具执行异常: {e}",
            )

    async def execute_many(self, calls: list[ToolCall]) -> list[ToolResult]:
        """并发执行多个工具调用。"""
        if not calls:
            return []
        results = await asyncio.gather(*[self.execute(c) for c in calls], return_exceptions=True)
        final: list[ToolResult] = []
        for r in results:
            if isinstance(r, BaseException):
                final.append(ToolResult(call_id="", name="", success=False, observation="", error=str(r)))
            else:
                final.append(r)
        return final

    def parse_tool_call(self, raw: dict[str, Any]) -> ToolCall:
        """从 LLM 返回的 tool_call dict 解析为 ToolCall。"""
        func = raw.get("function", {})
        arguments = func.get("arguments")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {"raw": arguments}
        return ToolCall(
            id=raw.get("id", ""),
            name=func.get("name", ""),
            arguments=arguments or {},
        )
