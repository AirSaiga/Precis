"""
@fileoverview 模板引用类型定义

功能概述:
- TemplateRef: 模板定义文件的引用（id + path）
- TemplateInstanceRef: 模板实例的引用（含参数绑定值）

架构设计:
- 与 SchemaRef / ConstraintRef 等保持一致的结构
- TemplateInstanceRef 额外包含 template_id 和 params 字段
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TemplateRef(BaseModel):
    """@classdesc 模板定义文件引用

    字段说明:
        - id: 模板唯一标识（必须与 .template.yaml 文件中的 id 一致）
        - path: 模板文件路径（相对于 manifest 所在目录）
    """

    id: str
    path: str


class TemplateInstanceRef(BaseModel):
    """@classdesc 模板实例引用

    字段说明:
        - id: 实例唯一标识（全局唯一）
        - template_id: 引用的模板 ID
        - enabled: 是否启用
        - params: 参数绑定值（覆盖模板声明的默认值，展开时对 {{param}} 占位符做替换）
        - input_from_node: 实例级上游节点 ID（通常指向 Schema，覆盖节点级 input_from_node）

    展开行为:
        加载时由 expander 将此实例展开为一组 TransformFile / ConstraintFile / RegexNodeFile / ManualDataFile，
        展开后的节点 ID 格式为 {instance_id}__{local_node_id}。
    """

    id: str = Field(..., description="实例 ID（全局唯一）")
    template_id: str = Field(..., description="引用的模板 ID")
    enabled: bool = Field(True, description="是否启用")
    params: dict[str, Any] = Field(default_factory=dict, description="参数绑定值")
    input_from_node: str | None = Field(None, description="实例级上游节点 ID（通常指向 Schema）")
