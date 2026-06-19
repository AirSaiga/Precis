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

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.api.models import StandardResponse
from app.api.models.connection_rules import ConnectionRulesModel
from app.shared.core.io.yaml import read_yaml, write_yaml

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/latest/connection-rules",
    tags=["Connection Rules"],
)

CONNECTION_RULES_FILENAME = "connection-rules.precis.yaml"


def _rules_path(config_path: str) -> str:
    return os.path.join(config_path, CONNECTION_RULES_FILENAME)


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
