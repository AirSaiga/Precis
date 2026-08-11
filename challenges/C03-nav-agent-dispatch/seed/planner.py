"""任务规划器（C03 seed）。

把用户目标拆解成有序的步骤列表。模拟 Precis AI agent 的 planner。
"""

from __future__ import annotations


def plan(goal: str) -> list[dict[str, str]]:
    """把目标拆成步骤。

    每步是 {"tool": <工具名>, "input": <输入>}。
    """
    if goal == "validate_and_report":
        return [
            {"tool": "load_data", "input": "users.csv"},
            {"tool": "validate", "input": "not_null:username"},
            {"tool": "report", "input": "summary"},
        ]
    if goal == "export":
        return [
            {"tool": "load_data", "input": "orders.csv"},
            {"tool": "export_csv", "input": "out.csv"},
        ]
    return [{"tool": "unknown", "input": goal}]


# 用于导航理解题的常量（不要改）
MAX_STEPS = 10
