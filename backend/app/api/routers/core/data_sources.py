"""
@fileoverview 工作区配置 API 路由模块

功能概述:
- 提供工作区配置的读写接口（数据源列表、UI 偏好设置）
- 管理数据源的增删改查操作
- 支持 Electron 和 CLI/Web 两种使用模式

架构设计:
- 配置优先从新路径 .precis/data_sources.yaml 读取，兼容旧路径
- 数据源使用 ExternalDataSource 模型 enriched 后返回
- 通过环境变量 PRECIS_PROJECT_ROOT 确定项目根目录

输入示例:
    POST /workspace/data-sources
    {"fileId": "data/users.xlsx", "name": "用户表", "type": "excel"}

输出示例:
    {
        "version": "1.0.0",
        "data_sources": [{"id": "...", "name": "用户表", "type": "excel", "status": "ready"}],
        "ui_preferences": {"expanded_folders": {}, "startup_loading_enabled": true}
    }
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_project_config_path
from app.api.models import ExternalDataSource, UIPreferences, WorkspaceConfig
from app.shared.core.config import ConfigPaths
from app.shared.core.io.yaml import write_yaml_atomic

router = APIRouter(prefix="/workspace", tags=["Data Sources"])


def get_workspace_config_path(project_root: str) -> Path:
    """获取工作区配置文件路径（优先新路径，兼容旧路径）"""
    # 优先使用新路径
    new_path = ConfigPaths.data_sources(project_root)
    if new_path.exists():
        return new_path

    # 向后兼容：检查旧路径
    old_path = Path(project_root) / ".precis-workspace.yaml"
    if old_path.exists():
        return old_path

    # 默认返回新路径（用于创建）
    return new_path


def load_workspace_config(project_root: str) -> dict[str, Any]:
    """加载工作区配置"""
    config_path = get_workspace_config_path(project_root)

    if not config_path.exists():
        # 返回默认配置
        return {
            "data_sources": [],
            "alias_mappings": {},
            "ui_preferences": {},
            "version": "1.0",
            "last_updated": datetime.now().isoformat(),
        }

    try:
        with open(config_path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"加载工作区配置失败: {str(e)}")


def save_workspace_config(project_root: str, config: dict[str, Any]) -> None:
    """保存工作区配置到文件"""
    config_path = get_workspace_config_path(project_root)

    try:
        write_yaml_atomic(config_path, config)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"保存工作区配置失败: {str(e)}")


def build_ui_preferences(config: dict[str, Any]) -> UIPreferences:
    """构建 UI 偏好设置对象"""
    raw = config.get("ui_preferences") or {}
    expanded_folders: dict[str, bool] = {}
    startup_loading_enabled = True

    if isinstance(raw, dict):
        startup_loading_enabled = raw.get("startup_loading_enabled", True)
        expanded = raw.get("expanded_folders")
        if isinstance(expanded, dict):
            expanded_folders = {k: bool(v) for k, v in expanded.items()}
        else:
            expanded_folders = {k: bool(v) for k, v in raw.items() if isinstance(v, bool)}

    return UIPreferences(expanded_folders=expanded_folders, startup_loading_enabled=bool(startup_loading_enabled))


def _get_project_root(config_path: str) -> str:
    """从 config_path 推导项目根目录（config_path 通常指向 .precis/ 目录）"""
    parent = str(Path(config_path).parent)
    return parent if parent != config_path else config_path


@router.get("/config", response_model=WorkspaceConfig)
async def get_workspace_config(config_path: str = Depends(get_project_config_path)):
    """
    获取工作区配置

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)
    config = load_workspace_config(project_root)

    enriched_data_sources = []
    for ds in config.get("data_sources", []):
        enriched_ds = ExternalDataSource(
            id=ds.get("id", ds.get("fileId", ds.get("fullPath", ""))),
            name=ds.get("name", ""),
            fileId=ds.get("fileId", ds.get("fullPath", "")),
            type=ds.get("type", "excel"),
            status=ds.get("status", "ready"),
            addedAt=ds.get("addedAt", "2024-01-01T00:00:00Z"),
            lastUsed=ds.get("lastUsed", "2024-01-01T00:00:00Z"),
            alias=ds.get("alias", ""),
            error=ds.get("error", ""),
            size=ds.get("size"),
            sourceMode=ds.get("sourceMode"),
            localPath=ds.get("localPath"),
            folderPath=ds.get("folderPath"),
        )
        enriched_data_sources.append(enriched_ds)

    return WorkspaceConfig(
        version=config.get("version", "1.0.0"),
        data_sources=enriched_data_sources,
        alias_mappings=config.get("alias_mappings", {}),
        ui_preferences=build_ui_preferences(config),
        last_updated=config.get("last_updated", "2024-01-01T00:00:00Z"),
    )


@router.put("/config", response_model=WorkspaceConfig)
async def update_workspace_config(config_data: dict[str, Any], config_path: str = Depends(get_project_config_path)):
    """
    更新工作区配置

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)

    # 更新最后修改时间
    config_data["last_updated"] = datetime.now().isoformat()

    # 保存到文件
    save_workspace_config(project_root, config_data)

    # 返回更新后的配置
    return await get_workspace_config(config_path)


@router.post("/data-sources", response_model=WorkspaceConfig)
async def add_data_source(data_source: dict[str, Any], config_path: str = Depends(get_project_config_path)):
    """
    添加数据源

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)
    config = load_workspace_config(project_root)

    file_id = data_source.get("fileId", data_source.get("fullPath"))
    file_id = os.path.normpath(file_id) if file_id else file_id

    # 检查是否已存在
    for ds in config.get("data_sources", []):
        if ds.get("fileId") == file_id or ds.get("fullPath") == data_source.get("fullPath"):
            # 更新现有数据源
            ds["name"] = data_source.get("name", ds.get("name", ""))
            ds["type"] = data_source.get("type", ds.get("type", "excel"))
            ds["status"] = data_source.get("status", "ready")
            ds["lastUsed"] = data_source.get("lastUsed", datetime.now().isoformat())
            if "sourceMode" in data_source:
                ds["sourceMode"] = data_source.get("sourceMode")
            if "localPath" in data_source:
                ds["localPath"] = data_source.get("localPath")
            if "folderPath" in data_source:
                ds["folderPath"] = data_source.get("folderPath")
            if "size" in data_source:
                ds["size"] = data_source.get("size")
            if "id" not in ds:
                ds["id"] = data_source.get("id", file_id)

            save_workspace_config(project_root, config)
            return await get_workspace_config(config_path)

    # 添加新数据源
    new_source = {
        "id": data_source.get("id", file_id),
        "name": data_source.get("name", ""),
        "fileId": file_id,
        "type": data_source.get("type", "excel"),
        "status": data_source.get("status", "ready"),
        "addedAt": data_source.get("addedAt", datetime.now().isoformat()),
        "lastUsed": data_source.get("lastUsed", datetime.now().isoformat()),
        "alias": data_source.get("alias", ""),
        "error": data_source.get("error", ""),
        "sourceMode": data_source.get("sourceMode"),
        "localPath": data_source.get("localPath"),
        "folderPath": data_source.get("folderPath"),
        "size": data_source.get("size"),
    }

    config.setdefault("data_sources", []).insert(0, new_source)
    save_workspace_config(project_root, config)

    return await get_workspace_config(config_path)


@router.delete("/data-sources/{source_id}", response_model=WorkspaceConfig)
async def remove_data_source(source_id: str, config_path: str = Depends(get_project_config_path)):
    """
    移除数据源

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)
    config = load_workspace_config(project_root)

    data_sources = config.get("data_sources", [])
    config["data_sources"] = [ds for ds in data_sources if ds.get("id") != source_id]

    save_workspace_config(project_root, config)
    return await get_workspace_config(config_path)


@router.put("/data-sources/{source_id}", response_model=WorkspaceConfig)
async def update_data_source(
    source_id: str, data_source: dict[str, Any], config_path: str = Depends(get_project_config_path)
):
    """
    更新数据源

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)
    config = load_workspace_config(project_root)

    for ds in config.get("data_sources", []):
        if ds.get("id") == source_id:
            ds.update(data_source)
            ds["lastUsed"] = datetime.now().isoformat()
            break

    save_workspace_config(project_root, config)
    return await get_workspace_config(config_path)


@router.delete("/data-sources", response_model=WorkspaceConfig)
async def clear_all_data_sources(config_path: str = Depends(get_project_config_path)):
    """
    清空所有数据源

    适用于所有模式（Electron/CLI/Web）
    """
    project_root = _get_project_root(config_path)
    config = load_workspace_config(project_root)

    config["data_sources"] = []
    config["last_updated"] = datetime.now().isoformat()

    save_workspace_config(project_root, config)
    return await get_workspace_config(config_path)
