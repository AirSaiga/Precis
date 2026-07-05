"""@fileoverview Agent 工具注册表

功能概述:
- 注册和管理 Agent 可调用的工具
- 提供工具定义（OpenAI tools 格式）和分发执行
- 支持同步和异步工具函数

架构设计:
- 每个工具包含：名称、描述、参数 schema、执行函数、可选的入参校验模型
- 工具描述和参数 schema 用于构造 OpenAI tools 定义
- 入参校验模型（Pydantic）在 execute 入口拦截"必填缺失/类型错误"，统一回灌结构化错误
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ValidationError

from app.shared.services.ai.agent.types import ToolCall, ToolResult

logger = logging.getLogger(__name__)

ToolHandler = Callable[[dict[str, Any]], Any]


def _format_validation_error(err: ValidationError) -> str:
    """把 Pydantic 校验错误格式化为对 LLM 友好的简短文本。

    例如：'参数校验失败: table_name 字段缺失; sample_rows 不是合法的 integer'
    帮助 LLM 在下一轮修正参数重试（配合 P0-1 的错误回灌机制）。
    """
    parts: list[str] = []
    for e in err.errors():
        # loc 形如 ('table_name',) 或 ('actions', 0, 'actionType')
        loc = ".".join(str(x) for x in e["loc"]) if e.get("loc") else "<root>"
        msg = e.get("msg", "校验失败")
        parts.append(f"{loc}: {msg}")
    return "参数校验失败: " + "; ".join(parts)


class ToolRegistry:
    """
    @classdesc Agent 工具注册表

    管理工具定义和分发执行。
    """

    def __init__(self):
        """初始化空注册表。"""
        self._tools: dict[str, dict[str, Any]] = {}
        self._handlers: dict[str, ToolHandler] = {}
        self._args_models: dict[str, type[BaseModel] | None] = {}
        # P2-3：工具读写标记，用于 execute_many 分流（写盘工具串行、只读工具并发）。
        # 未显式声明的工具默认视为写盘（保守策略，避免误判导致并发写盘竞态）。
        self._read_only_flags: dict[str, bool] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
        args_model: type[BaseModel] | None = None,
        read_only: bool = False,
    ) -> None:
        """
        @methoddesc 注册工具

        参数:
            name: 工具名称
            description: 工具描述
            parameters: JSON Schema 格式的参数定义
            handler: 工具执行函数，接收 arguments dict，返回 dict 或 str
            args_model: 可选的 Pydantic 入参模型；提供时 execute 入口会先做结构校验，
                失败则返回带详细错误信息的 ToolResult（不调 handler），驱动 LLM 自我修正。
                未提供时保持原透传行为，向后兼容。
            read_only: 工具是否为纯只读（不写盘）。execute_many 据此分流——只读工具并发执行，
                写盘工具串行执行（避免同一轮多个 apply 并发改文件竞态）。默认 False（保守视为写盘）。
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
        self._args_models[name] = args_model
        self._read_only_flags[name] = read_only

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

        # P1-1：入参结构校验。若注册时提供了 args_model，先用 Pydantic 校验 LLM 的入参，
        # 拦截必填缺失/类型错误等结构问题，把结构化错误回灌给 LLM（不调 handler）。
        # 注意：校验通过后仍传 *原始* call.arguments 给 handler，避免 model_dump 的
        # 类型转换副作用（如 Any 字段、嵌套 dict 经 dump 后可能变化）。
        args_model = self._args_models.get(call.name)
        if args_model is not None:
            try:
                args_model.model_validate(call.arguments)
            except ValidationError as e:
                logger.warning(f"工具 {call.name} 入参校验失败: {e}")
                return ToolResult(
                    call_id=call.id,
                    name=call.name,
                    success=False,
                    observation="",
                    error=_format_validation_error(e),
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
        """执行多个工具调用，保持结果顺序与 calls 对齐。

        P2-3 分流策略（避免同轮并发写盘竞态）：
        - 只读工具（read_only=True）：并发执行（asyncio.gather），互不影响
        - 写盘工具（read_only=False）：串行执行，避免同一轮多个 apply 并发改同一/相关文件
        - 两类工具的执行结果按原始 calls 顺序回填，保持 _collect_audit_trail 依赖的顺序对齐契约

        单个工具异常仍走 execute 内部的兜底（返回 success=False 的 ToolResult），
        不影响其他工具；BaseException（asyncio.gather 罕见）兜底为占位 ToolResult。
        """
        if not calls:
            return []

        # 按读写标记分流，记录原始下标以便最后按序回填
        read_only_indices: list[int] = []
        write_indices: list[int] = []
        for i, call in enumerate(calls):
            if self._read_only_flags.get(call.name, False):
                read_only_indices.append(i)
            else:
                write_indices.append(i)

        # 预分配结果容器（按下标对齐 calls）
        results: list[ToolResult | None] = [None] * len(calls)

        # 只读工具并发
        if read_only_indices:
            ro_results = await asyncio.gather(
                *[self.execute(calls[i]) for i in read_only_indices], return_exceptions=True
            )
            for idx, r in zip(read_only_indices, ro_results, strict=True):
                results[idx] = (
                    r
                    if not isinstance(r, BaseException)
                    else ToolResult(call_id="", name="", success=False, observation="", error=str(r))
                )

        # 写盘工具串行（按原始顺序）
        for i in write_indices:
            try:
                results[i] = await self.execute(calls[i])
            except BaseException as e:  # noqa: BLE001 — 兜底，与 gather 分支保持一致
                results[i] = ToolResult(call_id="", name="", success=False, observation="", error=str(e))

        # 全部填满（读写分流覆盖了所有下标），返回非 None 列表
        return [
            r if r is not None else ToolResult(call_id="", name="", success=False, observation="", error="未执行")
            for r in results
        ]

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
