"""
@fileoverview DAG 执行器

功能概述:
- 按拓扑顺序执行 DAG 中的 transform 节点
- 管理每个节点的输出 DataFrame
- 将 transform 结果写回 parsed_datasets

数据流:
    schema 数据源 → [transform] → [transform] → ...
    每个节点的输出 DataFrame 存储在 node_outputs 中
"""

from __future__ import annotations

import logging
import re

import pandas as pd

from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile
from app.shared.domain.transforms import create_runner

from .builder import ExecutionDAG
from .sorter import topological_sort

logger = logging.getLogger(__name__)


def execute_transform_dag(
    dag: ExecutionDAG,
    parsed_datasets: dict[str, pd.DataFrame],
) -> tuple[dict[str, pd.DataFrame], list[dict]]:
    """@methoddesc 执行 Transform DAG

    参数:
        dag: 执行 DAG（包含 transform 和 schema 节点）
        parsed_datasets: 已解析的 DataFrame 字典（键为 schema 表 ID）

    返回:
        二元组 (parsed_datasets, dag_errors):
        - parsed_datasets: 更新后的 DataFrame 字典（包含 transform 产生的新列）
        - dag_errors: 节点执行失败产生的错误列表（含节点 ID、类型、原因）。
          回归 #6: 原实现 transform/regex 节点执行异常仅 logger.exception 后把未转换的
          输入复制为输出继续,execute_transform_dag 无错误返回通道,engine 无从感知 →
          下游约束在未转换数据上"假通过"。现在把失败上报给调用方。
    """
    if not dag.nodes:
        return parsed_datasets, []

    order = topological_sort(dag)
    dag_errors: list[dict] = []

    # 使用单一数据源：node_outputs 既是下游输入也是最终结果
    # schema 节点直接引用 parsed_datasets 中的 DataFrame（延迟 copy，按需隔离）
    node_outputs: dict[str, pd.DataFrame] = {}
    schema_ids_in_dag: set[str] = set()

    for sid, df in parsed_datasets.items():
        if sid in dag.nodes:
            node_outputs[sid] = df
            schema_ids_in_dag.add(sid)

    for node_id in order:
        node = dag.nodes[node_id]
        if node.node_type == "schema":
            continue

        if node.node_type == "transform":
            tfile: TransformFile = node.data
            if not tfile or not tfile.enabled:
                continue

            input_node_id = tfile.input_from_node or node_id
            input_df = node_outputs.get(input_node_id)

            if input_df is None:
                logger.warning(f"Transform '{node_id}' 的输入节点 '{input_node_id}' 无可用数据，跳过")
                continue

            input_column = tfile.input_column
            if input_column and input_column not in input_df.columns:
                logger.warning(f"Transform '{node_id}' 的输入列 '{input_column}' 不存在，跳过")
                continue

            try:
                runner = create_runner(tfile.type)
                output_df = runner.execute(
                    input_df.copy(),
                    input_column or input_df.columns[0],
                    tfile.params,
                    tfile.output_columns,
                )
                node_outputs[node_id] = output_df

                # 将 transform 结果合并回输入节点的输出
                # 统一通过 node_outputs 操作，消除双数据源同步问题
                if input_node_id in node_outputs:
                    existing_df = node_outputs[input_node_id]
                    if len(output_df) != len(existing_df):
                        # 行数改变（如 FilterRows/DropDuplicates/Aggregate）：整体替换
                        node_outputs[input_node_id] = output_df.copy()
                    else:
                        # 行数不变：按列贴回
                        # 如果 existing_df 与 parsed_datasets 共享引用，先隔离再修改
                        if input_node_id in schema_ids_in_dag:
                            existing_df = existing_df.copy()
                            node_outputs[input_node_id] = existing_df
                            schema_ids_in_dag.discard(input_node_id)
                        for col in tfile.output_columns:
                            if col in output_df.columns:
                                existing_df[col] = output_df[col].values
            except Exception as e:
                logger.exception(f"Transform '{node_id}' 执行失败: {e}")
                node_outputs[node_id] = input_df.copy()
                dag_errors.append(
                    {
                        "error_type": "TransformExecutionError",
                        "node_id": node_id,
                        "node_type": "transform",
                        "message": f"Transform '{node_id}' 执行失败: {e}",
                    }
                )

        elif node.node_type == "regex":
            rfile: RegexNodeFile = node.data
            if not rfile or not rfile.enabled:
                continue

            input_node_id = rfile.input_from_node or ""
            if not input_node_id and rfile.source_ref:
                input_node_id = rfile.source_ref.table_id

            input_df = node_outputs.get(input_node_id) if input_node_id else None
            if input_df is None:
                logger.warning(f"Regex '{node_id}' 的输入节点无可用数据，跳过")
                continue

            input_column = rfile.input_column or rfile.source_column_name
            if not input_column or input_column not in input_df.columns:
                logger.warning(f"Regex '{node_id}' 的输入列 '{input_column}' 不存在，跳过")
                continue

            pattern_str = rfile.pattern
            if not pattern_str:
                logger.warning(f"Regex '{node_id}' 未配置直接模式 pattern（uses_pattern 暂不支持 DAG 执行），跳过")
                continue

            try:
                # 透传 rfile.flags / case_sensitive（过去完全忽略，导致大小写等配置在 DAG 提取时失效）
                re_flags = 0
                flag_str = str(getattr(rfile, "flags", "") or "")
                if "i" in flag_str or "ignorecase" in flag_str.lower():
                    re_flags |= re.IGNORECASE
                if "m" in flag_str or "multiline" in flag_str.lower():
                    re_flags |= re.MULTILINE
                if "s" in flag_str or "dotall" in flag_str.lower():
                    re_flags |= re.DOTALL
                if getattr(rfile, "case_sensitive", True) is False:
                    re_flags |= re.IGNORECASE

                compiled = re.compile(pattern_str, re_flags)
                extracted = input_df[input_column].astype(str).str.extract(compiled)
                output_df = input_df.copy()
                # 按位置映射 output_columns 到 extracted 列（支持无名捕获组）
                for i, col in enumerate(rfile.output_columns or []):
                    if i < len(extracted.columns):
                        output_df[col] = extracted.iloc[:, i].values
                node_outputs[node_id] = output_df

                # 将提取的列合并回输入节点的输出
                if input_node_id in node_outputs:
                    existing_df = node_outputs[input_node_id]
                    # 如果与 parsed_datasets 共享引用，先隔离再修改
                    if input_node_id in schema_ids_in_dag:
                        existing_df = existing_df.copy()
                        node_outputs[input_node_id] = existing_df
                        schema_ids_in_dag.discard(input_node_id)
                    for col in rfile.output_columns or []:
                        if col in output_df.columns:
                            existing_df[col] = output_df[col].values
            except Exception as e:
                logger.exception(f"Regex '{node_id}' 执行失败: {e}")
                node_outputs[node_id] = input_df.copy()
                dag_errors.append(
                    {
                        "error_type": "RegexExecutionError",
                        "node_id": node_id,
                        "node_type": "regex",
                        "message": f"Regex '{node_id}' 执行失败: {e}",
                    }
                )

    # 最终：将 node_outputs 中 schema 节点的结果写回 parsed_datasets
    for sid in parsed_datasets:
        if sid in node_outputs:
            parsed_datasets[sid] = node_outputs[sid]

    return parsed_datasets, dag_errors
