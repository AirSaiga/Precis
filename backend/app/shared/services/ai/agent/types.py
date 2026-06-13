"""@fileoverview Agent 类型定义模块

定义 Agent 执行过程中使用的核心数据类型。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ToolCall:
    """单次工具调用请求"""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    """单次工具调用结果"""

    call_id: str
    name: str
    success: bool
    observation: str | dict[str, Any]
    error: str | None = None


@dataclass
class AgentTurn:
    """Agent 单轮执行记录"""

    turn: int
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_results: list[ToolResult] = field(default_factory=list)
    checkpoint: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentPlan:
    """分块执行计划"""

    chunks: list[dict[str, Any]] = field(default_factory=list)
    reason: str = ""


@dataclass
class AgentMetrics:
    """Agent 执行指标"""

    total_rules: int = 0
    passed_rules: int = 0
    failed_rules: int = 0
    removed_rules: int = 0
    modified_rules: int = 0
    issues: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_rules": self.total_rules,
            "passed_rules": self.passed_rules,
            "failed_rules": self.failed_rules,
            "removed_rules": self.removed_rules,
            "modified_rules": self.modified_rules,
            "issues": self.issues,
        }


@dataclass
class AgentResult:
    """Agent 执行结果"""

    success: bool
    content: str | None = None
    config: dict[str, Any] | None = None
    turns: list[AgentTurn] = field(default_factory=list)
    metrics: AgentMetrics = field(default_factory=AgentMetrics)
    plan: AgentPlan | None = None
    error: str | None = None
    iterations: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "content": self.content,
            "config": self.config,
            "turns": [self._turn_to_dict(t) for t in self.turns],
            "metrics": self.metrics.to_dict(),
            "plan": {"chunks": self.plan.chunks, "reason": self.plan.reason} if self.plan else None,
            "error": self.error,
            "iterations": self.iterations,
        }

    @staticmethod
    def _turn_to_dict(turn: AgentTurn) -> dict[str, Any]:
        return {
            "turn": turn.turn,
            "content": turn.content,
            "tool_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in turn.tool_calls],
            "tool_results": [
                {
                    "call_id": r.call_id,
                    "name": r.name,
                    "success": r.success,
                    "observation": r.observation,
                    "error": r.error,
                }
                for r in turn.tool_results
            ],
            "checkpoint": turn.checkpoint,
        }


# 工具函数签名：输入 arguments dict，返回 ToolResult
ToolFunction = Callable[[dict[str, Any]], Any]
