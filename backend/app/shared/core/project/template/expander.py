"""
@fileoverview 模板展开器

功能概述:
- 将模板定义展开为标准的 TransformFile / ConstraintFile / RegexNodeFile / ManualDataFile
- 处理 ID 命名空间映射 ({instance_id}__{local_id})
- 处理 input_from_node 内部引用映射
- 支持 {{param}} 占位符替换（实例参数覆盖模板默认值）

架构设计:
- 展开在项目加载阶段完成（config-time expansion）
- 校验引擎（DAG Builder / Validator）看到的永远是展开后的标准文件
- 展开结果直接合并到 transform_files / constraint_files / regex_files / manual_data_files
- 参数替换: 先用模板声明的默认值构建 baseline params，再用实例 params 覆盖，
  最后对节点值中的 {{param}} 占位符做替换

输入示例:
    expand_template(
        template=TemplateFile(id="age_check", parameters=[...], nodes=[...]),
        instance_id="users_age_check",
        params={"min_age": 18, "max_age": 100},
        input_from_node="users-users",
    )

输出示例:
    (
        [TransformFile(id="users_age_check__extract", type="Substring", ...)],
        [ConstraintFile(id="users_age_check__check", type="Range", params={"min":18,"max":100})],
        [],
        [],
    )
"""

from __future__ import annotations

import logging
import re
from typing import Any, cast

from app.shared.core.project.constraint.types.constraint_file import ConstraintFile
from app.shared.core.project.manual_data.types import ManualDataFile
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile

from .types import TemplateFile

logger = logging.getLogger(__name__)

# {{param}} 占位符正则
_PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def _build_effective_params(
    template: TemplateFile,
    params: dict[str, Any] | None,
    input_from_node: str | None,
) -> dict[str, Any]:
    """合并模板默认参数 + 实例参数，构造最终替换值表。

    优先级: 实例 params > 模板 parameter.default。input_from_node 单独注入。
    """
    effective: dict[str, Any] = {}
    for decl in template.parameters:
        effective[decl.name] = decl.default
    if params:
        effective.update(params)
    # input_from_node 作为特殊参数注入（供 {{input_from_node}} 占位符使用）
    if input_from_node is not None:
        effective["input_from_node"] = input_from_node
    return effective


def _substitute(value: Any, params: dict[str, Any]) -> Any:
    """递归替换 value 中的 {{param}} 占位符。

    - 字符串: 替换占位符；若整串就是单个占位符，返回原始类型（int/str 等）
    - dict/list: 递归处理
    - 其他类型: 原样返回
    """
    if isinstance(value, str):
        # 整串恰好是单个占位符 → 返回原始类型值（保留 int 等）
        single = _PLACEHOLDER_RE.fullmatch(value.strip())
        if single and single.group(1) in params:
            return params[single.group(1)]

        # 否则做子串替换（结果始终为字符串）
        def _repl(m: re.Match[str]) -> str:
            key = m.group(1)
            return str(params.get(key, m.group(0)))

        return _PLACEHOLDER_RE.sub(_repl, value)
    if isinstance(value, dict):
        return {k: _substitute(v, params) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, params) for v in value]
    return value


def expand_template(
    template: TemplateFile,
    instance_id: str,
    params: dict[str, Any] | None = None,
    input_from_node: str | None = None,
) -> tuple[list[TransformFile], list[ConstraintFile], list[RegexNodeFile], list[ManualDataFile]]:
    """@methoddesc 展开模板实例为标准配置文件

    参数:
        template: 模板定义
        instance_id: 实例 ID（全局唯一）
        params: 实例参数绑定值（覆盖模板默认值），默认 None
        input_from_node: 实例级上游节点 ID（通常指向 Schema），默认 None

    返回:
        (transforms, constraints, regex_nodes, manual_data_files) 四元组
    """
    # 构建最终替换值表（默认值 ← 实例 params ← input_from_node）
    effective_params = _build_effective_params(template, params, input_from_node)

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

            # 参数替换：对节点各字段中的 {{param}} 占位符做替换
            substituted_input = _substitute(node.input_from_node, effective_params)
            substituted_input_column = _substitute(node.input_column, effective_params)
            substituted_params = _substitute(node.params, effective_params)
            substituted_refs = _substitute(node.refs, effective_params)
            substituted_output_columns = _substitute(node.output_columns, effective_params)
            substituted_column_name = _substitute(node.column_name, effective_params)

            # 解析 input_from_node（替换后的值）
            effective_input = _resolve_input_from_node(substituted_input, id_map)

            # 根据类型创建对应文件
            if node.kind == "transform":
                tf = TransformFile(
                    version=2,
                    id=global_id,
                    type=cast(Any, node.type),
                    enabled=True,
                    description=node.description,
                    input_from_node=effective_input,
                    input_column=substituted_input_column,
                    params=substituted_params,
                    output_columns=substituted_output_columns,
                )
                transforms.append(tf)

            elif node.kind == "constraint":
                cf = ConstraintFile(
                    version=2,
                    id=global_id,
                    type=cast(Any, node.type),
                    enabled=True,
                    description=node.description,
                    refs=substituted_refs,
                    params=substituted_params,
                    input_from_node=effective_input,
                    input_column=substituted_input_column,
                )
                constraints.append(cf)

            elif node.kind == "regex":
                rf = RegexNodeFile(
                    version=2,
                    id=global_id,
                    name=node.description or global_id,
                    description=node.description,
                    pattern=substituted_params.get("pattern", "") if isinstance(substituted_params, dict) else "",
                    uses_pattern=None,
                    match_mode="full",
                    case_sensitive=False,
                    flags="",
                    enabled=True,
                    input_from_node=effective_input,
                    input_column=substituted_input_column,
                    output_columns=substituted_output_columns,
                    source_ref=None,
                    source_column_name=None,
                )
                regex_nodes.append(rf)

            elif node.kind == "manualData":
                mdf = ManualDataFile(
                    version=2,
                    id=global_id,
                    column_name=substituted_column_name or "Column1",
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
