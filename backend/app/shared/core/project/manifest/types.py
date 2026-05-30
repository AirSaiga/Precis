"""
@fileoverview 项目清单类型统一导出模块

功能概述:
- 从 types_parts 各子模块聚合导出项目清单相关类型
- 提供 V2 版本别名（如 ProjectManifestV2）以保持版本兼容

架构设计:
- 聚合导出模式: 将分散在 types_parts 中的类型集中暴露
- 版本别名: 通过 ProjectManifestV2 = ProjectManifest 等映射降低上层迁移成本

输入示例:
    from app.shared.core.project.manifest.types import ProjectManifestV2, SchemaRefV2

输出示例:
    manifest = ProjectManifestV2(version=2, project=ProjectInfo(id="demo", name="Demo"))
"""

from __future__ import annotations

from app.shared.core.project.manifest.types_parts.constants import V2_VERSION
from app.shared.core.project.manifest.types_parts.data_source import DataSourceRef
from app.shared.core.project.manifest.types_parts.info import ProjectInfo
from app.shared.core.project.manifest.types_parts.manifest import ProjectManifest
from app.shared.core.project.manifest.types_parts.refs import ConstraintRef, RegexRef, SchemaRef, TransformRef
from app.shared.core.project.manifest.types_parts.settings import ProjectSettings
from app.shared.core.project.manifest.types_parts.settings_file_processing import FileProcessingSettings
from app.shared.core.project.manifest.types_parts.settings_script_security import ScriptSecuritySettings
from app.shared.core.project.manifest.types_parts.settings_validation import ValidationSettings

ProjectManifestV2 = ProjectManifest
ProjectInfoV2 = ProjectInfo
SchemaRefV2 = SchemaRef
ConstraintRefV2 = ConstraintRef
RegexNodeRefV2 = RegexRef
DataSourceRefV2 = DataSourceRef
ValidationSettingsV2 = ValidationSettings
FileProcessingSettingsV2 = FileProcessingSettings
ScriptSecuritySettingsV2 = ScriptSecuritySettings
ProjectSettingsV2 = ProjectSettings

__all__ = [
    "ConstraintRef",
    "ConstraintRefV2",
    "DataSourceRef",
    "DataSourceRefV2",
    "FileProcessingSettings",
    "FileProcessingSettingsV2",
    "ProjectInfo",
    "ProjectInfoV2",
    "ProjectManifest",
    "ProjectManifestV2",
    "ProjectSettings",
    "ProjectSettingsV2",
    "RegexNodeRefV2",
    "RegexRef",
    "SchemaRef",
    "SchemaRefV2",
    "TransformRef",
    "ScriptSecuritySettings",
    "ScriptSecuritySettingsV2",
    "V2_VERSION",
    "ValidationSettings",
    "ValidationSettingsV2",
]
