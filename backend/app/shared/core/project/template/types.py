"""
@fileoverview 模板数据模型定义

功能概述:
- 定义模板参数 (TemplateParameter)
- 定义模板内部节点 (TemplateNode)
- 定义输入锚点 (InputAnchor)
- 定义模板文件根模型 (TemplateFile)

架构设计:
- TemplateFile 是 *.template.yaml 文件解析后的根 Pydantic 模型
- 参数占位符使用 {{param_id}} 语法
- 模板内节点 ID 为局部命名空间，展开时映射为全局 ID

输入示例:
    TemplateFile(
        id="age_check",
        name="年龄校验",
        parameters=[TemplateParameter(id="source_column", type="string", label="列名", required=True)],
        nodes=[TemplateNode(id="check_range", kind="constraint", type="Range", params={"min": "{{min_age}}"})],
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TemplateParameter(BaseModel):
    """@classdesc 模板参数定义

    字段说明:
        - id: 参数唯一标识，用于 {{param_id}} 占位符引用
        - type: 参数类型，决定前端表单控件和值校验
        - label: Inspector 面板中显示的名称
        - required: 是否必填（必填且无 default 则展开时报错）
        - default: 默认值（null 表示无默认值）
    """

    id: str
    type: Literal["string", "integer", "decimal", "boolean"]
    label: str
    required: bool = True
    default: Any = None


class TemplateNode(BaseModel):
    """@classdesc 模板内部 DAG 节点

    字段说明:
        - id: 模板内局部 ID（展开时映射为 {instance_id}__{local_id}）
        - kind: 节点类型分类
        - type: 具体类型名称（如 StringSplit/Range/NotNull 等）
        - input_from_node: 上游节点 ID（支持 {{input_anchor}} 占位符）
        - input_column: 输入列名（支持参数占位符）
        - params: 转换/约束参数（支持参数占位符）
        - output_columns: 输出列名列表（支持参数占位符）
        - refs: 约束引用区（支持参数占位符）
        - enabled: 是否启用
        - description: 描述
    """

    id: str
    kind: Literal["transform", "constraint", "regex"]
    type: str
    input_from_node: str | None = None
    input_column: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    output_columns: list[str] = Field(default_factory=list)
    refs: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None
    enabled: bool = True


class InputAnchor(BaseModel):
    """@classdesc 模板输入锚点

    字段说明:
        - id: 锚点标识（模板节点中通过 {{input_anchor}} 引用）
        - label: 显示名称
        - accepts: 可接受的源节点类型列表
    """

    id: str = "input_anchor"
    label: str = "数据源入口"
    accepts: list[str] = Field(default_factory=lambda: ["schema", "transformOutput", "manualData"])


class TemplateFile(BaseModel):
    """@classdesc 模板定义文件根模型

    对应 *.template.yaml 文件的结构。
    展开时由 expander 将参数替换到节点中，生成标准的 TransformFile/ConstraintFile/RegexNodeFile。

    字段说明:
        - version: 配置版本号（固定为 2）
        - id: 模板唯一标识
        - name: 模板显示名称
        - description: 模板描述
        - parameters: 参数定义列表
        - nodes: 内部 DAG 节点列表
        - input_anchor: 输入锚点配置
    """

    version: int = Field(2, description="配置版本号（固定为 2）")
    id: str = Field(..., description="模板唯一标识")
    name: str = Field(..., description="模板显示名称")
    description: str | None = Field(None, description="模板描述")
    parameters: list[TemplateParameter] = Field(default_factory=list, description="参数定义列表")
    nodes: list[TemplateNode] = Field(default_factory=list, description="内部 DAG 节点列表")
    input_anchor: InputAnchor = Field(default_factory=InputAnchor, description="输入锚点配置")
