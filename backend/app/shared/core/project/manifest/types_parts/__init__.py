"""
@fileoverview 项目清单子类型聚合导出模块

功能概述:
- 集中导出项目清单各组成部分的类型定义
- 简化上层模块对 types_parts 的导入路径

架构设计:
- 扁平化导出: 将多层类型统一暴露为一级符号
- 向后兼容: __all__ 明确控制公开接口

输入示例:
    from app.shared.core.project.manifest.types_parts import ProjectManifest, SchemaRef, ProjectSettings

输出示例:
    manifest = ProjectManifest(version=2, project=ProjectInfo(id="demo", name="Demo"))
"""

from app.shared.core.project.manifest.types_parts.constants import V2_VERSION
from app.shared.core.project.manifest.types_parts.data_source import DataSourceRef
from app.shared.core.project.manifest.types_parts.info import ProjectInfo
from app.shared.core.project.manifest.types_parts.manifest import ProjectManifest
from app.shared.core.project.manifest.types_parts.refs import ConstraintRef, RegexRef, SchemaRef
from app.shared.core.project.manifest.types_parts.settings import ProjectSettings
from app.shared.core.project.manifest.types_parts.settings_file_processing import FileProcessingSettings
from app.shared.core.project.manifest.types_parts.settings_script_security import ScriptSecuritySettings
from app.shared.core.project.manifest.types_parts.settings_validation import ValidationSettings

__all__ = [
    "ConstraintRef",
    "DataSourceRef",
    "FileProcessingSettings",
    "ProjectInfo",
    "ProjectManifest",
    "ProjectSettings",
    "RegexRef",
    "SchemaRef",
    "ScriptSecuritySettings",
    "ValidationSettings",
    "V2_VERSION",
]
