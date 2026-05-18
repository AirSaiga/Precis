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
    GET /v2/config/full
    PUT /v2/config/full (body: FullConfigV2Request)
    POST /v2/config/compare (body: FullConfigV2Request)

输出示例:
    dict: 包含 manifest、effective_manifest、schemas、constraints、regex_nodes 等
    PlainTextResponse: YAML 格式的全量配置文本
    ConfigDiffResult: 配置差异详情
"""

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml
from app.shared.core.project.manifest.coverage import compute_manifest_coverage, coverage_to_api_dict
from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.core.project.regex.types import RegexNodeFileV2
from app.shared.services.diff.config_diff import ConfigDiffResult, ConfigDiffService

from .base import (
    ConstraintFileV2,
    ConstraintRefV2,
    FullConfigV2Request,
    RegexNodeRefV2,
    SchemaRefV2,
    StandardResponse,
    TableSchemaFileV2,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock
from .manifest import get_v2_manifest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-FullConfig"])


@router.get("/v2/config/full")
def get_v2_full_config(config_path: str = Depends(get_project_config_path)):
    """
    读取 V2 全量配置：manifest + 所有 schemas/constraints/regex_nodes 内容。

    使用场景：
    - 前端导出整个项目配置
    - AI 配置生成前获取现有配置
    - 项目备份/迁移

    副作用：
    - 如果 manifest 中引用的文件不存在，记录警告但继续处理

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
    schema_errors: dict[str, str] = {}
    for ref in effective_manifest.schemas:
        try:
            schema_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            schema_errors[ref.id] = str(e)
            continue
        if os.path.isfile(schema_path):
            try:
                schemas[ref.id] = TableSchemaFileV2.model_validate(read_yaml(Path(schema_path))).model_dump(
                    exclude_none=True
                )
            except Exception as e:
                error_msg = str(e)
                logger.error(f"[get_v2_full_config] 解析 Schema 文件失败: {schema_path}, 错误: {error_msg}")
                schema_errors[ref.id] = error_msg
        else:
            logger.warning(f"[get_v2_full_config] Schema 文件不存在: {schema_path}")
            schema_errors[ref.id] = f"Schema 文件不存在: {ref.path}"

    # 读取所有 Constraint 文件
    constraints: dict[str, Any] = {}
    for ref in effective_manifest.constraints:
        try:
            constraint_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[get_v2_full_config] 非法 Constraint 路径: {ref.path}, 错误: {e}")
            continue
        if os.path.isfile(constraint_path):
            try:
                constraints[ref.id] = ConstraintFileV2.model_validate(read_yaml(Path(constraint_path))).model_dump(
                    exclude_none=True
                )
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

    for ref in effective_manifest.regex_nodes:
        abs_path = os.path.join(config_path, ref.path)
        if os.path.isfile(abs_path):
            try:
                regex_nodes[ref.id] = RegexNodeFileV2.model_validate(read_yaml(Path(abs_path))).model_dump(
                    exclude_none=True
                )
            except Exception as e:
                logger.error(f"[get_v2_full_config] 解析 Regex 文件失败: {abs_path}, 错误: {e}")
        else:
            logger.warning(f"[get_v2_full_config] Regex 文件不存在: {abs_path}")

    return {
        "manifest": manifest.model_dump(exclude_none=True),
        "effective_manifest": effective_manifest.model_dump(exclude_none=True),
        "schemas": schemas,
        "constraints": constraints,
        "regex_registries": regex_registries,
        "regex_nodes": regex_nodes,
        "coverage": coverage,
        "manifest_modified": manifest_modified,
        "schema_errors": schema_errors,
    }


@router.get("/v2/config/full/yaml", response_class=PlainTextResponse)
def get_v2_full_config_yaml(config_path: str = Depends(get_project_config_path)):
    """
    导出 V2 全量配置为 YAML 文本。

    使用场景：
    - 用户导出项目为 YAML 文件进行版本控制
    - 项目配置备份

    副作用：
    - 调用 get_v2_full_config 获取数据后转换为 YAML

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        PlainTextResponse: YAML 格式的项目配置
    """
    import yaml

    data = get_v2_full_config(config_path)
    text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    return PlainTextResponse(text, media_type="text/yaml; charset=utf-8")


@router.put("/v2/config/full", response_model=StandardResponse)
def put_v2_full_config(payload: FullConfigV2Request, config_path: str = Depends(get_project_config_path)):
    """
    写入 V2 全量配置（会覆盖写入 manifest 与其引用的文件）。

    使用场景：
    - AI 生成完整项目配置后写入
    - 项目导入（从备份恢复）
    - 批量更新项目配置

    合并策略：
    - 如果前端传来的 manifest 中的某类资源为空，保留现有 manifest 中的同类引用
    - 如果目录中有额外的资源文件，也会合并到 manifest 中

    副作用：
    - 写入 manifest 文件
    - 写入所有 schemas、constraints、regex_nodes 文件

    数据流：
    Step 1: 读取现有 manifest（如果存在）
    Step 2: 计算最终 manifest（合并策略）
    Step 3: 写入 manifest
    Step 4: 遍历 payload 中的资源并写入文件

    参数:
        payload: 包含 manifest 和所有资源配置的请求
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    existing_manifest = None
    if os.path.isfile(manifest_path):
        try:
            existing_manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))
            logger.info("[put_v2_full_config] 读取现有 manifest 成功")
        except Exception as e:
            logger.warning(f"[put_v2_full_config] 读取现有 manifest 失败: {e}")

    schema_id_migration: dict[str, str] = {}
    migrated_schemas: dict[str, TableSchemaFileV2] = {}
    for key, schema in (payload.schemas or {}).items():
        current_id = schema.id or key
        src = schema.source
        src_path = src.path if src else ""
        sheet_name = (src.sheet if src else None) or getattr(schema, "sheet", None)
        if src_path and not current_id.startswith("sc_"):
            from app.shared.core.project.schema.types import generate_schema_id

            new_id = generate_schema_id(src_path, sheet_name)
            if new_id and new_id != current_id:
                schema_id_migration[current_id] = new_id
                schema = schema.model_copy(update={"id": new_id})
                migrated_schemas[new_id] = schema
                continue
        migrated_schemas[current_id] = schema

    if schema_id_migration:
        payload = payload.model_copy(update={"schemas": migrated_schemas})
        migrated_schema_refs: list[SchemaRefV2] = []
        for ref in payload.manifest.schemas:
            new_id = schema_id_migration.get(ref.id, ref.id)
            new_path = ref.path
            if new_id != ref.id:
                new_path = f"schemas/{new_id}.schema.yaml"
            migrated_schema_refs.append(SchemaRefV2(id=new_id, path=new_path))
        payload = payload.model_copy(
            update={"manifest": payload.manifest.model_copy(update={"schemas": migrated_schema_refs})}
        )

        def _rewrite_table_ids_in_refs(refs: dict[str, Any]) -> dict[str, Any]:
            for k in ["table_id", "from_table_id", "to_table_id"]:
                v = refs.get(k)
                if isinstance(v, str) and v in schema_id_migration:
                    refs[k] = schema_id_migration[v]
            return refs

        rewritten_schemas: dict[str, TableSchemaFileV2] = {}
        for sid, s in (payload.schemas or {}).items():
            s_data = s.model_dump(exclude_none=True)
            constraints = s_data.get("constraints") or []
            if isinstance(constraints, list):
                for c in constraints:
                    if isinstance(c, dict) and isinstance(c.get("refs"), dict):
                        c["refs"] = _rewrite_table_ids_in_refs(c["refs"])
            rewritten_schemas[sid] = TableSchemaFileV2.model_validate(s_data)

        migrated_constraints: dict[str, ConstraintFileV2] = {}
        for cid, c in (payload.constraints or {}).items():
            data = c.model_dump(exclude_none=True)
            refs = data.get("refs") or {}
            if isinstance(refs, dict):
                data["refs"] = _rewrite_table_ids_in_refs(refs)
            migrated_constraints[cid] = ConstraintFileV2.model_validate(data)
        migrated_regex_nodes: dict[str, RegexNodeFileV2] = {}
        for rid, r in (payload.regex_nodes or {}).items():
            data = r.model_dump(exclude_none=True)
            src_ref = data.get("source_ref") or {}
            if isinstance(src_ref, dict):
                table_id = src_ref.get("table_id")
                if isinstance(table_id, str) and table_id in schema_id_migration:
                    src_ref["table_id"] = schema_id_migration[table_id]
                data["source_ref"] = src_ref
            migrated_regex_nodes[rid] = RegexNodeFileV2.model_validate(data)
        payload = payload.model_copy(
            update={
                "schemas": rewritten_schemas,
                "constraints": migrated_constraints,
                "regex_nodes": migrated_regex_nodes,
            }
        )

    final_manifest = payload.manifest

    if not payload.manifest.schemas and existing_manifest and existing_manifest.schemas:
        logger.info(f"[put_v2_full_config] 合并现有 schemas: {len(existing_manifest.schemas)} 个")
        final_manifest = payload.manifest.model_copy(update={"schemas": existing_manifest.schemas})

    if not payload.manifest.constraints and existing_manifest and existing_manifest.constraints:
        final_manifest = final_manifest.model_copy(update={"constraints": existing_manifest.constraints})

    if not (payload.manifest.regex_nodes or []) and existing_manifest and existing_manifest.regex_nodes:
        final_manifest = final_manifest.model_copy(update={"regex_nodes": existing_manifest.regex_nodes})

    if not final_manifest.schemas:
        schemas_dir = os.path.join(config_path, "schemas")
        if os.path.isdir(schemas_dir):
            schema_refs = []
            for filename in os.listdir(schemas_dir):
                if filename.endswith(".schema.yaml"):
                    schema_id = filename[:-12]
                    schema_refs.append(SchemaRefV2(id=schema_id, path=f"schemas/{filename}"))
            if schema_refs:
                logger.info(f"[put_v2_full_config] 从 schemas/ 目录扫描到 {len(schema_refs)} 个 schema 文件")
                final_manifest = final_manifest.model_copy(update={"schemas": schema_refs})

    if not final_manifest.constraints:
        constraints_dir = os.path.join(config_path, "constraints")
        if os.path.isdir(constraints_dir):
            constraint_refs = []
            for filename in os.listdir(constraints_dir):
                if filename.endswith(".constraint.yaml"):
                    constraint_id = filename[:-16]
                    constraint_refs.append(ConstraintRefV2(id=constraint_id, path=f"constraints/{filename}"))
            if constraint_refs:
                logger.info(
                    f"[put_v2_full_config] 从 constraints/ 目录扫描到 {len(constraint_refs)} 个 constraint 文件"
                )
                final_manifest = final_manifest.model_copy(update={"constraints": constraint_refs})

    if not (final_manifest.regex_nodes or []):
        regex_dirs = [os.path.join(config_path, "regex"), os.path.join(config_path, "regex_nodes")]
        seen_regex_ids = set()
        regex_refs: list[RegexNodeRefV2] = []
        for d in regex_dirs:
            if not os.path.isdir(d):
                continue
            for filename in os.listdir(d):
                if filename.endswith(".regex.yaml"):
                    regex_id = filename[:-10]
                    if regex_id in seen_regex_ids:
                        continue
                    rel_dir = os.path.basename(d)
                    regex_refs.append(RegexNodeRefV2(id=regex_id, path=f"{rel_dir}/{filename}"))
                    seen_regex_ids.add(regex_id)
        if regex_refs:
            logger.info(f"[put_v2_full_config] 从 regex/ 目录扫描到 {len(regex_refs)} 个 regex 文件")
            final_manifest = final_manifest.model_copy(update={"regex_nodes": regex_refs})

    with project_lock(config_path):
        write_yaml(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    logger.info(f"[put_v2_full_config] 写入 manifest 完成，schemas: {len(final_manifest.schemas)} 个")

    for ref in payload.manifest.schemas:
        schema = payload.schemas.get(ref.id)
        if not schema:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Schema 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), schema.model_dump(exclude_none=True))

    for ref in payload.manifest.constraints:
        constraint = payload.constraints.get(ref.id)
        if not constraint:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Constraint 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), constraint.model_dump(exclude_none=True))

    for ref in payload.manifest.regex_nodes:
        regex_node = payload.regex_nodes.get(ref.id)
        if not regex_node:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Regex 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), regex_node.model_dump(exclude_none=True))

    return {"message": "V2 全量配置已保存。"}


@router.post("/v2/config/compare", response_model=ConfigDiffResult)
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
