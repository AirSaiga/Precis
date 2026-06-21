# backend/app/api/models/workspace.py
"""
@fileoverview 工作区请求/响应模型

功能概述:
- 定义工作区和数据源相关的 Pydantic 数据模型
- 包含外部数据源、UI 偏好设置、工作区配置等模型

输入示例:
    WorkspaceConfig(
        version="1.0",
        data_sources=[ExternalDataSource(id="ds1", name="users.xlsx", fileId="...")],
        ui_preferences=UIPreferences(expanded_folders={"schemas": True})
    )

输出示例:
    WorkspaceConfig(
        version="1.0",
        data_sources=[...],
        alias_mappings={"/path/to/file.xlsx": "users"},
        last_updated="2024-01-01T00:00:00Z"
    )
"""

from pydantic import BaseModel, Field


class ExternalDataSource(BaseModel):
    """
    外部数据源模型

    描述一个外部数据源（如 Excel、CSV 文件）的元信息。
    支持两种数据读取模式：
    - IndexedDB 模式：浏览器环境，从 IndexedDB 读取文件内容
    - 本地文件模式：Electron 环境，从本地文件系统读取

    Attributes:
        id: 数据源唯一标识符
        name: 数据源显示名称（别名）
        fileId: 文件标识（IndexedDB key 或本地文件路径）
        type: 文件类型（如 excel、csv）
        status: 数据源状态（ready/missing/loading）
        addedAt: 添加到系统的时间
        lastUsed: 最后一次使用的时间
        alias: 数据源别名（可选）
        error: 错误信息（如果有）
        sourceMode: 数据读取模式（indexeddb/localfile）
        localPath: 本地文件路径（Electron 模式专用）
    """

    id: str = Field(..., description="数据源唯一标识符")
    name: str = Field(..., description="数据源显示名称")
    fileId: str = Field(..., description="文件ID (IndexedDB key 或本地路径)")
    type: str = Field(..., description="文件类型 (excel/csv)")
    status: str = Field(default="ready", description="数据源状态 (ready/missing/loading)")
    addedAt: str = Field(default="", description="添加时间")
    lastUsed: str = Field(default="", description="最后使用时间")
    alias: str | None = Field(None, description="数据源别名")
    error: str | None = Field(None, description="错误信息")
    size: int | None = Field(None, description="文件大小(字节)")
    sourceMode: str | None = Field(None, description="数据来源模式 (indexeddb/localfile)")
    localPath: str | None = Field(None, description="本地文件路径（Electron 模式专用）")
    folderPath: str | None = Field(None, description="文件夹路径（用于分组显示）")


class UIPreferences(BaseModel):
    """
    UI 偏好设置模型

    存储用户界面的个性化配置选项。

    Attributes:
        expanded_folders: 文件树中各文件夹的展开/折叠状态
        startup_loading_enabled: Electron 启动时是否显示加载弹窗
    """

    expanded_folders: dict[str, bool] = Field(
        default={"input-staging": True, "schemas": True, "patterns": False, "constraints": False},
        description="文件夹展开状态",
    )
    startup_loading_enabled: bool = Field(default=True, description="是否在 Electron 启动时显示加载弹窗")


class WorkspaceConfig(BaseModel):
    """
    工作区配置模型

    完整的工作区设置，包含所有持久化的配置信息。
    通常存储在 workspace.json 或类似的配置文件中。

    Attributes:
        version: 配置版本号
        data_sources: 数据源列表
        alias_mappings: 文件路径到别名的映射
        ui_preferences: UI 偏好设置
        last_updated: 最后更新时间
    """

    version: str = Field(default="1.0", description="配置版本")
    data_sources: list[ExternalDataSource] = Field(default=[], description="数据源列表")
    alias_mappings: dict[str, str] = Field(default={}, description="路径到别名的映射")
    ui_preferences: UIPreferences = Field(default=UIPreferences(), description="UI偏好设置")
    last_updated: str = Field(default="", description="最后更新时间")
