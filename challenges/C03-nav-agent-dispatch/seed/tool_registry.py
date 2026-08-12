"""工具注册表（C03 seed）。

工具通过 register_tool 注册，executor 按名字查找。
模拟 Precis AI agent 的 tool_registry。

当前 bug：导出链路跑不通——planner 产出的某些导出步骤，其工具在这里没有注册；
executor 执行到未注册工具时不会报错，只是静默记一条 error 并跳过。
"""

from __future__ import annotations

from typing import Any, Callable

ToolFn = Callable[[str], Any]

_TOOLS: dict[str, ToolFn] = {}


def register_tool(name: str, fn: ToolFn) -> None:
    """注册工具。"""
    _TOOLS[name] = fn


def get_tool(name: str) -> ToolFn | None:
    """按名字查工具，未注册返回 None。"""
    return _TOOLS.get(name)


def list_tools() -> list[str]:
    """列出所有已注册工具名（排序）。"""
    return sorted(_TOOLS.keys())


# === 内置工具注册 ===
# load_data：返回模拟数据
register_tool("load_data", lambda src: {"source": src, "rows": [{"id": 1}, {"id": 2}]})

# validate：返回校验结果
register_tool("validate", lambda rule: {"rule": rule, "passed": True})

# report：返回报告文本
register_tool("report", lambda fmt: f"report({fmt})")
