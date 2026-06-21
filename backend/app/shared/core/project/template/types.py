"""
@fileoverview 模板数据模型定义

功能概述:
- 定义模板内部节点 (TemplateNode)
- 定义模板文件根模型 (TemplateFile)

架构设计:
- TemplateFile 是 *.template.yaml 文件解析后的根 Pydantic 模型
- 模板内节点 ID 为局部命名空间，展开时映射为全局 ID
- 模板节点存完整默认值，无参数占位符替换机制
- 展开后用户直接在画布上编辑内部节点

输入示例:
    TemplateFile(
        id="age_check",
        name="年龄校验",
        nodes=[
            TemplateNode(id="md1", kind="manualData", type="ManualData", column_name="age", rows=[["18"]]),
            TemplateNode(id="check_range", kind="constraint", type="Range", input_from_node="md1", params={"min": 0, "max": 120}),
        ],
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TemplateNode(BaseModel):
    """@classdesc 模板内部 DAG 节点

    字段说明:
        - id: 模板内局部 ID（展开时映射为 {instance_id}__{local_id}）
        - kind: 节点类型分类（transform/constraint/regex/manualData）
        - type: 具体类型名称（如 StringSplit/Range/NotNull 等）；manualData kind 时固定为 "ManualData"
        - input_from_node: 上游节点 ID（仅支持模板内部节点引用）
        - input_column: 输入列名
        - params: 转换/约束参数（完整默认值）
        - output_columns: 输出列名列表
        - refs: 约束引用区
        - enabled: 是否启用
        - description: 描述
        - column_name: manualData 专用 — 列名
        - rows: manualData 专用 — 占位数据（二维字符串数组）
        - column_data_type: manualData 专用 — 列数据类型
    """

    id: str
    kind: Literal["transform", "constraint", "regex", "manualData"]
    type: str
    input_from_node: str | None = None
    input_column: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    output_columns: list[str] = Field(default_factory=list)
    refs: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None
    enabled: bool = True
    # manualData 专用字段
    column_name: str = ""
    rows: list[list[str]] = Field(default_factory=list)
    column_data_type: str = "string"


class TemplateParameter(BaseModel):
    """@classdesc 模板参数声明

    字段说明:
        - name: 参数名（对应节点值中的 {{name}} 占位符）
        - default: 参数默认值（实例未提供该参数时使用）
    """

    name: str
    default: Any = None


class TemplateFile(BaseModel):
    """@classdesc 模板定义文件根模型

    对应 *.template.yaml 文件的结构。
    展开时由 expander 将节点映射为标准的 TransformFile/ConstraintFile/RegexNodeFile/ManualDataFile。

    字段说明:
        - version: 配置版本号（固定为 2）
        - id: 模板唯一标识
        - name: 模板显示名称
        - description: 模板描述
        - parameters: 参数声明列表（展开时对节点值中的 {{param}} 占位符做替换）
        - nodes: 内部 DAG 节点列表
    """

    version: int = Field(2, description="配置版本号（固定为 2）")
    id: str = Field(..., description="模板唯一标识")
    name: str = Field(..., description="模板显示名称")
    description: str | None = Field(None, description="模板描述")
    parameters: list[TemplateParameter] = Field(default_factory=list, description="参数声明列表")
    nodes: list[TemplateNode] = Field(default_factory=list, description="内部 DAG 节点列表")
