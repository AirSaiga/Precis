"""
@fileoverview 项目设置类型定义模块

功能概述:
- 整合项目各类设置的结构
- 包括验证设置、文件处理设置、脚本安全设置

架构设计:
- 组合模式: ProjectSettings 组合多个子设置
- 默认工厂: 每个子设置都有默认值

输入示例 (manifest.yaml):
    settings:
      validation:
        parallel_workers: 4
        strict_mode: true
      file_processing:
        default_encoding: utf-8
        csv_delimiter: ","
      script_security:
        allowed_imports:
          - math
          - datetime
        max_execution_time: 30

输出示例:
    ProjectSettings(
        validation=ValidationSettings(parallel_workers=4, strict_mode=True),
        file_processing=FileProcessingSettings(
            default_encoding="utf-8",
            csv_delimiter=","
        ),
        script_security=ScriptSecuritySettings(
            allowed_imports=["math", "datetime"],
            max_execution_time=30
        )
    )
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.shared.core.project.manifest.types_parts.settings_file_processing import FileProcessingSettings
from app.shared.core.project.manifest.types_parts.settings_script_security import ScriptSecuritySettings
from app.shared.core.project.manifest.types_parts.settings_validation import ValidationSettings


class ProjectSettings(BaseModel):
    """
    @classdesc 项目设置

    包含项目运行时的各类配置选项。

    字段说明:
        - validation: 验证行为设置 (并行数、严格模式等)
        - file_processing: 文件处理设置 (编码、日期格式、分隔符等)
        - script_security: 脚本安全设置 (允许的导入、最大执行时间等)

    默认值:
        所有子设置都有默认值，可以不填写使用默认配置

    示例:
        # 最小配置 (使用默认值)
        settings: {}

        # 自定义配置
        settings:
          validation:
            parallel_workers: 8
          file_processing:
            encoding: gbk
    """

    validation: ValidationSettings = Field(default_factory=lambda: ValidationSettings(), description="校验行为设置")
    file_processing: FileProcessingSettings = Field(
        default_factory=lambda: FileProcessingSettings(), description="文件处理设置"
    )
    script_security: ScriptSecuritySettings = Field(
        default_factory=lambda: ScriptSecuritySettings(), description="脚本安全设置"
    )
