"""
@fileoverview 模板展开器

功能概述:
- 将模板定义 + 参数绑定值展开为标准的 TransformFile / ConstraintFile / RegexNodeFile
- 处理参数占位符替换 ({{param_id}})
- 处理 ID 命名空间映射 ({instance_id}__{local_id})
- 处理 input_from_node 引用解析（{{input_anchor}} → 上游节点）

架构设计:
- 展开在项目加载阶段完成（config-time expansion）
- 校验引擎（DAG Builder / Validator）看到的永远是展开后的标准文件
- 展开结果直接合并到 transform_files / constraint_files / regex_files

输入示例:
    expand_template(
        template=TemplateFile(id="age_check", nodes=[...], parameters=[...]),
        instance_id="users_age_check",
        params={"source_column": "id_card", "min_age": 18},
        input_from_node="users",
    )

输出示例:
    (
        [TransformFile(id="users_age_check__extract", type="Substring", ...)],
        [ConstraintFile(id="users_age_check__check", type="Range", ...)],
        [],
    )
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.shared.core.project.constraint.types.constraint_file import ConstraintFile
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile

from .types import TemplateFile

logger = logging.getLogger(__name__)

# 占位符匹配模式：{{param_id}}
_PLACEHOLDER_PATTERN = re.compile(r"\{\{(\w+)\}\}")

# 输入锚点占位符
_INPUT_ANCHOR_PLACEHOLDER = "{{input_anchor}}"


def expand_template(
    template: TemplateFile,
    instance_id: str,
    params: dict[str, Any],
    input_from_node: str,
) -> tuple[list[TransformFile], list[ConstraintFile], list[RegexNodeFile]]:
    """@methoddesc 展开模板实例为标准配置文件

    参数:
        template: 模板定义
        instance_id: 实例 ID（全局唯一）
        params: 参数绑定值
        input_from_node: 上游节点 ID（连接到的 Schema/TransformOutput/manualData）

    返回:
        (transforms, constraints, regex_nodes) 三元组

    异常:
        ValueError: 缺少必填参数
    """
    # 步骤 1：解析参数（合并绑定值和默认值）
    resolved_params = _resolve_parameters(template, params)

    # 步骤 2：构建 ID 命名空间映射 {local_id → global_id}
    id_map = {}
    for node in template.nodes:
        id_map[node.id] = f"{instance_id}__{node.id}"

    # 步骤 3：展开各节点
    transforms: list[TransformFile] = []
    constraints: list[ConstraintFile] = []
    regex_nodes: list[RegexNodeFile] = []

    for node in template.nodes:
        if not node.enabled:
            continue

        try:
            global_id = id_map[node.id]

            # 解析 input_from_node
            effective_input = _resolve_input_from_node(node.input_from_node, id_map, input_from_node)

            # 递归替换参数占位符
            resolved_node_params = _resolve_value(node.params, resolved_params)
            resolved_refs = _resolve_value(node.refs, resolved_params)
            resolved_output_cols = _resolve_value(node.output_columns, resolved_params)
            resolved_input_col = _resolve_value(node.input_column, resolved_params)

            # 根据类型创建对应文件
            if node.kind == "transform":
                tf = TransformFile(
                    id=global_id,
                    type=node.type,
                    enabled=True,
                    description=node.description,
                    input_from_node=effective_input,
                    input_column=resolved_input_col,
                    params=resolved_node_params,
                    output_columns=resolved_output_cols,
                )
                transforms.append(tf)

            elif node.kind == "constraint":
                cf = ConstraintFile(
                    id=global_id,
                    type=node.type,
                    enabled=True,
                    description=node.description,
                    refs=resolved_refs,
                    params=resolved_node_params,
                    input_from_node=effective_input,
                )
                constraints.append(cf)

            elif node.kind == "regex":
                rf = RegexNodeFile(
                    id=global_id,
                    name=node.description or global_id,
                    pattern=resolved_node_params.get("pattern", ""),
                    enabled=True,
                    input_from_node=effective_input,
                    input_column=resolved_input_col,
                    output_columns=resolved_output_cols,
                )
                regex_nodes.append(rf)

        except Exception as e:
            logger.warning(f"模板 '{template.id}' 的节点 '{node.id}' 展开失败: {e}")
            continue

    logger.debug(
        f"模板 '{template.id}' 实例 '{instance_id}' 展开完成: "
        f"{len(transforms)} transforms, {len(constraints)} constraints, {len(regex_nodes)} regex"
    )
    return transforms, constraints, regex_nodes


def _resolve_parameters(
    template: TemplateFile,
    params: dict[str, Any],
) -> dict[str, Any]:
    """解析参数：合并用户绑定值和默认值，校验必填参数"""
    resolved: dict[str, Any] = {}

    for param in template.parameters:
        if param.id in params:
            resolved[param.id] = params[param.id]
        elif param.default is not None:
            resolved[param.id] = param.default
        elif param.required:
            raise ValueError(f"模板 '{template.id}' 缺少必填参数: {param.id}")

    return resolved


def _resolve_input_from_node(
    raw_input: str | None,
    id_map: dict[str, str],
    external_input: str,
) -> str | None:
    """解析节点的 input_from_node 字段

    三种情况:
        - None: 无上游
        - "{{input_anchor}}": 模板输入锚点，替换为外部上游节点 ID
        - 模板内部引用: 映射为全局 ID
    """
    if raw_input is None:
        return None

    if raw_input == _INPUT_ANCHOR_PLACEHOLDER:
        return external_input

    # 检查是否是模板内部引用
    if raw_input in id_map:
        return id_map[raw_input]

    # 可能本身就是一个外部节点 ID（直接引用 schema 等）
    return raw_input


def _resolve_value(value: Any, params: dict[str, Any]) -> Any:
    """递归替换值中的 {{param_id}} 占位符

    遍历 dict/list/str，对字符串中的占位符进行替换。
    非字符串类型（int/float/bool/None）原样返回。
    """
    if isinstance(value, str):
        # 检查整个字符串是否就是一个占位符（如 "{{min_age}}"）
        match = _PLACEHOLDER_PATTERN.fullmatch(value.strip())
        if match:
            param_id = match.group(1)
            if param_id in params:
                return params[param_id]
            return value

        # 字符串中包含嵌入的占位符，做文本替换
        def _replace(m: re.Match) -> str:
            param_id = m.group(1)
            if param_id in params:
                return str(params[param_id])
            return m.group(0)

        return _PLACEHOLDER_PATTERN.sub(_replace, value)

    elif isinstance(value, dict):
        return {k: _resolve_value(v, params) for k, v in value.items()}

    elif isinstance(value, list):
        return [_resolve_value(item, params) for item in value]

    return value
