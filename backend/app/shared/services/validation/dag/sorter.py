"""
@fileoverview 拓扑排序模块

功能概述:
- 对执行 DAG 进行拓扑排序
- 使用 Kahn 算法（基于入度）
- 检测循环依赖

使用示例:
    order = topological_sort(dag)
    # order = ["schema_1", "transform_a", "transform_b", "transform_c"]
"""

from __future__ import annotations

from collections import deque

from .builder import ExecutionDAG


def topological_sort(dag: ExecutionDAG) -> list[str]:
    """@methoddesc 对 DAG 进行拓扑排序

    使用 Kahn 算法，按入度为零的顺序输出节点。

    参数:
        dag: 执行 DAG

    返回:
        节点 ID 的拓扑排序列表

    异常:
        ValueError: 存在循环依赖时抛出
    """
    # 计算每个节点的入度
    in_degree: dict[str, int] = {}
    for node_id, node in dag.nodes.items():
        in_degree[node_id] = len(node.incoming)

    # 初始化队列，放入所有入度为 0 的节点
    queue: deque[str] = deque()
    for node_id, degree in in_degree.items():
        if degree == 0:
            queue.append(node_id)

    result: list[str] = []

    while queue:
        current = queue.popleft()
        result.append(current)

        for neighbor in dag.nodes[current].outgoing:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(result) != len(dag.nodes):
        # 存在循环依赖
        unresolved = [nid for nid in dag.nodes if nid not in result]
        raise ValueError(f"Transform DAG 存在循环依赖，无法完成拓扑排序。未解决节点: {unresolved}")

    return result
