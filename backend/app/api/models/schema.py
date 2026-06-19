# backend/app/api/models/schema.py
"""
@fileoverview Schema 相关请求/响应模型

功能概述:
- 定义 Schema 文件操作相关的 Pydantic 数据模型
- 包含 Schema 保存请求/响应、表头行变更请求/响应等模型

输入示例:
    SchemaSaveRequest(
        action="save_schema",
        schema_name="users",
        yaml_content="version: 2\nid: users\n...",
        saved_at="2024-01-01T00:00:00Z"
    )

输出示例:
    SchemaSaveResponse(
        success=True,
        message="Schema saved successfully",
        schema_name="users",
        saved_at="2024-01-01T00:00:00Z"
    )
"""

from typing import Optional

from pydantic import BaseModel, Field


class SchemaSaveRequest(BaseModel):
    """
    Schema 保存请求模型

    前端保存 Schema 配置文件时发送的请求体。

    Attributes:
        action: 操作类型，固定为 'save_schema'
        schema_name: Schema 名称（不含 .yaml 后缀）
        yaml_content: YAML 格式的 Schema 内容
        saved_at: 保存时间（ISO 格式时间戳）
    """

    action: str = Field(..., description="操作类型，固定为'save_schema'")
    schema_name: str = Field(..., description="Schema名称")
    yaml_content: str = Field(..., description="YAML格式的Schema内容")
    saved_at: str = Field(..., description="保存时间")


class SchemaSaveResponse(BaseModel):
    """
    Schema 保存响应模型

    Schema 保存操作的结果响应。

    Attributes:
        success: 保存是否成功
        message: 保存结果消息
        schema_name: Schema 名称
        saved_at: 保存时间
    """

    success: bool = Field(..., description="保存是否成功")
    message: str = Field(..., description="保存结果消息")
    schema_name: str = Field(..., description="Schema名称")
    saved_at: str = Field(..., description="保存时间")


class HeaderRowChangedRequest(BaseModel):
    """
    表头行变更请求模型

    用户在 UI 中修改数据表的表头行位置时发送的请求。

    Attributes:
        action: 操作类型，固定为 'header_row_changed'
        node_id: 源预览节点 ID
        header_row: 新的表头行索引（0 表示第一行）
        old_header_row: 旧的表头行索引
        row_data: 表头行数据（可选）
        schema_name: 关联的 Schema 名称（可选）
    """

    action: str = Field(..., description="操作类型，固定为'header_row_changed'")
    node_id: str = Field(..., description="源预览节点ID")
    header_row: Optional[int] = Field(None, description="新的表头行索引")
    old_header_row: Optional[int] = Field(None, description="旧的表头行索引")
    row_data: Optional[dict] = Field(None, description="表头行数据")
    schema_name: Optional[str] = Field(None, description="关联的Schema名称")


class HeaderRowChangedResponse(BaseModel):
    """
    表头行变更响应模型

    表头行变更操作的结果响应。

    Attributes:
        success: 更新是否成功
        message: 更新结果消息
        schema_name: 关联的 Schema 名称（可选）
        updated_at: 更新时间（可选）
    """

    success: bool = Field(..., description="更新是否成功")
    message: str = Field(..., description="更新结果消息")
    schema_name: Optional[str] = Field(default=None, description="关联的Schema名称")
    updated_at: Optional[str] = Field(default=None, description="更新时间")
