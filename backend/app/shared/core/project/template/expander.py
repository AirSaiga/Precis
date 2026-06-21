"""
@fileoverview 模板展开器

功能概述:
- 将模板定义展开为标准的 TransformFile / ConstraintFile / RegexNodeFile / ManualDataFile
- 处理 ID 命名空间映射 ({instance_id}__{local_id})
- 处理 input_from_node 内部引用映射

架构设计:
- 展开在项目加载阶段完成（config-time expansion）
- 校验引擎（DAG Builder / Validator）看到的永远是展开后的标准文件
- 展开结果直接合并到 transform_files / constraint_files / regex_files / manual_data_files
- 模板节点存完整默认值，无参数占位符替换机制

输入示例:
    expand_template(
        template=TemplateFile(id="age_check", nodes=[...]),
        instance_id="users_age_check",
    )

输出示例:
    (
        [TransformFile(id="users_age_check__extract", type="Substring", ...)],
        [ConstraintFile(id="users_age_check__check", type="Range", ...)],
        [],
        [],
    )
"""

from __future__ import annotations

import logging
from typing import Any, cast

from app.shared.core.project.constraint.types.constraint_file import ConstraintFile
from app.shared.core.project.manual_data.types import ManualDataFile
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile

from .types import TemplateFile

logger = logging.getLogger(__name__)


def expand_template(
    template: TemplateFile,
    instance_id: str,
) -> tuple[list[TransformFile], list[ConstraintFile], list[RegexNodeFile], list[ManualDataFile]]:
    """@methoddesc 展开模板实例为标准配置文件

    参数:
        template: 模板定义
        instance_id: 实例 ID（全局唯一）

    返回:
        (transforms, constraints, regex_nodes, manual_data_files) 四元组
    """
    # 步骤 1：构建 ID 命名空间映射 {local_id → global_id}
    id_map = {}
    for node in template.nodes:
        id_map[node.id] = f"{instance_id}__{node.id}"

    # 步骤 2：展开各节点
    transforms: list[TransformFile] = []
    constraints: list[ConstraintFile] = []
    regex_nodes: list[RegexNodeFile] = []
    manual_data_files: list[ManualDataFile] = []

    for node in template.nodes:
        if not node.enabled:
            continue

        try:
            global_id = id_map[node.id]

            # 解析 input_from_node
            effective_input = _resolve_input_from_node(node.input_from_node, id_map)

            # 根据类型创建对应文件（节点值直接使用，无占位符替换）
            if node.kind == "transform":
                tf = TransformFile(
                    version=2,
                    id=global_id,
                    type=cast(Any, node.type),
                    enabled=True,
                    description=node.description,
                    input_from_node=effective_input,
                    input_column=node.input_column,
                    params=node.params,
                    output_columns=node.output_columns,
                )
                transforms.append(tf)

            elif node.kind == "constraint":
                cf = ConstraintFile(
                    version=2,
                    id=global_id,
                    type=cast(Any, node.type),
                    enabled=True,
                    description=node.description,
                    refs=node.refs,
                    params=node.params,
                    input_from_node=effective_input,
                    input_column=node.input_column,
                )
                constraints.append(cf)

            elif node.kind == "regex":
                rf = RegexNodeFile(
                    version=2,
                    id=global_id,
                    name=node.description or global_id,
                    description=node.description,
                    pattern=node.params.get("pattern", ""),
                    uses_pattern=None,
                    match_mode="full",
                    case_sensitive=False,
                    flags="",
                    enabled=True,
                    input_from_node=effective_input,
                    input_column=node.input_column,
                    output_columns=node.output_columns,
                    source_ref=None,
                    source_column_name=None,
                )
                regex_nodes.append(rf)

            elif node.kind == "manualData":
                mdf = ManualDataFile(
                    version=2,
                    id=global_id,
                    column_name=node.column_name or "Column1",
                    column_data_type=cast(Any, node.column_data_type or "string"),
                    rows=node.rows,
                    enabled=True,
                    description=node.description,
                    input_from_node=effective_input,
                )
                manual_data_files.append(mdf)

        except Exception as e:
            logger.warning(f"模板 '{template.id}' 的节点 '{node.id}' 展开失败: {e}")
            continue

    logger.debug(
        f"模板 '{template.id}' 实例 '{instance_id}' 展开完成: "
        f"{len(transforms)} transforms, {len(constraints)} constraints, "
        f"{len(regex_nodes)} regex, {len(manual_data_files)} manual_data"
    )
    return transforms, constraints, regex_nodes, manual_data_files


def _resolve_input_from_node(
    raw_input: str | None,
    id_map: dict[str, str],
) -> str | None:
    """解析节点的 input_from_node 字段

    两种情况:
        - None: 无上游
        - 模板内部引用: 映射为全局 ID
    """
    if raw_input is None:
        return None

    # 检查是否是模板内部引用
    if raw_input in id_map:
        return id_map[raw_input]

    # 可能本身就是一个外部节点 ID（直接引用 schema 等）
    return raw_input
