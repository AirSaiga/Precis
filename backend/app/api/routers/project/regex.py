"""
@fileoverview Regex CRUD API - 正则表达式节点管理

功能概述:
- 提供 Regex Node（正则表达式校验/提取节点）的增删改查
- 支持两层查找：优先 manifest 引用，兼容扫描 patterns/、regex/、regex_nodes/ 目录
- 包含展示名更新能力

架构设计:
- 读取时优先从 manifest.regex_nodes 定位文件，失败后扫描多个目录
- 写入时自动补齐 manifest 引用，默认路径为 regex/{regex_id}.regex.yaml
- 删除时同步清理 manifest 引用与物理文件

输入示例:
    GET /regex/phone_number
    PUT /regex/phone_number (body: RegexNodeFileV2)

输出示例:
    RegexNodeFileV2 模型实例或 StandardResponse 操作结果
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic
from app.shared.core.project.manifest.types import ProjectManifestV2

from .base import (
    DisplayNameUpdateRequest,
    RegexNodeFileV2,
    RegexNodeRefV2,
    StandardResponse,
    _scan_regex_node_file,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock
from .manifest import get_v2_manifest

router = APIRouter(prefix="", tags=["Project-Regex"])


@router.get(
    "/regex/{regex_id}",
    response_model=RegexNodeFileV2,
    summary="读取 Regex 节点",
    responses={
        404: {"description": "Regex 节点不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def get_v2_regex_node(regex_id: str, config_path: str = Depends(get_project_config_path)):
    """
    读取指定 regex_id 的 regex 节点文件。

    查找策略（两层查找，更健壮）：
    1. 从 manifest.regex_nodes 中查找引用（优先）
    2. 如果未找到，扫描 patterns_dir 目录

    参数:
        regex_id: Regex 节点的唯一标识符
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        RegexNodeFileV2: Regex 节点文件内容
    """
    manifest = get_v2_manifest(config_path)

    abs_path = None

    # 1. 优先从 manifest 中查找所有匹配的引用（可能存在重复 ID 的情况）
    refs = [r for r in manifest.regex_nodes if r.id == regex_id]
    for ref in refs:
        path = os.path.join(config_path, ref.path)
        if os.path.isfile(path):
            abs_path = path
            break

    # 2. 如果 manifest 中未找到有效文件，尝试扫描目录
    if not abs_path:
        scan_dirs = []

        p_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")
        scan_dirs.append((p_dir, "patterns"))

        scan_dirs.append((os.path.join(config_path, "regex"), "patterns"))
        scan_dirs.append((os.path.join(config_path, "regex_nodes"), "patterns"))

        found = False
        for d, reg_name in scan_dirs:
            if not os.path.isdir(d):
                continue
            for filename in os.listdir(d):
                if filename.lower().endswith(".yaml") or filename.lower().endswith(".regex.yaml"):
                    rid = filename
                    if filename.lower().endswith(".regex.yaml"):
                        rid = filename[:-11]
                    elif filename.lower().endswith(".yaml"):
                        rid = filename[:-5]

                    match_id = rid if rid == regex_id else f"{reg_name}/{rid}"

                    if match_id == regex_id:
                        path = os.path.join(d, filename)
                        if os.path.isfile(path):
                            abs_path = path
                            found = True
                            break
            if found:
                break

    if not abs_path:
        raise HTTPException(status_code=404, detail=f"regex_node '{regex_id}' 未找到")

    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail=f"regex_node 文件未找到: {abs_path}")

    data = read_yaml(Path(abs_path))

    version = data.get("version", 1)
    if version != 2:
        raise HTTPException(status_code=400, detail=f"不支持的 regex 文件版本: {version}，仅支持 V2 格式")

    return RegexNodeFileV2.model_validate(data)


@router.put(
    "/regex/{regex_id}",
    response_model=StandardResponse,
    summary="写入 Regex 节点",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def put_v2_regex_node(
    regex_id: str,
    regex_node: RegexNodeFileV2,
    config_path: str = Depends(get_project_config_path),
):
    """
    写入指定 regex_id 的 regex 节点文件。

    业务逻辑：
    - 验证 regex_node.id 与路径参数 regex_id 一致
    - 如果 manifest 未引用，自动补齐引用
    - 同时更新 manifest 文件

    副作用：
    - 创建或覆盖 regex 文件
    - 更新 manifest 中的引用列表

    数据流：
    1. 验证 regex_node.id 与 regex_id 一致
    2. 读取 manifest 文件
    3. 检查 manifest 是否已有该 regex 的引用
    4. 如果没有，添加新的引用（默认路径：regex/{regex_id}.regex.yaml）
    5. 写入 regex 文件
    6. 更新 manifest 文件

    参数:
        regex_id: Regex 节点的唯一标识符
        regex_node: Regex 节点数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    if regex_node.id != regex_id:
        raise HTTPException(status_code=400, detail="regex_node.id 必须与路径参数 regex_id 一致")
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))

    ref = next((r for r in manifest.regex_nodes if r.id == regex_id), None)
    if not ref:
        default_rel = f"regex/{regex_id}.regex.yaml"
        manifest.regex_nodes.append(RegexNodeRefV2(id=regex_id, path=default_rel))
        ref_path = default_rel
    else:
        ref_path = ref.path

    try:
        abs_path = _resolve_project_path(config_path, ref_path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Regex 文件路径")
    write_yaml_atomic(Path(abs_path), regex_node.model_dump(exclude_none=True))
    with project_lock(config_path):
        write_yaml_atomic(Path(manifest_path), manifest.model_dump(exclude_none=True))
    return {"message": f"V2 regex_node '{regex_id}' 已保存。"}


@router.delete(
    "/regex/{regex_id}",
    response_model=StandardResponse,
    summary="删除 Regex 节点",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Regex 节点或 Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def delete_v2_regex_node(regex_id: str, config_path: str = Depends(get_project_config_path)):
    """
    删除指定 regex_id 的 regex 文件，并从 manifest 中移除引用。

    删除策略（两层查找，更健壮）：
    1. 首先从 manifest.regex_nodes 中查找引用（优先）
    2. 如果未找到，扫描 patterns/ 目录（兼容旧项目）

    副作用：
    - 删除对应的 .yaml 文件
    - 从 manifest.regex_nodes 中移除引用（如果存在）

    数据流：
    1. 读取 manifest 文件
    2. 在 manifest.regex_nodes 中查找引用
    3. 如果未找到，扫描 patterns/ 目录
    4. 删除找到的 regex 文件
    5. 从 manifest 中移除引用
    6. 保存更新后的 manifest

    参数:
        regex_id: Regex 节点的唯一标识符
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))

    ref = next((r for r in manifest.regex_nodes if r.id == regex_id), None)
    if not ref:
        ref = _scan_regex_node_file(
            regex_id,
            config_path,
            manifest.patterns_dir or "patterns",
            "regex",
        )

    if not ref:
        return {"message": f"未找到 regex_node '{regex_id}'，无需删除。"}

    try:
        abs_path = _resolve_project_path(config_path, ref.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Regex 文件路径")

    with project_lock(config_path):
        try:
            if os.path.isfile(abs_path):
                os.remove(abs_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除 regex_node 文件失败: {e}")

        if manifest.regex_nodes:
            manifest.regex_nodes = [r for r in manifest.regex_nodes if r.id != regex_id]
            write_yaml_atomic(Path(manifest_path), manifest.model_dump(exclude_none=True))

    return {"message": f"V2 regex_node '{regex_id}' 已删除。"}


@router.post(
    "/regex/{regex_id}/display-name",
    response_model=StandardResponse,
    summary="更新 Regex 节点展示名",
    responses={
        404: {"description": "Regex 节点不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def update_v2_regex_node_display_name(
    regex_id: str,
    payload: DisplayNameUpdateRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    更新 regex 节点展示名（不改变 regex_id 与文件路径）。

    设计意图：
    - 允许用户给 Regex 节点设置友好的显示名称
    - 不改变底层 ID 和文件路径，保持引用完整性

    副作用：
    - 会触发两次文件写入（读取-修改-保存）

    数据流：
    1. 调用 get_v2_regex_node 获取当前 regex_node
    2. 修改 regex_node.name 为新名称
    3. 调用 put_v2_regex_node 保存更改

    参数:
        regex_id: Regex 节点的唯一标识符
        payload: 新的展示名称
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    regex_node = get_v2_regex_node(regex_id, config_path)
    regex_node.name = payload.name
    put_v2_regex_node(regex_id, regex_node, config_path)
    return {"message": f"V2 regex_node '{regex_id}' 展示名已更新。"}
