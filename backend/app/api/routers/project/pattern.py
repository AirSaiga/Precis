"""
@fileoverview Pattern CRUD API - 正则表达式模式管理

功能概述:
- 提供 Pattern（可复用正则表达式单元）的创建与存在性检查
- Pattern 存储在项目的 patterns/ 目录下
- 支持命名冲突处理（覆盖、建议新名称、取消）

架构设计:
- 依赖 get_v2_manifest 获取 patterns_dir 配置
- 使用 PatternFile 模型序列化为 YAML 文件
- 创建请求使用 CreatePatternRequest，响应使用 CreatePatternResponse

输入示例:
    POST /pattern (body: CreatePatternRequest)
    GET /pattern/phone_cn/exists

输出示例:
    CreatePatternResponse: {message, pattern_path, pattern_name}
    dict: {pattern_name, exists}
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml
from app.shared.core.patterns.writer import (
    PatternFile,
    check_pattern_exists,
    delete_pattern_file,
    generate_unique_pattern_name,
    save_pattern_file,
)

from .manifest import get_v2_manifest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Pattern"])


class CreatePatternRequest(BaseModel):
    """创建 Pattern 的请求体。"""

    name: str = Field(..., description="Pattern 名称")
    regex: str = Field(..., description="正则表达式")
    description: str | None = Field(None, description="描述信息")
    output: dict | None = Field(None, description="输出配置")
    overwrite: bool = Field(False, description="是否覆盖已存在的 Pattern")


class CreatePatternResponse(BaseModel):
    """创建 Pattern 的响应体。"""

    message: str
    pattern_path: str
    pattern_name: str


@router.post(
    "/pattern",
    response_model=CreatePatternResponse,
    summary="创建新的 Pattern 文件",
    responses={
        409: {"description": "Pattern 已存在"},
        500: {"description": "服务器内部错误"},
    },
)
def create_v2_pattern(
    payload: CreatePatternRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    创建新的 Pattern 文件。

    业务逻辑：
    - 在项目的 patterns/ 目录下创建 Pattern YAML 文件
    - 支持命名冲突处理（覆盖/重命名/报错）

    参数:
        payload: 创建 Pattern 的请求数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        CreatePatternResponse: 创建结果
    """
    manifest = get_v2_manifest(config_path)
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")

    pattern_exists = check_pattern_exists(patterns_dir, payload.name)

    if pattern_exists and not payload.overwrite:
        suggested_name = generate_unique_pattern_name(patterns_dir, payload.name)
        raise HTTPException(
            status_code=409,
            detail={
                "error": "pattern_exists",
                "message": f"Pattern '{payload.name}' 已存在",
                "suggested_name": suggested_name,
                "options": ["overwrite", "use_suggested_name", "cancel"],
            },
        )

    if payload.overwrite and pattern_exists:
        logger.info(f"[Pattern API] 覆盖已存在的 Pattern: {payload.name}")

    pattern_file = PatternFile(
        name=payload.name,
        regex=payload.regex,
        description=payload.description,
        output=payload.output,
    )

    filepath = save_pattern_file(pattern_file, patterns_dir)
    logger.info(f"[Pattern API] Pattern 已创建: {filepath}")

    return CreatePatternResponse(
        message=f"Pattern '{payload.name}' 已创建",
        pattern_path=filepath,
        pattern_name=payload.name,
    )


@router.get(
    "/pattern/{pattern_name}/exists",
    response_model=dict,
    summary="检查 Pattern 名称是否已存在",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def check_pattern_name_exists(
    pattern_name: str,
    config_path: str = Depends(get_project_config_path),
):
    """
    检查指定名称的 Pattern 是否已存在。

    参数:
        pattern_name: Pattern 名称
        config_path: 项目配置根目录

    返回:
        包含是否存在信息的字典
    """
    manifest = get_v2_manifest(config_path)
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")

    exists = check_pattern_exists(patterns_dir, pattern_name)

    return {
        "pattern_name": pattern_name,
        "exists": exists,
    }


@router.get(
    "/pattern",
    response_model=list[dict],
    summary="列出所有 Pattern 规则",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def list_v2_patterns(
    config_path: str = Depends(get_project_config_path),
):
    """列出项目 patterns/ 目录下的所有 Pattern。"""
    manifest = get_v2_manifest(config_path)
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")
    result: list[dict] = []
    if not os.path.isdir(patterns_dir):
        return result
    for fname in sorted(os.listdir(patterns_dir)):
        if not (fname.endswith(".yaml") or fname.endswith(".yml")):
            continue
        fpath = os.path.join(patterns_dir, fname)
        try:
            data = read_yaml(Path(fpath))
            if isinstance(data, dict) and data.get("name"):
                result.append(data)
        except Exception as e:
            logger.warning(f"[Pattern API] 读取 pattern 文件失败: {fpath}, {e}")
    return result


@router.put(
    "/pattern/{pattern_name}",
    response_model=CreatePatternResponse,
    summary="更新已存在的 Pattern",
    responses={
        404: {"description": "Pattern 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def update_v2_pattern(
    pattern_name: str,
    payload: CreatePatternRequest,
    config_path: str = Depends(get_project_config_path),
):
    """更新已存在的 Pattern 文件（覆盖写）。"""
    manifest = get_v2_manifest(config_path)
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")

    if not check_pattern_exists(patterns_dir, pattern_name):
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_name}' 不存在")

    # 以路径中的名称为准（payload.name 应与 pattern_name 一致）
    pattern_file = PatternFile(
        name=pattern_name,
        regex=payload.regex,
        description=payload.description,
        output=payload.output,
    )
    filepath = save_pattern_file(pattern_file, patterns_dir)
    logger.info(f"[Pattern API] Pattern 已更新: {filepath}")

    return CreatePatternResponse(
        message=f"Pattern '{pattern_name}' 已更新",
        pattern_path=filepath,
        pattern_name=pattern_name,
    )


@router.delete(
    "/pattern/{pattern_name}",
    response_model=dict,
    summary="删除 Pattern",
    responses={
        404: {"description": "Pattern 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def delete_v2_pattern(
    pattern_name: str,
    config_path: str = Depends(get_project_config_path),
):
    """删除指定 Pattern 文件。"""
    manifest = get_v2_manifest(config_path)
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")

    deleted = delete_pattern_file(patterns_dir, pattern_name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_name}' 不存在")

    logger.info(f"[Pattern API] Pattern 已删除: {pattern_name}")
    return {"pattern_name": pattern_name, "deleted": True}
