"""
@fileoverview 项目 API Pydantic 模型定义模块

功能概述:
- 定义 V2 项目视图模型（画布节点坐标和视口）
- 定义 V2 全量配置请求/响应模型
- 定义工作区条目和工作区列表模型
- 提供标准响应模型

架构设计:
- 视图模型与校验语义配置解耦，避免 UI 信息污染业务配置
- 全量配置模型用于前端导出、AI 生成、备份恢复场景
- 工作区模型支持多标签页画布的状态持久化

输入示例:
    class ProjectViewV2Model(BaseModel):
        version: int = 1
        nodes: dict[str, dict[str, float]]  # node_id -> {x, y}
        viewport: Optional[dict[str, float]]  # {x, y, zoom}

输出示例:
    class FullConfigV2Request(BaseModel):
        manifest: ProjectManifestV2
        schemas: dict[str, TableSchemaFileV2]
        constraints: dict[str, ConstraintFileV2]
        regex_nodes: dict[str, RegexNodeFileV2]
"""

from typing import Optional

from pydantic import BaseModel, Field

from app.shared.core.project.constraint.types import ConstraintFileV2
from app.shared.core.project.manifest.types import (
    ProjectManifestV2,
)
from app.shared.core.project.regex.types import RegexNodeFileV2
from app.shared.core.project.schema.types import TableSchemaFileV2
from app.shared.core.project.transform.types import TransformFileV2


class ProjectViewV2Model(BaseModel):
    """
    V2 项目视图文件模型（前端画布布局）。

    设计目标：
    - 将画布布局（节点坐标/视口）与后端校验语义配置解耦
    - 避免把 UI 相关信息写入 project.precis.yaml / schema / constraint / regex 文件

    数据流：
    - 前端保存画布视图时调用 PUT /project/view
    - 前端加载项目时调用 GET /project/view 获取节点位置

    字段说明：
    - version: 视图文件版本，用于后续格式迁移
    - nodes: 节点ID到坐标的映射，用于恢复画布布局
    - viewport: 当前视口信息，用于恢复用户查看位置
    """

    version: int = Field(default=1, description="视图文件版本")
    nodes: dict[str, dict[str, float]] = Field(default_factory=dict, description="节点坐标：node_id -> {x,y}")
    viewport: Optional[dict[str, float]] = Field(default=None, description="视口信息：{x,y,zoom}")


class FullConfigV2Request(BaseModel):
    """
    V2 全量配置写入请求模型。

    使用场景：
    - 前端导出整个项目配置时使用
    - AI 生成完整项目配置时使用
    - 项目备份/恢复场景

    数据完整性保证：
    - manifest: 必填，作为所有资源的索引
    - schemas/constraints/regex_nodes: 可选，用于批量更新资源文件
    """

    manifest: ProjectManifestV2 = Field(..., description="项目清单")
    schemas: dict[str, TableSchemaFileV2] = Field(default_factory=dict, description="schemas 映射：table_id -> schema")
    constraints: dict[str, ConstraintFileV2] = Field(
        default_factory=dict, description="constraints 映射：constraint_id -> constraint"
    )
    regex_nodes: dict[str, RegexNodeFileV2] = Field(
        default_factory=dict, description="regex_nodes 映射：regex_id -> regex_node"
    )
    transforms: dict[str, TransformFileV2] = Field(
        default_factory=dict, description="transforms 映射：transform_id -> transform"
    )


class DisplayNameUpdateRequest(BaseModel):
    """
    更新资源展示名的请求体模型。

    设计意图：
    - 允许用户修改资源的显示名称而不改变资源 ID 或文件路径
    - 用于提升用户体验，如给 "customer_table" 改为 "客户信息表"

    约束：
    - name 不能为空字符串（由 Pydantic 验证）
    """

    name: str = Field(..., description="新的展示名称")


class WorkspaceV2Item(BaseModel):
    """
    V2 工作区条目模型。

    设计目标：
    - 存储单个工作区的元数据、视图状态和完整画布快照
    - nodes/edges 保存完整画布数据，切换/关闭工作区时立即持久化
    - 重新打开项目时从 workspaces.json 恢复所有工作区的画布状态

    字段说明：
    - id: 工作区唯一标识
    - title: 工作区显示名称
    - index: 排序索引（删除后不重新编号，新建时取 max+1）
    - createdAt/lastActiveAt: 时间戳
    - visibleNodeIds: 在该工作区中可见的节点 ID 列表
    - viewport: 画布视口状态（位置+缩放）
    - nodes: 画布节点完整数据（JSON 数组）
    - edges: 画布边完整数据（JSON 数组）
    """

    id: str = Field(..., description="工作区唯一标识")
    title: str = Field(..., description="工作区显示名称")
    index: int = Field(default=0, description="排序索引")
    createdAt: str = Field(default="", description="创建时间 ISO 字符串")
    lastActiveAt: str = Field(default="", description="最后活跃时间 ISO 字符串")
    visibleNodeIds: list[str] = Field(default_factory=list, description="可见节点 ID 列表")
    viewport: Optional[dict[str, float]] = Field(default=None, description="视口信息：{x,y,zoom}")
    nodes: list[dict] = Field(default_factory=list, description="画布节点完整数据")
    edges: list[dict] = Field(default_factory=list, description="画布边完整数据")


class WorkspacesV2Model(BaseModel):
    """
    V2 工作区配置文件模型。

    使用场景：
    - 前端多标签页画布的工作区持久化
    - 每个工作区保存完整画布快照（nodes/edges），实现跨会话恢复

    数据流：
    - 前端切换/关闭工作区时调用 PUT /project/workspaces 保存
    - 前端加载项目时调用 GET /project/workspaces 恢复所有工作区画布状态
    """

    version: int = Field(default=1, description="工作区文件版本")
    activeWorkspaceId: Optional[str] = Field(default=None, description="当前活跃工作区 ID")
    workspaces: list[WorkspaceV2Item] = Field(default_factory=list, description="工作区列表")
