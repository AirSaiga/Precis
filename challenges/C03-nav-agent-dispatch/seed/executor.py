"""任务执行器（C03 seed）。

按 planner 产出的步骤列表，依次调用 tool_registry 里的工具。
模拟 Precis AI agent 的 executor。
"""

from __future__ import annotations

from typing import Any

from tool_registry import get_tool


def execute(steps: list[dict[str, str]]) -> dict[str, Any]:
    """执行步骤列表。

    返回 {"results": [...], "errors": [...], "executed": int}。
    遇到未注册工具时记一条 error 并继续（不中断）。
    """
    results: list[Any] = []
    errors: list[dict[str, str]] = []
    executed = 0

    for i, step in enumerate(steps):
        tool_name = step.get("tool", "")
        tool_input = step.get("input", "")
        fn = get_tool(tool_name)
        if fn is None:
            errors.append({"step": str(i), "tool": tool_name, "reason": "未注册"})
            continue
        try:
            results.append(fn(tool_input))
            executed += 1
        except Exception as e:
            errors.append({"step": str(i), "tool": tool_name, "reason": str(e)})

    return {"results": results, "errors": errors, "executed": executed}
