"""
@fileoverview Constraint CRUD API - 数据约束管理

功能概述:
- 提供 Constraint（数据约束规则）的增删改查接口
- 支持两层查找：优先从 manifest 读取引用，兼容扫描目录
- 包含展示名更新能力

架构设计:
- 依赖 get_v2_manifest 定位资源路径
- 文件命名约定：{constraint_id}.constraint.yaml
- 写入时自动补齐 manifest 引用，保证索引一致性

输入示例:
    GET /v2/constraints/unique_email
    PUT /v2/constraints/unique_email (body: ConstraintFileV2)

输出示例:
    ConstraintFileV2 模型实例或 StandardResponse 操作结果
"""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic
from app.shared.core.project.manifest.types import ProjectManifestV2

from .base import (
    ConstraintFileV2,
    ConstraintRefV2,
    DisplayNameUpdateRequest,
    StandardResponse,
    _scan_constraint_file,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock
from .manifest import get_v2_manifest

router = APIRouter(prefix="", tags=["Project-Constraint"])


@router.get("/v2/constraints/{constraint_id}", response_model=ConstraintFileV2)
def get_v2_constraint(constraint_id: str, config_path: str = Depends(get_project_config_path)):
    """
    读取指定 constraint_id 的 constraint 文件。

    查找策略（两层查找，更健壮）：
    1. 从 manifest.constraints 中查找引用（优先）
    2. 如果未找到，扫描 constraints/ 目录（兼容旧项目）

    副作用：
    - 如果文件不存在，返回 404 错误

    数据流：
    1. 调用 get_v2_manifest 获取项目清单
    2. 在 manifest.constraints 中查找对应引用
    3. 如果找到，使用引用中的 path 构建文件路径
    4. 如果未找到，扫描 constraints/ 目录
    5. 读取并解析 YAML 文件
    6. 返回 Pydantic 模型

    参数:
        constraint_id: Constraint 的唯一标识符
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ConstraintFileV2: Constraint 文件内容
    """
    manifest = get_v2_manifest(config_path)

    # 查找策略优化：
    # 1. 优先从 manifest 中查找所有匹配的引用（可能存在重复 ID 的情况）
    # 2. 遍历所有引用，直到找到一个实际存在的文件
    # 3. 如果 manifest 中没有有效引用，再扫描目录

    constraint_path = None

    # 1. 尝试从 manifest 中查找有效文件
    refs = [c for c in manifest.constraints if c.id == constraint_id]
    for ref in refs:
        path = os.path.join(config_path, ref.path)
        if os.path.isfile(path):
            constraint_path = path
            break

    # 2. 如果 manifest 中未找到有效文件，尝试扫描目录
    if not constraint_path:
        constraints_dir = os.path.join(config_path, "constraints")
        if os.path.isdir(constraints_dir):
            for filename in os.listdir(constraints_dir):
                if filename.lower().endswith(".constraint.yaml"):
                    cid = filename[:-16]
                    if cid == constraint_id:
                        path = os.path.join(constraints_dir, filename)
                        if os.path.isfile(path):
                            constraint_path = path
                            break

    if not constraint_path:
        # 如果 manifest 中有引用但文件都找不到，抛出更具体的错误
        if refs:
            raise HTTPException(
                status_code=404, detail=f"manifest 中引用了 constraint '{constraint_id}'，但对应的文件均不存在"
            )
        raise HTTPException(status_code=404, detail=f"manifest 中未找到 constraint且扫描目录也未发现: {constraint_id}")

    if not os.path.isfile(constraint_path):
        raise HTTPException(status_code=404, detail=f"constraint 文件未找到: {constraint_path}")

    data = read_yaml(Path(constraint_path))
    return ConstraintFileV2.model_validate(data)


@router.put("/v2/constraints/{constraint_id}", response_model=StandardResponse)
def put_v2_constraint(
    constraint_id: str,
    constraint: ConstraintFileV2,
    config_path: str = Depends(get_project_config_path),
):
    """
    写入指定 constraint_id 的 constraint 文件。

    业务逻辑：
    - 验证 constraint.id 与路径参数 constraint_id 一致
    - 如果 manifest 未引用，自动补齐引用
    - 同时更新 manifest 文件

    副作用：
    - 创建或覆盖 constraint 文件
    - 更新 manifest 中的引用列表

    数据流：
    1. 验证 constraint.id 与 constraint_id 一致
    2. 读取 manifest 文件
    3. 检查 manifest 是否已有该 constraint 的引用
    4. 如果没有，添加新的引用（默认路径：constraints/{constraint_id}.constraint.yaml）
    5. 写入 constraint 文件
    6. 更新 manifest 文件

    参数:
        constraint_id: Constraint 的唯一标识符
        constraint: Constraint 数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    if constraint.id != constraint_id:
        raise HTTPException(status_code=400, detail="constraint.id 必须与路径参数 constraint_id 一致")
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))

    ref = next((c for c in manifest.constraints if c.id == constraint_id), None)
    if not ref:
        default_rel = f"constraints/{constraint_id}.constraint.yaml"
        manifest.constraints.append(ConstraintRefV2(id=constraint_id, path=default_rel))
        ref_path = default_rel
    else:
        ref_path = ref.path

    try:
        abs_constraint_path = _resolve_project_path(config_path, ref_path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Constraint 文件路径")
    write_yaml_atomic(Path(abs_constraint_path), constraint.model_dump(exclude_none=True))
    with project_lock(config_path):
        write_yaml_atomic(Path(manifest_path), manifest.model_dump(exclude_none=True))
    return {"message": f"V2 constraint '{constraint_id}' 已保存。"}


@router.delete("/v2/constraints/{constraint_id}", response_model=StandardResponse)
def delete_v2_constraint(constraint_id: str, config_path: str = Depends(get_project_config_path)):
    """
    删除指定 constraint_id 的 constraint 文件，并从 manifest 中移除引用。

    删除策略（两层查找，更健壮）：
    1. 首先从 manifest.constraints 中查找引用（优先）
    2. 如果未找到，扫描 constraints/ 目录（兼容旧项目）

    副作用：
    - 删除对应的 .constraint.yaml 文件
    - 从 manifest.constraints 中移除引用（如果存在）

    数据流：
    1. 读取 manifest 文件
    2. 在 manifest.constraints 中查找引用
    3. 如果未找到，扫描 constraints/ 目录
    4. 删除找到的 constraint 文件
    5. 从 manifest 中移除引用
    6. 保存更新后的 manifest

    参数:
        constraint_id: Constraint 的唯一标识符
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))

    ref = next((c for c in manifest.constraints if c.id == constraint_id), None)
    if not ref:
        ref = _scan_constraint_file(constraint_id, config_path)

    if not ref:
        return {"message": f"未找到 constraint '{constraint_id}'，无需删除。"}

    try:
        abs_constraint_path = _resolve_project_path(config_path, ref.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Constraint 文件路径")

    with project_lock(config_path):
        try:
            if os.path.isfile(abs_constraint_path):
                os.remove(abs_constraint_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除 constraint 文件失败: {e}")

        if manifest.constraints:
            manifest.constraints = [c for c in manifest.constraints if c.id != constraint_id]
            write_yaml_atomic(Path(manifest_path), manifest.model_dump(exclude_none=True))

    return {"message": f"V2 constraint '{constraint_id}' 已删除。"}


@router.post("/v2/constraints/{constraint_id}/display-name", response_model=StandardResponse)
def update_v2_constraint_display_name(
    constraint_id: str,
    payload: DisplayNameUpdateRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    更新 constraint 的展示名（不改变 constraint_id 与文件路径）。

    设计意图：
    - 允许用户给 Constraint 设置友好的显示名称
    - 不改变底层 ID 和文件路径，保持引用完整性

    副作用：
    - 会触发两次文件写入（读取-修改-保存）

    数据流：
    1. 调用 get_v2_constraint 获取当前 constraint
    2. 修改 constraint.description 为新名称
    3. 调用 put_v2_constraint 保存更改

    参数:
        constraint_id: Constraint 的唯一标识符
        payload: 新的展示名称
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    constraint = get_v2_constraint(constraint_id, config_path)
    constraint.description = payload.name
    put_v2_constraint(constraint_id, constraint, config_path)
    return {"message": f"V2 constraint '{constraint_id}' 展示名已更新。"}
