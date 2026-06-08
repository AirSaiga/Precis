"""
@fileoverview 连接规则 API 路由模块

功能概述:
- 提供节点连接规则的读取、保存和重置接口
- 定义节点类型和 handles 之间的允许连接关系
- 支持 strict（严格）和 loose（宽松）两种验证模式

架构设计:
- 规则持久化在项目根目录的 connection-rules.precis.yaml
- 使用 Pydantic 模型验证规则结构和字段
- 不存在的规则文件返回空规则列表

输入示例:
    PUT /connection-rules
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

输出示例:
    {"message": "连接规则已成功保存！"}
"""

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)

from pydantic import BaseModel, Field

from app.api.dependencies import get_project_config_path
from app.api.models import StandardResponse
from app.shared.core.io.yaml import read_yaml, write_yaml

router = APIRouter(
    prefix="/api/v1/connection-rules",
    tags=["Connection Rules"],
)

CONNECTION_RULES_FILENAME = "connection-rules.precis.yaml"


def _rules_path(config_path: str) -> str:
    return os.path.join(config_path, CONNECTION_RULES_FILENAME)


class EndpointModel(BaseModel):
    """
    连接端点模型。

    定义连接规则中源端点或目标端点允许连接的节点类型和 handle。
    - node_types: 允许连接的节点类型列表，如 ["SchemaNode", "ConstraintNode"]
    - handles: 可选，限制只允许特定的 handle ID 建立连接
    """

    node_types: list[str] = Field(..., description="允许的节点类型列表")
    handles: Optional[list[str]] = Field(default=None, description="允许的 handle ID 列表")


class ConnectionRuleConfigModel(BaseModel):
    """
    连接规则配置模型。

    定义单条连接规则的附加行为：
    - allow_multiple: 是否允许一个源端点同时连接多个目标端点
    - validation_mode: 验证严格程度，strict 表示完全匹配，loose 表示允许模糊匹配
    """

    allow_multiple: Optional[bool] = Field(default=True, description="是否允许多个连接")
    validation_mode: Optional[str] = Field(default="strict", description="验证模式: strict/loose")


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
    config: Optional[ConnectionRuleConfigModel] = Field(default=None, description="规则配置")


class ConnectionRulesModel(BaseModel):
    """
    连接规则集合模型。

    作为 connection-rules.precis.yaml 文件的根对象：
    - version: 规则文件格式版本，便于后续格式升级时做兼容处理
    - rules: 具体的连接规则列表，按顺序依次匹配
    """

    version: str = Field(default="1.0", description="规则文件版本")
    rules: list[ConnectionRuleModel] = Field(default=[], description="规则列表")


@router.get(
    "",
    response_model=ConnectionRulesModel,
    summary="获取当前项目的连接规则",
    responses={
        500: {"description": "加载连接规则失败"},
    },
)
def get_connection_rules(config_path: str = Depends(get_project_config_path)):
    """
    获取当前项目的连接规则。

    使用场景：
    - 前端初始化画布时加载连接规则，用于限制节点间允许的连接关系
    - 用户自定义连接规则后重新加载

    副作用：
    - 如果规则文件不存在，返回默认空规则列表（不报错），保证前端始终能拿到有效数据
    - 如果解析失败，返回 500 错误并附带详细原因

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ConnectionRulesModel: 连接规则集合，包含版本号和规则列表
    """
    rules_file_path = _rules_path(config_path)

    if not os.path.isfile(rules_file_path):
        return ConnectionRulesModel(version="1.0", rules=[])

    try:
        data = read_yaml(Path(rules_file_path))
        if not data:
            return ConnectionRulesModel(version="1.0", rules=[])

        return ConnectionRulesModel(**data)
    except Exception as e:
        logger.error(f"加载连接规则失败: {e}")
        raise HTTPException(status_code=500, detail=f"加载连接规则失败: {str(e)}")


@router.put(
    "",
    response_model=StandardResponse,
    summary="保存当前项目的连接规则",
    responses={
        500: {"description": "保存连接规则失败"},
    },
)
def save_connection_rules(rules: ConnectionRulesModel, config_path: str = Depends(get_project_config_path)):
    """
    保存当前项目的连接规则。

    使用场景：
    - 用户在设置面板中修改连接规则后保存
    - 前端通过可视化编辑器调整节点连接限制后持久化

    副作用：
    - 直接覆盖写入 connection-rules.precis.yaml 文件
    - 使用 exclude_unset=True 避免将未设置的字段写入文件，保持 YAML 整洁

    参数:
        rules: 新的连接规则集合
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    rules_file_path = _rules_path(config_path)

    try:
        data = rules.model_dump(exclude_unset=True)
        write_yaml(Path(rules_file_path), data)
        return {"message": "连接规则已成功保存！"}
    except Exception as e:
        logger.error(f"保存连接规则失败: {e}")
        raise HTTPException(status_code=500, detail=f"保存连接规则失败: {str(e)}")


@router.post(
    "/reset",
    response_model=StandardResponse,
    summary="重置连接规则为默认值",
    responses={
        500: {"description": "重置连接规则失败"},
    },
)
def reset_connection_rules(config_path: str = Depends(get_project_config_path)):
    """
    重置连接规则为默认值。

    使用场景：
    - 用户自定义规则后出现问题，需要恢复系统默认的连接规则
    - 清理项目中的连接规则配置

    副作用：
    - 删除项目根目录下的 connection-rules.precis.yaml 文件
    - 删除后，前端应回退到内置的默认连接规则

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    rules_file_path = _rules_path(config_path)

    try:
        if os.path.isfile(rules_file_path):
            os.remove(rules_file_path)
        return {"message": "连接规则已重置为默认值"}
    except Exception as e:
        logger.error(f"重置连接规则失败: {e}")
        raise HTTPException(status_code=500, detail=f"重置连接规则失败: {str(e)}")
