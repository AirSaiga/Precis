"""
@fileoverview 模板配置文件读取模块

功能概述:
- 读取并解析 *.template.yaml 配置文件
- 使用 Pydantic 模型进行数据验证
- 校验模板结构合法性（至少 1 个 manualData + 1 个 constraint）

输入示例:
    template_path = Path("/path/to/project/templates/age_check.template.yaml")

    # 文件内容:
    # version: 2
    # id: age_check
    # name: 年龄校验
    # nodes:
    #   - id: md1
    #     kind: manualData
    #     type: ManualData
    #     column_name: age
    #     rows: [["18"]]
    #   - id: check_range
    #     kind: constraint
    #     type: Range
    #     input_from_node: md1
    #     params:
    #       min_value: 0
    #       max_value: 120

输出示例:
    TemplateFile(
        id="age_check",
        name="年龄校验",
        nodes=[TemplateNode(id="md1", ...), TemplateNode(id="check_range", ...)],
    )
"""

from __future__ import annotations

from pathlib import Path

import yaml

from .types import TemplateFile


def validate_template_structure(template: TemplateFile) -> None:
    """@methoddesc 校验模板结构合法性

    模板必须满足以下条件：
    - 至少 1 个 manualData 节点（作为输入起点）
    - 至少 1 个 constraint 节点（作为校验终点）
    - 节点 ID 全局唯一
    - 非 manualData 节点的 input_from_node 必须指向模板内部节点

    参数:
        template: 模板定义

    异常:
        ValueError: 模板结构不合法
    """
    enabled_nodes = [n for n in template.nodes if n.enabled]
    has_manual_data = any(n.kind == "manualData" for n in enabled_nodes)
    has_constraint = any(n.kind == "constraint" for n in enabled_nodes)

    if not has_manual_data:
        raise ValueError(f"模板 '{template.id}' 结构不合法：至少需要 1 个启用的 manualData 节点作为输入起点")
    if not has_constraint:
        raise ValueError(f"模板 '{template.id}' 结构不合法：至少需要 1 个启用的 constraint 节点作为校验终点")

    # 节点 ID 唯一性校验
    seen_ids: set[str] = set()
    duplicate_ids: set[str] = set()
    for node in template.nodes:
        if node.id in seen_ids:
            duplicate_ids.add(node.id)
        seen_ids.add(node.id)
    if duplicate_ids:
        raise ValueError(f"模板 '{template.id}' 结构不合法：存在重复节点 ID {sorted(duplicate_ids)}")

    # 连通性校验：非 manualData 节点只能引用模板内部节点
    enabled_node_ids = {n.id for n in enabled_nodes}
    for node in enabled_nodes:
        if node.kind == "manualData":
            continue
        input_from = node.input_from_node
        if input_from is not None and input_from not in enabled_node_ids:
            raise ValueError(
                f"模板 '{template.id}' 结构不合法：节点 '{node.id}' 的 input_from_node "
                f"指向模板外部节点 '{input_from}'，模板必须自包含"
            )


def load_template(template_path: Path) -> TemplateFile:
    """@methoddesc 加载模板配置文件

    参数:
        template_path: 模板文件路径

    返回:
        TemplateFile 对象
    """
    with open(template_path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return TemplateFile.model_validate(raw)
