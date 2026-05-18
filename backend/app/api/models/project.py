# backend/app/api/models/project.py
"""
@fileoverview 项目相关请求/响应模型

功能概述:
- 定义项目配置相关的 Pydantic 数据模型
- 包含项目详情、路径配置、项目配置文件结构、通用响应等模型

输入示例:
    ProjectConfigModel(
        project_id="my-project",
        project_name="My Data Project",
        paths=PathsModel(schemas="schemas/", constraints="constraints/")
    )

输出示例:
    ProjectDetail(
        project_id="my-project",
        project_name="My Data Project",
        schemas_count=5,
        constraints_count=10
    )
"""

from typing import Optional

from pydantic import BaseModel, Field


class ProjectDetail(BaseModel):
    """
    用于描述当前活动项目的详细信息模型

    该模型在项目概览或项目列表接口中使用，
    展示项目的核心统计信息和基本标识。

    Attributes:
        project_id: 项目唯一标识符
        project_name: 项目显示名称
        schemas_count: 项目中定义的 Schema 数量
        constraints_count: 项目中定义的约束规则数量
        last_validated: 最后一次验证的时间戳（ISO 格式），预留字段
    """

    project_id: str
    project_name: str
    schemas_count: int
    constraints_count: int
    last_validated: Optional[str] = None


class PathsModel(BaseModel):
    """
    定义项目中各类配置文件的路径配置模型

    用于配置 Schema、Constraints、Patterns 等配置文件
    相对于项目根目录的存放路径。

    Attributes:
        schemas: Schema 配置文件存放目录路径
        constraints: Constraints 约束规则文件存放目录路径
        patterns: Patterns 模式匹配规则文件存放目录路径（可选）
    """

    schemas: str = Field(..., title="表结构 (Schemas) 路径")
    constraints: str = Field(..., title="约束规则 (Constraints) 路径")
    patterns: Optional[str] = Field(None, title="模式 (Patterns) 路径")


class ProjectConfigModel(BaseModel):
    """
    定义 project.yaml 完整结构的数据模型

    该模型对应项目根目录下的 project.yaml 配置文件，
    包含项目的全局配置信息。

    Attributes:
        project_id: 项目唯一标识符
        project_name: 项目显示名称
        paths: 各类配置文件的路径设置（嵌套 PathsModel）
    """

    project_id: str = Field(..., title="项目ID")
    project_name: str = Field(..., title="项目名称")
    paths: PathsModel


class StandardResponse(BaseModel):
    """
    定义通用消息响应模型

    用于简单的文本响应场景，如确认消息、状态更新等。

    Attributes:
        message: 响应消息内容
    """

    message: str
