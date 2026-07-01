"""
@fileoverview 全量配置 API - 读取/写入全部配置

功能概述:
- 提供项目全量配置的读写接口，支持导出、导入与 AI 生成配置写入
- 支持 YAML 格式导出
- 提供配置对比能力（ConfigDiffService）

架构设计:
- 读取时通过 compute_manifest_coverage 扫描目录补充缺失引用
- 写入时采用合并策略：保留现有 manifest 中未覆盖的引用
- 支持 schema ID 自动迁移（根据 source.path 生成标准 ID）

输入示例:
    GET /config/full
    PUT /config/full (body: FullConfigV2Request)
    POST /config/compare (body: FullConfigV2Request)

输出示例:
    dict: 包含 manifest、effective_manifest、schemas、constraints、regex_nodes 等
    ConfigDiffResult: 配置差异详情
"""

import logging
import os
from datetime import UTC
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config
from app.shared.core.project.loader.types import LoadingError
from app.shared.core.project.manifest.coverage import compute_manifest_coverage, coverage_to_api_dict
from app.shared.core.project.manual_data.types import ManualDataFileV2
from app.shared.core.project.regex.types import RegexNodeFileV2
from app.shared.core.project.transform.types import TransformFileV2
from app.shared.services.diff.config_diff import ConfigDiffResult, ConfigDiffService

from .base import (
    ConstraintFileV2,
    ConstraintRefV2,
    FullConfigV2Request,
    RegexNodeRefV2,
    SchemaRefV2,
    StandardResponse,
    TableSchemaFileV2,
)
from .full_config_writer import write_v2_full_config
from .helpers import _resolve_project_path
from .manifest import get_v2_manifest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-FullConfig"])


@router.get(
    "/config/full",
    response_model=dict[str, Any],
    summary="读取 V2 全量配置",
    responses={
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def get_v2_full_config(
    config_path: str = Depends(get_project_config_path),
    inspect: bool = False,
):
    """
    读取 V2 全量配置：manifest + 所有 schemas/constraints/regex_nodes 内容。

    使用场景：
    - 前端导出整个项目配置
    - AI 配置生成前获取现有配置
    - 项目备份/迁移

    副作用：
    - 如果 manifest 中引用的文件不存在，记录警告但继续处理

    查询参数：
    - inspect: 是否执行配置文件格式自检（默认 false，避免重复调用）

    数据流（分三步）：
    Step 1: 获取/补充 manifest
      - 读取 manifest（优先）
      - 扫描目录补充缺失的引用

    Step 2: 读取所有资源文件
      - 遍历 manifest 中的引用
      - 读取每个 schema/constraint/regex 文件

    Step 3: 返回聚合结果
      - 组合 manifest + schemas + constraints + regex_nodes

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）
        inspect: 是否执行配置自检（通过查询参数注入）

    返回:
        dict: 包含 manifest、schemas、constraints、regex_nodes 的字典
    """
    manifest = get_v2_manifest(config_path)
    coverage_model = compute_manifest_coverage(config_path, manifest)
    coverage = coverage_to_api_dict(coverage_model)
    manifest_modified = bool(
        coverage_model.unlisted_schemas or coverage_model.unlisted_constraints or coverage_model.unlisted_regex_nodes
    )

    effective_manifest = manifest.model_copy(
        update={
            "schemas": [
                *manifest.schemas,
                *[SchemaRefV2(id=r.id, path=r.path) for r in coverage_model.unlisted_schemas],
            ],
            "constraints": [
                *manifest.constraints,
                *[ConstraintRefV2(id=r.id, path=r.path) for r in coverage_model.unlisted_constraints],
            ],
            "regex_nodes": [
                *manifest.regex_nodes,
                *[RegexNodeRefV2(id=r.id, path=r.path) for r in coverage_model.unlisted_regex_nodes],
            ],
        }
    )

    # 读取所有 Schema 文件
    schemas: dict[str, Any] = {}
    schema_objects: dict[str, TableSchemaFileV2] = {}  # 保留对象用于自检
    schema_errors: dict[str, str] = {}
    for ref in effective_manifest.schemas:
        try:
            schema_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            schema_errors[ref.id] = str(e)
            continue
        if os.path.isfile(schema_path):
            try:
                schema_obj = TableSchemaFileV2.model_validate(read_yaml(Path(schema_path)))
                # 同 id 冲突时仅保留首个，记录 warning 日志。
                # 注意：不写入 schema_errors —— schema_errors 语义是「YAML 解析失败」，
                # 用于资源树标记 + toast 提示；ID 冲突应由 inspect 的 SchemaIdDuplicate
                # blocker 统一上报（避免同一问题触发 toast + 徽章双重提示）。
                if ref.id in schemas:
                    logger.warning(
                        f"[get_v2_full_config] Schema ID 冲突: '{ref.id}' 已存在，"
                        f"文件 {ref.path} 的数据未被加载（已存在: {schemas[ref.id].get('source', {}).get('path', '?')}）"
                    )
                else:
                    schema_objects[ref.id] = schema_obj
                    schemas[ref.id] = schema_obj.model_dump(exclude_none=True)
            except Exception as e:
                error_msg = str(e)
                logger.error(f"[get_v2_full_config] 解析 Schema 文件失败: {schema_path}, 错误: {error_msg}")
                schema_errors[ref.id] = error_msg
        else:
            logger.warning(f"[get_v2_full_config] Schema 文件不存在: {schema_path}")
            schema_errors[ref.id] = f"Schema 文件不存在: {ref.path}"

    # 读取所有 Constraint 文件
    constraints: dict[str, Any] = {}
    constraint_objects: dict[str, ConstraintFileV2] = {}  # 保留对象用于自检
    for ref in effective_manifest.constraints:
        try:
            constraint_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[get_v2_full_config] 非法 Constraint 路径: {ref.path}, 错误: {e}")
            continue
        if os.path.isfile(constraint_path):
            try:
                constraint_obj = ConstraintFileV2.model_validate(read_yaml(Path(constraint_path)))
                constraint_objects[ref.id] = constraint_obj
                constraints[ref.id] = constraint_obj.model_dump(exclude_none=True)
            except Exception as e:
                logger.error(f"[get_v2_full_config] 解析 Constraint 文件失败: {constraint_path}, 错误: {e}")
        else:
            logger.warning(f"[get_v2_full_config] Constraint 文件不存在: {constraint_path}")

    # 扫描正则表达式注册表目录（patterns/）
    # 这些目录存储可复用的正则表达式模式定义，供节点引用
    regex_registries: dict[str, Any] = {}
    patterns_dir = os.path.join(config_path, manifest.patterns_dir or "patterns")

    if os.path.isdir(patterns_dir):
        for filename in os.listdir(patterns_dir):
            if filename.endswith(".yaml"):
                pattern_id = filename[:-5]
                file_path = os.path.join(patterns_dir, filename)
                try:
                    raw = read_yaml(Path(file_path))
                    regex_registries[f"patterns/{pattern_id}"] = {
                        "id": pattern_id,
                        "registry": "patterns",
                        "definition": raw,
                    }
                except Exception as e:
                    logger.warning(f"[get_v2_full_config] 解析正则注册表失败: {file_path}, 错误: {e}")

    # 读取正则表达式节点
    # 优先从 manifest.regex_nodes 读取，否则扫描 regex/ 目录
    regex_nodes: dict[str, Any] = {}
    regex_objects: dict[str, RegexNodeFileV2] = {}  # 保留对象用于自检

    for ref in effective_manifest.regex_nodes:
        abs_path = _resolve_project_path(config_path, ref.path)
        if os.path.isfile(abs_path):
            try:
                regex_obj = RegexNodeFileV2.model_validate(read_yaml(Path(abs_path)))
                regex_objects[ref.id] = regex_obj
                regex_nodes[ref.id] = regex_obj.model_dump(exclude_none=True)
            except Exception as e:
                logger.error(f"[get_v2_full_config] 解析 Regex 文件失败: {abs_path}, 错误: {e}")
        else:
            logger.warning(f"[get_v2_full_config] Regex 文件不存在: {abs_path}")

    # 读取 Transform 节点
    transforms: dict[str, Any] = {}
    transform_objects: dict[str, TransformFileV2] = {}  # 保留对象用于自检

    for ref in effective_manifest.transforms or []:
        abs_path = _resolve_project_path(config_path, ref.path)
        if os.path.isfile(abs_path):
            try:
                transform_obj = TransformFileV2.model_validate(read_yaml(Path(abs_path)))
                transform_objects[ref.id] = transform_obj
                transforms[ref.id] = transform_obj.model_dump(exclude_none=True)
            except Exception as e:
                logger.error(f"[get_v2_full_config] 解析 Transform 文件失败: {abs_path}, 错误: {e}")
        else:
            logger.warning(f"[get_v2_full_config] Transform 文件不存在: {abs_path}")

    # 读取 ManualData 节点
    manual_data: dict[str, Any] = {}
    manual_data_objects: dict[str, ManualDataFileV2] = {}  # 保留对象用于自检

    for ref in effective_manifest.manual_data or []:
        abs_path = _resolve_project_path(config_path, ref.path)
        if os.path.isfile(abs_path):
            try:
                manual_data_obj = ManualDataFileV2.model_validate(read_yaml(Path(abs_path)))
                manual_data_objects[ref.id] = manual_data_obj
                manual_data[ref.id] = manual_data_obj.model_dump(exclude_none=True)
            except Exception as e:
                logger.error(f"[get_v2_full_config] 解析 ManualData 文件失败: {abs_path}, 错误: {e}")
        else:
            logger.warning(f"[get_v2_full_config] ManualData 文件不存在: {abs_path}")

    result = {
        "manifest": manifest.model_dump(exclude_none=True),
        "effective_manifest": effective_manifest.model_dump(exclude_none=True),
        "schemas": schemas,
        "constraints": constraints,
        "regex_registries": regex_registries,
        "regex_nodes": regex_nodes,
        "transforms": transforms,
        "manual_data": manual_data,
        "coverage": coverage,
        "manifest_modified": manifest_modified,
        "schema_errors": schema_errors,
    }

    # 仅当 inspect=true 时执行配置文件格式自检
    if inspect:
        from datetime import datetime

        inspection_warnings: list[str] = []
        inspection_errors: list[LoadingError] = []
        inspect_config(
            Path(config_path) / "project.precis.yaml",
            effective_manifest,
            schema_objects,
            constraint_objects,
            regex_objects,
            transform_objects,  # ⭐ 传入 transform 对象用于自检
            manual_data_objects,
            inspection_warnings,
            inspection_errors,
        )
        result["inspection"] = {
            "inspected_at": datetime.now(UTC).isoformat(),
            "errors": [e.to_dict() for e in inspection_errors],
        }

    return result


@router.put(
    "/config/full",
    response_model=StandardResponse,
    summary="写入 V2 全量配置",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def put_v2_full_config(payload: FullConfigV2Request, config_path: str = Depends(get_project_config_path)):
    """
    @methoddesc 写入 V2 全量配置

    业务用途:
    - 由前端"保存项目"或"导入配置"等流程调用
    - 委托给 write_v2_full_config 执行实际写入，包含 manifest、所有 schemas/constraints/regex_nodes

    参数:
        payload: 完整 V2 配置请求体
        config_path: 项目配置路径（依赖注入）

    返回:
        StandardResponse: 写入操作的统一响应
    """
    return write_v2_full_config(payload, config_path)


@router.post(
    "/config/compare",
    response_model=ConfigDiffResult,
    summary="对比 V2 全量配置差异",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def compare_v2_full_config(payload: FullConfigV2Request, config_path: str = Depends(get_project_config_path)):
    """
    对比 V2 全量配置差异。

    使用场景：
    - AI 生成完整项目配置后，与当前配置对比，供用户确认
    - 项目导入前，预览变更内容

    参数:
        payload: 包含 manifest 和所有资源配置的新配置
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ConfigDiffResult: 配置差异详情
    """
    current_config = get_v2_full_config(config_path)
    # 将 Pydantic 模型转为 dict，与 get_v2_full_config 返回结构对齐
    new_config = payload.model_dump(exclude_none=True)
    return ConfigDiffService.compare(current_config, new_config)
