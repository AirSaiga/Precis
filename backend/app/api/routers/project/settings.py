"""
@fileoverview 设置 API - 项目设置、校验设置、文件处理、脚本安全

功能概述:
- 提供项目各类设置的独立读写接口（ProjectSettings / Validation / FileProcessing / ScriptSecurity）
- 所有设置存储在 manifest 的 settings 字段中，保证原子性
- 支持按需加载与保存，减少前端数据传输

架构设计:
- 每个设置类别有独立的 GET/PUT 端点，避免全量覆盖
- 读取时解析 manifest，写入时仅更新对应子字段
- 使用 exclude_none=True 清理空值，保持 YAML 整洁

输入示例:
    GET /v2/config/settings
    PUT /v2/config/validation (body: ValidationSettingsV2)

输出示例:
    ProjectSettingsV2 / ValidationSettingsV2 / FileProcessingSettingsV2 / ScriptSecuritySettingsV2
    StandardResponse: 操作结果消息
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml
from app.shared.core.project.manifest.types import ProjectManifestV2

from .base import (
    FileProcessingSettingsV2,
    ProjectSettingsV2,
    ScriptSecuritySettingsV2,
    StandardResponse,
    ValidationSettingsV2,
    _v2_manifest_path,
)
from .helpers import project_lock

router = APIRouter(prefix="", tags=["Project-Settings"])


@router.get("/v2/config/settings", response_model=ProjectSettingsV2)
def get_v2_project_settings(config_path: str = Depends(get_project_config_path)):
    """
    读取当前项目的设置（从 project.precis.yaml 的 settings 字段）。

    使用场景：
    - 前端加载项目设置界面
    - 需要获取项目的通用配置

    副作用：
    - 如果 manifest 文件不存在，返回 404 错误

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ProjectSettingsV2: 项目设置对象
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    try:
        raw = read_yaml(Path(manifest_path))
        manifest = ProjectManifestV2.model_validate(raw)
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to read project settings")
        raise HTTPException(status_code=500, detail=f"设置文件读取失败: {exc}")
    return manifest.settings


@router.put("/v2/config/settings", response_model=StandardResponse)
def put_v2_project_settings(settings: ProjectSettingsV2, config_path: str = Depends(get_project_config_path)):
    """
    写入当前项目的设置（更新 project.precis.yaml 的 settings 字段）。

    使用场景：
    - 用户修改项目设置后保存

    副作用：
    - 直接覆盖 manifest 中的 settings 字段
    - 使用 exclude_none=True 清理空值

    参数:
        settings: 新的项目设置
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    try:
        raw = read_yaml(Path(manifest_path))
        manifest = ProjectManifestV2.model_validate(raw)
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to read project settings for update")
        raise HTTPException(status_code=500, detail=f"设置文件读取失败: {exc}")
    manifest.settings = settings
    try:
        with project_lock(config_path):
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to write project settings")
        raise HTTPException(status_code=500, detail=f"设置文件保存失败: {exc}")
    return {"message": "项目设置已保存。"}


@router.get("/v2/config/validation", response_model=ValidationSettingsV2)
def get_v2_validation_settings(config_path: str = Depends(get_project_config_path)):
    """
    读取当前项目的校验行为设置。

    使用场景：
    - 前端加载校验设置界面
    - 全量校验时获取校验配置

    副作用：
    - 调用 get_v2_project_settings 获取完整设置

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ValidationSettingsV2: 校验设置对象
    """
    settings = get_v2_project_settings(config_path)
    return settings.validation


@router.put("/v2/config/validation", response_model=StandardResponse)
def put_v2_validation_settings(validation: ValidationSettingsV2, config_path: str = Depends(get_project_config_path)):
    """
    写入当前项目的校验行为设置。

    使用场景：
    - 用户修改校验设置后保存

    副作用：
    - 只更新 settings.validation 字段
    - 保留其他 settings 字段不变

    参数:
        validation: 新的校验设置
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    try:
        raw = read_yaml(Path(manifest_path))
        manifest = ProjectManifestV2.model_validate(raw)
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to read validation settings")
        raise HTTPException(status_code=500, detail=f"设置文件读取失败: {exc}")
    manifest.settings.validation = validation
    try:
        with project_lock(config_path):
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to write validation settings")
        raise HTTPException(status_code=500, detail=f"设置文件保存失败: {exc}")
    return {"message": "校验设置已保存。"}


@router.get("/v2/config/file-processing", response_model=FileProcessingSettingsV2)
def get_v2_file_processing_settings(config_path: str = Depends(get_project_config_path)):
    """
    读取当前项目的文件处理设置。

    使用场景：
    - 前端加载文件处理设置界面
    - 数据加载时获取文件编码、分隔符等配置

    副作用：
    - 调用 get_v2_project_settings 获取完整设置

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        FileProcessingSettingsV2: 文件处理设置对象
    """
    settings = get_v2_project_settings(config_path)
    return settings.file_processing


@router.put("/v2/config/file-processing", response_model=StandardResponse)
def put_v2_file_processing_settings(
    file_processing: FileProcessingSettingsV2, config_path: str = Depends(get_project_config_path)
):
    """
    写入当前项目的文件处理设置。

    使用场景：
    - 用户修改文件处理设置后保存（如 CSV 分隔符、编码等）

    副作用：
    - 只更新 settings.file_processing 字段
    - 保留其他 settings 字段不变

    参数:
        file_processing: 新的文件处理设置
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    try:
        raw = read_yaml(Path(manifest_path))
        manifest = ProjectManifestV2.model_validate(raw)
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to read file-processing settings")
        raise HTTPException(status_code=500, detail=f"设置文件读取失败: {exc}")
    manifest.settings.file_processing = file_processing
    try:
        with project_lock(config_path):
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to write file-processing settings")
        raise HTTPException(status_code=500, detail=f"设置文件保存失败: {exc}")
    return {"message": "文件处理设置已保存。"}


@router.get("/v2/config/script-security", response_model=ScriptSecuritySettingsV2)
def get_v2_script_security_settings(config_path: str = Depends(get_project_config_path)):
    """
    读取当前项目的脚本安全设置。

    使用场景：
    - 前端加载脚本安全设置界面
    - 约束校验时判断是否允许 eval/exec

    副作用：
    - 调用 get_v2_project_settings 获取完整设置

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ScriptSecuritySettingsV2: 脚本安全设置对象
    """
    settings = get_v2_project_settings(config_path)
    return settings.script_security


@router.put("/v2/config/script-security", response_model=StandardResponse)
def put_v2_script_security_settings(
    script_security: ScriptSecuritySettingsV2, config_path: str = Depends(get_project_config_path)
):
    """
    写入当前项目的脚本安全设置。

    使用场景：
    - 用户修改脚本安全设置后保存（如是否允许 eval/exec）

    副作用：
    - 只更新 settings.script_security 字段
    - 保留其他 settings 字段不变

    参数:
        script_security: 新的脚本安全设置
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    try:
        raw = read_yaml(Path(manifest_path))
        manifest = ProjectManifestV2.model_validate(raw)
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to read script-security settings")
        raise HTTPException(status_code=500, detail=f"设置文件读取失败: {exc}")
    manifest.settings.script_security = script_security
    try:
        with project_lock(config_path):
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))
    except Exception as exc:
        logging.getLogger(__name__).exception("Failed to write script-security settings")
        raise HTTPException(status_code=500, detail=f"设置文件保存失败: {exc}")
    return {"message": "脚本安全设置已保存。"}
