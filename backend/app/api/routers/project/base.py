"""
@fileoverview Project API 基础模块

功能概述:
- 作为 project API 子模块的公共基础设施，集中管理共享导入
- 提供跨文件共享的辅助函数（如 YAML 加载、文件扫描）
- 暴露公共 Pydantic 模型定义与 V2 项目相关常量

架构设计:
- 将共享内容集中到 base.py 以避免循环导入和重复定义
- 辅助函数使用纯 Python 实现，不依赖 FastAPI 框架，便于单元测试
- 通过 __all__ 显式控制对外暴露的符号

输入示例:
    from app.api.routers.project.base import ProjectManifestV2, _load_yaml_file

输出示例:
    可直接使用导入的类型、函数与常量构建 project 相关 API
"""

from app.api.models.project import StandardResponse
from app.api.routers.project.helpers import (
    V2_MANIFEST_FILENAME,
    V2_VIEW_FILENAME,
    V2_WORKSPACES_FILENAME,
    _load_yaml_file,
    _v2_manifest_path,
    _v2_view_path,
    _v2_workspaces_path,
)
from app.api.routers.project.models import (
    DisplayNameUpdateRequest,
    FullConfigV2Request,
    ProjectViewV2Model,
    WorkspacesV2Model,
    WorkspaceV2Item,
)
from app.api.routers.project.scanner import (
    _scan_constraint_file,
    _scan_regex_node_file,
    _scan_schema_file,
)
from app.shared.core.project.constraint.types import ConstraintFileV2

# 从 shared 模块导入项目相关类型
from app.shared.core.project.manifest.types import (
    ConstraintRefV2,
    FileProcessingSettingsV2,
    ProjectManifestV2,
    ProjectSettingsV2,
    RegexNodeRefV2,
    SchemaRefV2,
    ScriptSecuritySettingsV2,
    TransformRefV2,
    ValidationSettingsV2,
)
from app.shared.core.project.regex.types import RegexNodeFileV2
from app.shared.core.project.schema.types import TableSchemaFileV2
from app.shared.core.project.transform.types import TransformFileV2

__all__ = [
    # helpers
    "V2_MANIFEST_FILENAME",
    "V2_VIEW_FILENAME",
    "V2_WORKSPACES_FILENAME",
    "_load_yaml_file",
    "_v2_manifest_path",
    "_v2_view_path",
    "_v2_workspaces_path",
    # scanner
    "_scan_constraint_file",
    "_scan_schema_file",
    "_scan_regex_node_file",
    # models
    "ProjectViewV2Model",
    "FullConfigV2Request",
    "DisplayNameUpdateRequest",
    "StandardResponse",
    "WorkspaceV2Item",
    "WorkspacesV2Model",
    # manifest types
    "ProjectManifestV2",
    "SchemaRefV2",
    "ConstraintRefV2",
    "RegexNodeRefV2",
    "TransformRefV2",
    "ProjectSettingsV2",
    "ValidationSettingsV2",
    "FileProcessingSettingsV2",
    "ScriptSecuritySettingsV2",
    # schema/constraint/regex types
    "TableSchemaFileV2",
    "ConstraintFileV2",
    "RegexNodeFileV2",
    "TransformFileV2",
]
