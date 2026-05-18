"""
@fileoverview 白名单管理 API 路由模块（团队版）

功能概述:
- 提供白名单配置的读取和更新接口
- 验证用户对指定路径的访问权限
- 支持路径权限的只读/读写策略控制

架构设计:
- 团队版功能，个人版返回基础配置或拒绝修改
- 白名单配置优先从新路径读取，兼容旧路径
- 使用 YAML 格式持久化配置

输入示例:
    PUT /whitelist
    {"version": "2.0", "default_policy": "readonly", "paths": [{"path": "/data", "policy": "readonly"}]}

输出示例:
    {"message": "白名单配置已更新"}
"""

import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.shared.core.edition import is_team_edition
from app.shared.core.io.yaml import write_yaml_atomic
from app.shared.services.preview.path import (
    check_path_permission,
    load_whitelist_config,
)

router = APIRouter(prefix="/whitelist", tags=["whitelist"])


class WhitelistEntry(BaseModel):
    """白名单条目"""

    path: str
    policy: str = "readonly"
    owner_id: Optional[str] = None
    description: Optional[str] = None


class WhitelistConfig(BaseModel):
    """白名单配置"""

    version: str = "2.0"
    default_policy: str = "readonly"
    paths: list[dict[str, Any]]


class PathValidationRequest(BaseModel):
    """路径验证请求"""

    file_path: str
    user_role: str = "member"
    user_id: Optional[str] = None


class PathValidationResponse(BaseModel):
    """路径验证响应"""

    allowed: bool
    reason: str


# 引入统一配置管理
from app.shared.core.config import ConfigPaths

# 旧配置名（向后兼容）
OLD_ALLOWED_PATHS_FILE = ".precis-allowed-paths"
# 新配置名
NEW_ALLOWED_PATHS_FILE = "allowed_paths.txt"


def _get_config_path() -> str:
    """获取白名单配置文件路径"""
    # 使用新的 ConfigPaths 获取路径
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    # 优先检查新路径
    new_config_path = ConfigPaths.allowed_paths(project_root)
    if new_config_path.exists():
        return str(new_config_path)

    # 向后兼容：检查旧路径
    search_paths = [project_root, os.getcwd(), os.path.expanduser("~")]

    for search_path in search_paths:
        old_config_path = os.path.join(search_path, OLD_ALLOWED_PATHS_FILE)
        if os.path.isfile(old_config_path):
            return old_config_path

    raise HTTPException(status_code=404, detail="白名单配置文件未找到")


@router.get("", response_model=WhitelistConfig)
def get_whitelist_config():
    """
    获取白名单配置

    团队版可用，个人版返回基础配置
    """
    if not is_team_edition():
        return WhitelistConfig(version="1.0", paths=[])

    config = load_whitelist_config()
    return WhitelistConfig(
        version=config.get("version", "1.0"),
        default_policy=config.get("default_policy", "readonly"),
        paths=config.get("paths", []),
    )


@router.put("", response_model=dict[str, str])
def update_whitelist_config(config: WhitelistConfig):
    """
    更新白名单配置

    仅管理员可修改
    """
    if not is_team_edition():
        raise HTTPException(status_code=403, detail="个人版不支持此功能")

    config_path = _get_config_path()

    try:
        write_yaml_atomic(Path(config_path), config.model_dump(exclude_none=True))

        return {"message": "白名单配置已更新"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败: {str(e)}")


@router.post("/validate", response_model=PathValidationResponse)
def validate_path(request: PathValidationRequest):
    """
    验证路径访问权限

    检查用户是否有权访问指定路径
    """
    if not is_team_edition():
        return PathValidationResponse(allowed=True, reason="个人版不检查权限")

    allowed, reason = check_path_permission(request.file_path, request.user_role, request.user_id)

    return PathValidationResponse(allowed=allowed, reason=reason)
