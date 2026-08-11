"""服务层：校验编排（C09 seed）。

调用 domain 层构建约束，对数据执行校验，聚合结果。
"""

from __future__ import annotations

from typing import Any

from domain import build_constraint


def validate_column(
    values: list[Any],
    constraint_type: str,
    constraint_params: dict[str, Any],
) -> dict[str, Any]:
    """对一列值执行指定类型的约束校验。

    返回 {"passed": bool, "violations": list[int]}。
    violations 是违规值的索引列表。
    """
    constraint = build_constraint(constraint_type, constraint_params)
    if constraint is None:
        return {
            "passed": False,
            "violations": [],
            "error": f"未知约束类型: {constraint_type}",
        }

    violations: list[int] = []
    for i, value in enumerate(values):
        if not constraint.validate(value):
            violations.append(i)

    return {
        "passed": len(violations) == 0,
        "violations": violations,
        "constraint_type": constraint.constraint_type,
    }
