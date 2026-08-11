"""校验引擎（C21 seed —— 命令式嵌套循环，待重构成 pipeline）。

当前实现：一个大的 process 函数，嵌套 for + if，做 4 件事：
1. 过滤掉 None 值
2. 对每个值做类型转换（int）
3. 范围检查 [min_val, max_val]
4. 收集违规并返回结果

任务：把 process 重构成 pipeline 模式 —— 每步是独立的 stage 函数，
数据流过 stage 链。行为必须完全一致。
"""

from __future__ import annotations

from typing import Any


def process(values: list[Any], min_val: int, max_val: int) -> dict[str, Any]:
    """命令式处理（待重构）。

    步骤：
    1. 过滤 None
    2. 转换为 int
    3. 范围检查
    4. 收集结果
    """
    # === 命令式实现（待重构）===
    filtered: list[Any] = []
    for v in values:
        if v is not None:
            filtered.append(v)

    converted: list[int] = []
    for v in filtered:
        try:
            converted.append(int(v))
        except (ValueError, TypeError):
            converted.append(0)  # 转换失败用 0 占位

    valid: list[int] = []
    violations: list[int] = []  # 越界值的索引（基于 converted 列表）
    for i, v in enumerate(converted):
        if min_val <= v <= max_val:
            valid.append(v)
        else:
            violations.append(i)

    return {
        "valid": valid,
        "violations": violations,
        "total_input": len(values),
        "total_filtered": len(filtered),
        "total_valid": len(valid),
    }
