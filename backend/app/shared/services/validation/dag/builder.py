"""
@fileoverview DAG 构建器

功能概述:
- 从 TransformFile 列表构建有向无环图（DAG）
- 节点 = transform 或 schema（数据源）
- 边 = input_from_node 依赖关系

架构设计:
- 节点类型: "schema" | "transform"
- 使用邻接表表示图结构
- 支持检测循环依赖
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile

logger = logging.getLogger(__name__)


@dataclass
class DAGNode:
    """@classdesc DAG 节点"""

    id: str
    node_type: str  # "schema" | "transform"
    data: Any = None  # TransformFile 或 schema 标识
    incoming: list[str] = field(default_factory=list)
    outgoing: list[str] = field(default_factory=list)


@dataclass
class ExecutionDAG:
    """@classdesc 执行 DAG"""

    nodes: dict[str, DAGNode] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


def build_execution_dag(
    transform_files: dict[str, TransformFile],
    schema_ids: set[str],
    regex_files: dict[str, RegexNodeFile] | None = None,
) -> ExecutionDAG:
    """@methoddesc 从 Transform 和 Regex 文件构建执行 DAG

    参数:
        transform_files: {transform_id: TransformFile}
        schema_ids: 所有 schema 表 ID 集合
        regex_files: {regex_id: RegexNodeFile}，仅 match_mode="extract" 的节点会被加入 DAG

    返回:
        ExecutionDAG 实例
    """
    dag = ExecutionDAG()

    # 1. 注册所有 transform 节点
    for tid, tfile in transform_files.items():
        if not tfile.enabled:
            continue
        dag.nodes[tid] = DAGNode(
            id=tid,
            node_type="transform",
            data=tfile,
        )

    # 2. 注册所有 schema 数据源节点（虚拟节点，用于连接）
    for sid in schema_ids:
        dag.nodes[sid] = DAGNode(
            id=sid,
            node_type="schema",
            data=None,
        )

    # 3. 注册 extract 模式的 regex 节点
    if regex_files:
        for rid, rfile in regex_files.items():
            if not rfile.enabled or rfile.match_mode != "extract":
                continue
            dag.nodes[rid] = DAGNode(
                id=rid,
                node_type="regex",
                data=rfile,
            )

    # 4. 建立边（input_from_node → node）
    dangling_nodes: list[str] = []
    for tid, tfile in transform_files.items():
        if not tfile.enabled:
            continue
        input_node = tfile.input_from_node
        if input_node and input_node in dag.nodes:
            dag.nodes[tid].incoming.append(input_node)
            dag.nodes[input_node].outgoing.append(tid)
        elif input_node and input_node not in dag.nodes:
            logger.warning("[DAG] Transform '%s' 的上游节点 '%s' 不存在（悬空依赖）", tid, input_node)
            dangling_nodes.append(f"{tid} -> {input_node}")

    if regex_files:
        for rid, rfile in regex_files.items():
            if not rfile.enabled or rfile.match_mode != "extract":
                continue
            input_node = rfile.input_from_node
            if not input_node and rfile.source_ref:
                input_node = rfile.source_ref.table_id
            if input_node and input_node in dag.nodes:
                dag.nodes[rid].incoming.append(input_node)
                dag.nodes[input_node].outgoing.append(rid)
            elif input_node and input_node not in dag.nodes:
                logger.warning("[DAG] Regex '%s' 的上游节点 '%s' 不存在（悬空依赖）", rid, input_node)
                dangling_nodes.append(f"{rid} -> {input_node}")

    if dangling_nodes:
        dag.metadata["dangling_nodes"] = dangling_nodes

    return dag


# 向后兼容别名
build_transform_dag = build_execution_dag
