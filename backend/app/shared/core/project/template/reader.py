"""
@fileoverview 模板配置文件读取模块

功能概述:
- 读取并解析 *.template.yaml 配置文件
- 使用 Pydantic 模型进行数据验证

输入示例:
    template_path = Path("/path/to/project/templates/age_check.template.yaml")

    # 文件内容:
    # version: 2
    # id: age_check
    # name: 年龄校验
    # parameters:
    #   - id: source_column
    #     type: string
    #     label: 列名
    #     required: true
    # nodes:
    #   - id: check_range
    #     kind: constraint
    #     type: Range
    #     params:
    #       min: "{{min_age}}"

输出示例:
    TemplateFile(
        id="age_check",
        name="年龄校验",
        parameters=[TemplateParameter(id="source_column", ...)],
        nodes=[TemplateNode(id="check_range", ...)],
    )
"""

from __future__ import annotations

from pathlib import Path

import yaml  # type: ignore[import-untyped]

from .types import TemplateFile


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
