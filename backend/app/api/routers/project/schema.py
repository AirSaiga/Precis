# backend/app/api/routers/project/schema.py
"""
@fileoverview Schema CRUD API - 数据表结构管理

功能概述:
- 负责 Schema（数据表结构定义）的增删改查操作
- Schema 定义了数据源的列结构、类型约束等信息
- 支持冲突检测和合并写入策略

架构设计:
- 两层查找策略: 优先从 manifest 读取引用，兼容扫描目录
- 文件命名约定: {table_id}.schema.yaml
- 合并写入模式: CREATE / OVERWRITE / MERGE 三种 SaveMode
- 冲突检测: 检查同名表在 manifest 和文件系统的一致性

输入示例:
    PUT /v2/schemas/users
    {
      "id": "users",
      "columns": [
        {"id": "name", "type": "string"}
      ]
    }

输出示例:
    {
      "success": true,
      "data": {"table_id": "users", "display_name": "users"}
    }
"""

import os
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml, write_yaml_atomic
from app.shared.core.project.manifest.types import ProjectManifestV2

from .base import (
    DisplayNameUpdateRequest,
    SchemaRefV2,
    StandardResponse,
    TableSchemaFileV2,
    _scan_schema_file,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock
from .manifest import get_v2_manifest
from .schema_helpers import _compute_conflicts, _get_schema_path, _merge_schemas

router = APIRouter(prefix="", tags=["Project-Schema"])


class SaveMode(str, Enum):
    """Schema 保存模式"""

    CREATE = "create"  # 仅新建，不覆盖已有文件
    MERGE = "merge"  # 合并写入
    OVERWRITE = "overwrite"  # 直接覆盖


class SchemaConflictInfo(BaseModel):
    """
    Schema 冲突信息模型。

    使用场景：
    - 前端在保存 schema 前调用 check-conflict 接口，根据返回结果决定是否提示用户覆盖确认
    - 为前端提供详细的字段级冲突对比，提升用户体验

    字段说明：
    - exists: 目标文件是否已存在
    - file_path: 冲突文件相对于项目根目录的路径
    - has_conflict: 是否存在实质性字段冲突
    - conflict_fields: 具体冲突的字段列表（如 columns, constraints 等）
    - existing_schema: 现有 schema 的完整内容（用于前端对比展示）
    - new_schema: 新 schema 的完整内容（用于前端对比展示）
    """

    exists: bool
    file_path: str
    has_conflict: bool
    conflict_fields: list[str] = []
    existing_schema: Optional[dict[str, Any]] = None
    new_schema: Optional[dict[str, Any]] = None


@router.get(
    "/v2/schemas/{table_id}",
    response_model=TableSchemaFileV2,
    summary="读取 Schema",
    responses={
        404: {"description": "Schema 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def get_v2_schema(table_id: str, config_path: str = Depends(get_project_config_path)):
    """
    读取指定 table_id 的 schema 文件。

    查找策略（支持所有 schema，包括未列入 manifest 的）：
    1. 从 manifest.schemas 中查找引用（优先，性能更好）
    2. 如果未找到，扫描 schemas/ 目录，读取文件内容中的 id 字段

    参数:
        table_id: Schema 对应的表 ID
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        TableSchemaFileV2: Schema 文件内容
    """
    manifest = get_v2_manifest(config_path)

    # 策略 1: 从 manifest 中查找（优先）
    ref = next((s for s in manifest.schemas if s.id == table_id), None)

    if ref:
        schema_path = os.path.join(config_path, ref.path)
        if os.path.isfile(schema_path):
            data = read_yaml(Path(schema_path))
            return TableSchemaFileV2.model_validate(data)

    # 策略 2: 扫描 schemas/ 目录，读取文件内容中的 id 字段
    schemas_dir = os.path.join(config_path, "schemas")
    if os.path.isdir(schemas_dir):
        for filename in os.listdir(schemas_dir):
            if filename.lower().endswith(".schema.yaml"):
                try:
                    file_path = os.path.join(schemas_dir, filename)
                    data = read_yaml(Path(file_path))
                    if isinstance(data, dict) and data.get("id") == table_id:
                        return TableSchemaFileV2.model_validate(data)
                except Exception:
                    # 读取失败，继续下一个文件
                    continue

    raise HTTPException(status_code=404, detail=f"未找到 schema: {table_id}")


@router.put(
    "/v2/schemas/{table_id}",
    response_model=StandardResponse,
    summary="写入 Schema",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        409: {"description": "Schema 文件已存在"},
        500: {"description": "服务器内部错误"},
    },
)
def put_v2_schema(
    table_id: str,
    schema: TableSchemaFileV2,
    mode: SaveMode = SaveMode.OVERWRITE,
    config_path: str = Depends(get_project_config_path),
):
    """
    写入指定 table_id 的 schema 文件。

    业务逻辑：
    - 验证 schema.id 与路径参数 table_id 一致
    - 如果 manifest 未引用，自动补齐引用
    - 同时更新 manifest 文件
    - 支持三种保存模式：create（仅新建）、merge（合并）、overwrite（覆盖）

    副作用：
    - 创建或覆盖 schema 文件
    - 更新 manifest 中的引用列表

    数据流：
    1. 验证 schema.id 与 table_id 一致
    2. 读取 manifest 文件
    3. 检查 manifest 是否已有该 schema 的引用
    4. 如果没有，添加新的引用（默认路径：schemas/{table_id}.schema.yaml）
    5. 根据模式处理文件写入
       - create: 文件存在则报错
       - merge: 读取现有文件并合并
       - overwrite: 直接覆盖
    6. 更新 manifest 文件

    参数:
        table_id: Schema 对应的表 ID
        schema: Schema 数据
        mode: 保存模式 (create/merge/overwrite)
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    if schema.id != table_id:
        raise HTTPException(status_code=400, detail="schema.id 必须与路径参数 table_id 一致")

    manifest_path = _v2_manifest_path(config_path)
    manifest = (
        ProjectManifestV2.model_validate(read_yaml(Path(manifest_path))) if os.path.isfile(manifest_path) else None
    )
    if not manifest:
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")

    # 使用 _get_schema_path 获取实际的文件路径（处理大小写不一致问题）
    abs_schema_path = _get_schema_path(manifest, table_id, config_path)

    ref = next((s for s in manifest.schemas if s.id == table_id), None)
    if not ref:
        schema_name = schema.name or table_id
        default_rel = f"schemas/{schema_name}.schema.yaml"
        manifest.schemas.append(SchemaRefV2(id=table_id, path=default_rel))
        ref_path = default_rel
        if abs_schema_path is None:
            abs_schema_path = os.path.join(config_path, ref_path)
    else:
        ref_path = ref.path
        if abs_schema_path and abs_schema_path != os.path.join(config_path, ref_path):
            actual_rel = os.path.relpath(abs_schema_path, config_path)
            ref.path = actual_rel
            ref_path = actual_rel
        if abs_schema_path is None:
            abs_schema_path = os.path.join(config_path, ref_path)

    # 验证路径安全，防止路径遍历攻击
    try:
        abs_schema_path = _resolve_project_path(config_path, os.path.relpath(abs_schema_path, config_path))
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Schema 文件路径")

    new_schema_data = schema.model_dump(exclude_none=True)

    with project_lock(config_path):
        if os.path.exists(abs_schema_path):
            if mode == SaveMode.CREATE:
                raise HTTPException(
                    status_code=409, detail=f"Schema 文件已存在: {abs_schema_path}。请使用 merge 或 overwrite 模式。"
                )

            if mode == SaveMode.MERGE:
                existing_data = read_yaml(Path(abs_schema_path))
                merged_data = _merge_schemas(existing_data, new_schema_data)
                write_yaml_atomic(Path(abs_schema_path), merged_data)
            else:
                write_yaml_atomic(Path(abs_schema_path), new_schema_data)
        else:
            write_yaml_atomic(Path(abs_schema_path), new_schema_data)

        write_yaml_atomic(Path(manifest_path), manifest.model_dump(exclude_none=True))

    return {"message": f"V2 schema '{table_id}' 已保存。"}


@router.post(
    "/v2/schemas/{table_id}/check-conflict",
    response_model=SchemaConflictInfo,
    summary="检查 Schema 冲突",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Schema 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def check_schema_conflict(
    table_id: str,
    new_schema: TableSchemaFileV2,
    config_path: str = Depends(get_project_config_path),
):
    """
    检查 schema 保存时的冲突情况。

    用于在保存前检查是否与已存在的文件存在冲突，
    以便前端决定是否提示用户进行覆盖确认。

    参数:
        table_id: Schema 对应的表 ID
        new_schema: 新的 schema 数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        SchemaConflictInfo: 冲突信息（file_path 为相对于 config_path 的路径）
    """
    manifest = get_v2_manifest(config_path)
    schema_path = _get_schema_path(manifest, table_id, config_path)

    if not schema_path or not os.path.isfile(schema_path):
        # 返回相对于 config_path 的路径（如果存在）
        relative_path = ""
        if schema_path and schema_path.startswith(config_path):
            relative_path = os.path.relpath(schema_path, config_path).replace("\\", "/")
        return SchemaConflictInfo(
            exists=False,
            file_path=relative_path,
            has_conflict=False,
            conflict_fields=[],
            existing_schema=None,
            new_schema=new_schema.model_dump(exclude_none=True),
        )

    existing_data = read_yaml(Path(schema_path))
    new_data = new_schema.model_dump(exclude_none=True)
    conflict_fields = _compute_conflicts(existing_data, new_data)

    # 将绝对路径转换为相对于 config_path 的路径
    relative_path = os.path.relpath(schema_path, config_path).replace("\\", "/")

    return SchemaConflictInfo(
        exists=True,
        file_path=relative_path,
        has_conflict=len(conflict_fields) > 0,
        conflict_fields=conflict_fields,
        existing_schema=existing_data,
        new_schema=new_data,
    )


@router.delete(
    "/v2/schemas/{table_id}",
    response_model=StandardResponse,
    summary="删除 Schema",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Schema 或 Manifest 不存在"},
        409: {"description": "Schema 仍被约束引用"},
        500: {"description": "服务器内部错误"},
    },
)
def delete_v2_schema(table_id: str, config_path: str = Depends(get_project_config_path)):
    """
    删除指定 table_id 的 schema 文件，并从 manifest 中移除引用。

    删除策略（两层查找，更健壮）：
    1. 首先从 manifest.schemas 中查找引用（优先）
    2. 如果未找到，扫描 schemas/ 目录（兼容旧项目）

    副作用：
    - 删除对应的 .schema.yaml 文件
    - 从 manifest.schemas 中移除引用（如果存在）

    数据流：
    1. 读取 manifest 文件
    2. 在 manifest.schemas 中查找引用
    3. 如果未找到，扫描 schemas/ 目录
    4. 删除找到的 schema 文件
    5. 从 manifest 中移除引用
    6. 保存更新后的 manifest

    参数:
        table_id: Schema 对应的表 ID
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))

    ref = next((s for s in manifest.schemas if s.id == table_id), None)
    if not ref:
        ref = _scan_schema_file(table_id, config_path)

    if not ref:
        return {"message": f"未找到 schema '{table_id}'，无需删除。"}

    try:
        abs_schema_path = _resolve_project_path(config_path, ref.path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的 Schema 文件路径")

    with project_lock(config_path):
        for c_ref in manifest.constraints:
            try:
                c_path = _resolve_project_path(config_path, c_ref.path)
                if os.path.isfile(c_path):
                    c_data = read_yaml(Path(c_path))
                    refs_data = c_data.get("refs", {})
                    if refs_data.get("table_id") == table_id or refs_data.get("from_table_id") == table_id:
                        raise HTTPException(
                            status_code=409,
                            detail=f"Schema '{table_id}' 仍被 constraint '{c_ref.id}' 引用，请先删除引用",
                        )
            except HTTPException:
                raise
            except Exception:
                continue
        try:
            if os.path.isfile(abs_schema_path):
                os.remove(abs_schema_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除 schema 文件失败: {e}")

        if manifest.schemas:
            manifest.schemas = [s for s in manifest.schemas if s.id != table_id]
            write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))

    return {"message": f"V2 schema '{table_id}' 已删除。"}


@router.post(
    "/v2/schemas/{table_id}/display-name",
    response_model=StandardResponse,
    summary="更新 Schema 展示名",
    responses={
        404: {"description": "Schema 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def update_v2_schema_display_name(
    table_id: str,
    payload: DisplayNameUpdateRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    更新 schema 的展示名（不改变 table_id 与文件路径）。

    设计意图：
    - 允许用户给 Schema 设置友好的显示名称
    - 不改变底层 ID 和文件路径，保持引用完整性

    副作用：
    - 会触发两次文件写入（读取-修改-保存）

    数据流：
    1. 调用 get_v2_schema 获取当前 schema
    2. 修改 schema.name 为新名称
    3. 调用 put_v2_schema 保存更改

    参数:
        table_id: Schema 对应的表 ID
        payload: 新的展示名称
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    schema = get_v2_schema(table_id, config_path)
    schema.name = payload.name
    put_v2_schema(table_id, schema, config_path)
    return {"message": f"V2 schema '{table_id}' 展示名已更新。"}


class ImplicitToExplicitBindingRequest(BaseModel):
    """
    隐式转显式绑定请求模型。

    设计意图：
    - 前端用户点击"锁定关联"按钮时，将列与正则模式的隐式运行时匹配转为显式配置绑定
    - 显式绑定后，正则节点会参与级联渲染，并在配置文件中持久化

    字段说明：
    - column_id: 目标列的 ID（或 name，后端会做兼容匹配）
    - pattern_id: 要绑定的正则模式 ID
    - pattern_registry: 模式所在的注册表名称，默认 expression_registry
    """

    column_id: str
    pattern_id: str
    pattern_registry: str = "expression_registry"


@router.post(
    "/v2/schemas/{table_id}/convert-to-explicit-binding",
    response_model=StandardResponse,
    summary="将隐式正则匹配转换为显式绑定",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Schema 或列不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def convert_implicit_to_explicit_binding(
    table_id: str,
    payload: ImplicitToExplicitBindingRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    将隐式正则匹配转换为显式绑定。

    设计意图：
    - 用户在属性面板中点击"锁定关联"按钮时触发
    - 将运行时动态解析的隐式匹配转换为配置文件中的显式依赖
    - 转换后，正则节点将参与级联渲染

    业务逻辑：
    1. 读取当前 schema 文件
    2. 找到对应的列定义
    3. 将列的 type 从隐式转换为显式绑定
    4. 保存更新后的 schema 文件

    参数:
        table_id: Schema 对应的表 ID
        payload: 转换请求，包含列 ID 和目标正则模式 ID
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息
    """
    schema = get_v2_schema(table_id, config_path)

    if not schema.columns:
        raise HTTPException(status_code=404, detail="Schema has no columns")

    target_column = None
    for col in schema.columns:
        if col.id == payload.column_id or col.name == payload.column_id:
            target_column = col
            break

    if not target_column:
        raise HTTPException(status_code=404, detail=f"Column '{payload.column_id}' not found")

    # 更新列的绑定信息为显式 (Expr 字典)
    target_column.type = {"name": "Expr", "registry": payload.pattern_registry, "pattern": payload.pattern_id}

    # 调用通用的更新方法保存
    put_v2_schema(table_id, schema, SaveMode.OVERWRITE, config_path)
    return {
        "message": f"Column '{payload.column_id}' converted to explicit binding with pattern '{payload.pattern_id}'"
    }
