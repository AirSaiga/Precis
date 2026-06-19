# backend/app/api/models/connection_rules.py
"""
@fileoverview 连接规则 API 模型

功能概述:
- 定义连接规则相关的 Pydantic 模型
- 被 connection_rules 路由及外部调用方复用

输入示例:
    {
        "version": "1.0",
        "rules": [
            {
                "id": "schema_to_constraint",
                "name": "Schema -> Constraint",
                "source": {"node_types": ["SchemaNode"]},
                "target": {"node_types": ["ConstraintNode"]}
            }
        ]
    }
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EndpointModel(BaseModel):
    """
    连接端点模型。

    定义连接规则中源端点或目标端点允许连接的节点类型和 handle。
    - node_types: 允许连接的节点类型列表，如 ["SchemaNode", "ConstraintNode"]
    - handles: 可选，限制只允许特定的 handle ID 建立连接
    """

    node_types: list[str] = Field(..., description="允许的节点类型列表")
    handles: list[str] | None = Field(default=None, description="允许的 handle ID 列表")


class ConnectionRuleConfigModel(BaseModel):
    """
    连接规则配置模型。

    定义单条连接规则的附加行为：
    - allow_multiple: 是否允许一个源端点同时连接多个目标端点
    - validation_mode: 验证严格程度，strict 表示完全匹配，loose 表示允许模糊匹配
    """

    allow_multiple: bool | None = Field(default=True, description="是否允许多个连接")
    validation_mode: str | None = Field(default="strict", description="验证模式: strict/loose")


class ConnectionRuleModel(BaseModel):
    """
    单条连接规则模型。

    定义画布中哪类节点可以连接到哪类节点：
    - id: 规则的唯一标识，用于前端快速查找和调试
    - name: 规则的显示名称，供用户阅读
    - source: 源端点定义（哪些节点可以作为连接起点）
    - target: 目标端点定义（哪些节点可以作为连接终点）
    - config: 可选的附加配置（如是否允许多连、验证模式）
    """

    id: str = Field(..., description="规则唯一标识")
    name: str = Field(..., description="规则名称")
    source: EndpointModel = Field(..., description="源端点定义")
    target: EndpointModel = Field(..., description="目标端点定义")
    config: ConnectionRuleConfigModel | None = Field(default=None, description="规则配置")


class ConnectionRulesModel(BaseModel):
    """
    连接规则集合模型。

    作为 connection-rules.precis.yaml 文件的根对象：
    - version: 规则文件格式版本，便于后续格式升级时做兼容处理
    - rules: 具体的连接规则列表，按顺序依次匹配
    """

    version: str = Field(default="1.0", description="规则文件版本")
    rules: list[ConnectionRuleModel] = Field(default=[], description="规则列表")
