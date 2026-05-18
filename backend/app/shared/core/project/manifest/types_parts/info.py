"""
@fileoverview 项目信息类型定义模块

功能概述:
- 定义项目的基本信息结构
- 包括项目 ID 和展示名称

架构设计:
- 轻量级模型: 仅包含必要的基本信息
- 必需字段: id 和 name 都是必填的
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectInfo(BaseModel):
    """@classdesc 项目基本信息

    用于在 manifest.yaml 中定义项目的基本信息。

    字段说明:
        - id: 项目的稳定标识符，用于系统内部引用（不应改变）
        - name: 项目的展示名称，用于 UI 显示

    示例:
        # manifest.yaml 中的定义
        project:
          id: user-management
          name: 用户管理系统

        # 对应的 Python 对象
        ProjectInfo(id="user-management", name="用户管理系统")
    """

    id: str = Field(..., description="项目 ID（稳定标识）")
    name: str = Field(..., description="项目展示名称")
