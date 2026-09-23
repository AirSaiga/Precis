# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 项目加载主入口模块

功能概述:
- 负责从 manifest 文件出发，加载整个项目的全部配置
- 按顺序加载: manifest -> schemas -> constraints -> regex -> patterns
- 构建运行时数据结构 (runtime schemas, constraints)

架构设计:
- 两层加载: 文件加载 (file_loaders) + 运行时转换 (runtime builders)
- 错误收集机制: 记录所有加载错误和警告，最后返回给调用者
- 路径验证: 确保所有引用的文件都在项目目录内，防止目录遍历攻击
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from app.shared.core.io.yaml import read_yaml
from app.shared.core.manifest_schema import is_supported_version
from app.shared.core.project.constraint.reader import load_constraint
from app.shared.core.project.loader.loader_parts import loading_error_messages
from app.shared.core.project.loader.loader_parts.embedded_constraints import collect_constraints_from_schemas
from app.shared.core.project.loader.loader_parts.file_loaders import load_manual_data_file
from app.shared.core.project.loader.loader_parts.path_validation import validate_path_inside_project
from app.shared.core.project.loader.loader_parts.runtime import build_registries
from app.shared.core.project.loader.types import LoadedProject, LoadingError, SchemaBuilder
from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.regex.reader import load_regex_node
from app.shared.core.project.schema.reader import load_schema
from app.shared.core.project.template.expander import expand_template
from app.shared.core.project.template.reader import load_template
from app.shared.core.project.transform.reader import load_transform

logger = logging.getLogger(__name__)

T = TypeVar("T")


def _load_referenced_files(
    project_root: Path,
    refs: list,
    load_fn: Callable[[Path], T],
    file_type: str,
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> dict[str, T]:
    """@methoddesc 通用文件加载函数。

    遍历 manifest 引用列表，验证路径、检查文件存在、加载并解析文件。
    所有错误和警告都被收集，不会中断加载流程。

    Args:
        project_root: 项目根目录
        refs: 引用列表（包含 id 和 path）
        load_fn: 文件加载函数
        file_type: 文件类型名称（用于错误信息）
        warnings: 警告列表（会被修改）
        loading_errors: 错误列表（会被修改）

    Returns:
        加载成功的文件字典 {id: file_object}
    """
    result: dict[str, T] = {}
    for ref in refs:
        file_path = project_root / ref.path
        try:
            validate_path_inside_project(project_root, file_path, f"{file_type} '{ref.id}'")
        except ValueError as e:
            loading_errors.append(
                LoadingError(
                    error_type=f"{file_type}PathValidationError",
                    file_path=str(file_path),
                    ref_id=ref.id,
                    **loading_error_messages.path_validation_error(file_type, ref.id, str(e), str(file_path)),
                )
            )
            continue

        if not file_path.exists():
            warning_msg = f"跳过不存在的 {file_type} 文件: {file_path} (引用 ID: {ref.id})"
            warnings.append(warning_msg)
            loading_errors.append(
                LoadingError(
                    error_type=f"{file_type}NotFound",
                    file_path=str(file_path),
                    ref_id=ref.id,
                    **loading_error_messages.file_not_found_error(file_type, ref.id, str(file_path)),
                )
            )
            logger.warning("[WARN] %s", warning_msg)
            continue

        try:
            result[ref.id] = load_fn(file_path)
        except Exception as e:
            loading_errors.append(
                LoadingError(
                    error_type=f"{file_type}ParseError",
                    file_path=str(file_path),
                    ref_id=ref.id,
                    **loading_error_messages.parse_error(file_type, ref.id, str(file_path), e),
                )
            )
            logger.warning("[WARN] %s 加载失败: %s, %s", file_type, ref.id, e)

    return result


def _supported_versions_desc() -> str:
    """当前支持的配置版本号描述（单一事实源为 manifest_schema.version 的常量）。"""
    from app.shared.core.manifest_schema.version import get_version_info

    return ", ".join(str(v) for v in get_version_info()["supported_versions"])


def _check_manifest_version(manifest_file: Path) -> LoadingError | None:
    """显式校验 manifest 顶层 version 字段（P0-1 版本识别机制）。

    version 在 ProjectManifest 模型中有默认值，缺失时会被 Pydantic 静默补为 2，
    因此必须在模型解析之前对原始 YAML 做显式检查：
    - 缺失 → 报"缺少 version 字段，当前支持版本为 2"
    - 值等价于支持版本 → 返回 None，走原有加载流程。H12 起宽松收窄 int：
      `version: "2"`（YAML 书写器惯常加引号）与 `2.0` 均按值等价放行，
      不再按类型误杀；布尔与无法无损转 int 的值（"abc"、1.5 等）仍拒绝
    - 非支持版本 → 报版本不支持并给迁移指引

    Args:
        manifest_file: manifest 文件路径

    Returns:
        版本问题对应的 LoadingError；版本合法时返回 None。
        YAML 本身解析失败会直接抛出（与原有行为一致，由 load_manifest 兜底）。
    """
    raw = read_yaml(manifest_file)
    if not isinstance(raw, dict):
        # 非字典结构（如 YAML 列表）交给后续 Pydantic 校验报错，此处不重复处理
        return None

    if "version" not in raw or raw.get("version") is None:
        return LoadingError(
            error_type="ManifestVersionError",
            file_path=str(manifest_file),
            **loading_error_messages.manifest_version_missing(_supported_versions_desc()),
        )

    version = raw["version"]
    coerced: int | None = None
    if isinstance(version, bool):
        coerced = None
    elif isinstance(version, int):
        coerced = version
    elif isinstance(version, float) and version.is_integer():
        coerced = int(version)
    elif isinstance(version, str):
        try:
            coerced = int(version.strip())
        except ValueError:
            coerced = None
    if coerced is None or not is_supported_version(coerced):
        return LoadingError(
            error_type="ManifestVersionError",
            file_path=str(manifest_file),
            **loading_error_messages.manifest_version_unsupported(version, _supported_versions_desc()),
        )
    return None


def load_project(
    manifest_path: str,
    schema_builder: SchemaBuilder | None = None,
) -> LoadedProject:
    """@methoddesc 加载整个 Precis 项目配置。

    加载流程 (按顺序执行):
    1. 读取 manifest 文件，验证版本号
    2. 构建 patterns 注册表
    3. 加载所有 schema 文件
    4. 加载所有 constraint 文件
    5. 从 schema 中收集内嵌约束
    6. 加载所有 regex 文件
    7. 构建运行时 schema
    8. 创建运行时 constraints

    :param manifest_path: manifest 文件路径
    :param schema_builder: 运行时数据集 Schema 构建器（依赖注入）。
        core 层不直接依赖 services，由调用方（services 层）注入构建器
        完成 "core 文件对象 → domain 运行时对象" 的转换。
        为 None 时 dataset_schema 字段保持为 None，由调用方自行处理。
    """
    manifest_file = Path(manifest_path)
    project_root = manifest_file.parent

    # P0-1: 在 Pydantic 解析之前显式校验 version 字段。
    # 版本不识别时不进入后续加载阶段：错误经 loading_errors 结构化通道透出
    # （--format json 时在 loading_warnings 可见），并返回空项目让校验流程
    # 可控收场（数据加载阶段会报告"未加载任何数据表"）。
    version_error = _check_manifest_version(manifest_file)
    if version_error is not None:
        from app.shared.core.project.manifest.types import ProjectManifest

        placeholder_manifest = ProjectManifest.model_validate({"project": {"id": "unknown", "name": "unknown"}})
        registries = build_registries(project_root, placeholder_manifest)
        empty_schema: dict = {}
        empty_constraints: dict = {}
        empty_schema_obj = schema_builder(empty_schema, empty_constraints, registries)[0] if schema_builder else None
        return LoadedProject(
            manifest_path=manifest_file,
            manifest=placeholder_manifest,
            schema_files=empty_schema,
            constraint_files=empty_constraints,
            regex_node_files={},
            transform_files={},
            manual_data_files={},
            dataset_schema=empty_schema_obj,
            warnings=[],
            loading_errors=[version_error],
        )

    manifest = load_manifest(manifest_file)

    version = manifest.version
    if not is_supported_version(version):
        # _check_manifest_version 已在解析前拦截非 2 版本，此处为防御性兜底
        # （例如 raw 为非字典结构时 Pydantic 仍可能解析出非 2 版本）
        raise ValueError(f"不支持的项目配置版本: {version}，支持的版本: {_supported_versions_desc()}")

    registries = build_registries(project_root, manifest)

    warnings: list[str] = []
    loading_errors: list[LoadingError] = []

    # 阶段 1：加载 Schema 文件
    schema_files = _load_referenced_files(
        project_root,
        manifest.schemas,
        load_schema,
        "Schema",
        warnings,
        loading_errors,
    )

    # 阶段 2：加载独立 Constraint 文件
    constraint_files = _load_referenced_files(
        project_root,
        manifest.constraints,
        load_constraint,
        "Constraint",
        warnings,
        loading_errors,
    )

    # 阶段 3：收集 Schema 中内嵌的约束（列引用解析不到时结构化报错并丢弃该约束）
    schema_path_by_id = {ref.id: ref.path for ref in manifest.schemas}
    embedded_constraints = collect_constraints_from_schemas(schema_files, loading_errors, schema_path_by_id)
    for cid, const in embedded_constraints.items():
        if cid in constraint_files:
            warnings.append(f"约束 ID '{cid}' 同时存在于独立文件和内嵌配置中，内嵌配置优先")
        constraint_files[cid] = const

    # P0-3: 构建约束 ID -> 来源文件路径映射（相对 manifest 目录），供校验错误回溯。
    # 独立约束取 manifest 引用路径；内嵌约束归属其宿主 schema 文件。
    # H13：宿主取自 collect_constraints_from_schemas 落进 refs 的 table_id /
    # from_table_id（构建时已记录），弃 schema id 前缀猜测——orders 与
    # orders_extra 前缀碰撞时前缀法会把约束指错文件
    constraint_source_files: dict[str, str] = {ref.id: ref.path for ref in manifest.constraints}
    for embedded_id, embedded_cf in embedded_constraints.items():
        host_schema_id = embedded_cf.refs.get("table_id") or embedded_cf.refs.get("from_table_id")
        host_path = schema_path_by_id.get(host_schema_id) if host_schema_id else None
        if host_path:
            # 内嵌优先与 constraint_files 覆盖语义一致
            constraint_source_files[embedded_id] = host_path

    # 阶段 4：加载 Regex 节点文件
    regex_files = _load_referenced_files(
        project_root,
        manifest.regex_nodes,
        load_regex_node,
        "Regex",
        warnings,
        loading_errors,
    )

    # 阶段 4b：加载 Transform 节点文件
    transform_files = _load_referenced_files(
        project_root,
        manifest.transforms,
        load_transform,
        "Transform",
        warnings,
        loading_errors,
    )

    # 阶段 4b2：加载 ManualData 节点文件
    manual_data_files = _load_referenced_files(
        project_root,
        manifest.manual_data,
        load_manual_data_file,
        "ManualData",
        warnings,
        loading_errors,
    )

    # 阶段 4c：加载模板定义并展开 template_instances
    # 模板实例展开为带命名空间 ID 的 constraint/transform/regex/manual_data，合并进对应字典
    template_files = _load_referenced_files(
        project_root,
        manifest.templates,
        load_template,
        "Template",
        warnings,
        loading_errors,
    )
    for instance in manifest.template_instances:
        if not instance.enabled:
            continue
        tmpl = template_files.get(instance.template_id)
        if tmpl is None:
            loading_errors.append(
                LoadingError(
                    error_type="TemplateInstanceMissingTemplate",
                    ref_id=instance.id,
                    **loading_error_messages.template_expansion_error(
                        instance.id,
                        ValueError(f"模板 '{instance.template_id}' 未找到"),
                        str(manifest_file),
                    ),
                )
            )
            continue
        try:
            # 节点级错误收集：单节点展开失败不中断其余节点，但必须上报 loading error
            # （否则该节点约束静默缺失，校验报告给出"全部通过"假阳性）
            node_errors: list[dict[str, str]] = []
            t_list, c_list, r_list, m_list = expand_template(
                tmpl,
                instance.id,
                params=instance.params,
                input_from_node=instance.input_from_node,
                errors=node_errors,
            )
            for node_err in node_errors:
                loading_errors.append(
                    LoadingError(
                        error_type="TemplateNodeExpansionError",
                        file_path=str(manifest_file),
                        ref_id=f"{instance.id}/{node_err.get('node_id', '?')}",
                        **loading_error_messages.template_node_expansion_error(
                            instance.id,
                            node_err.get("node_id", "?"),
                            node_err.get("message", ""),
                            str(manifest_file),
                        ),
                    )
                )

            # B05 修复：模板展开后 ID 冲突时记录警告（而非静默覆盖），
            # 但保留覆盖行为以兼容历史项目（部分项目依赖模板实例间 ID 复用）。
            # 记录为 warning 而非 blocker，避免阻断正常加载流程。
            def _record_id_conflict(kind: str, conflicted_id: str) -> None:
                warnings.append(
                    f"模板实例 '{instance.id}' 展开产生 ID 冲突：{kind} '{conflicted_id}' 已存在"
                    f"（可能来自项目的普通配置文件，也可能是此前展开的其他模板实例产物），"
                    f"当前实例的内容将覆盖已有定义。"
                )

            for tf in t_list:
                if tf.id in transform_files:
                    _record_id_conflict("transform", tf.id)
                transform_files[tf.id] = tf
            for cf in c_list:
                if cf.id in constraint_files:
                    _record_id_conflict("constraint", cf.id)
                constraint_files[cf.id] = cf
            for rf in r_list:
                if rf.id in regex_files:
                    _record_id_conflict("regex", rf.id)
                regex_files[rf.id] = rf
            for mf in m_list:
                if mf.id in manual_data_files:
                    _record_id_conflict("manual_data", mf.id)
                manual_data_files[mf.id] = mf
        except Exception as e:
            loading_errors.append(
                LoadingError(
                    error_type="TemplateExpansionError",
                    file_path=str(manifest_file),
                    ref_id=instance.id,
                    **loading_error_messages.template_expansion_error(instance.id, e, str(manifest_file)),
                )
            )

    # 阶段 5：构建运行时数据结构
    # 通过依赖注入的 schema_builder 完成 "core 文件对象 → domain 运行时对象" 的转换，
    # 避免 core 层反向依赖 services 层。调用方（services）传入构建器；
    # 未注入时 dataset_schema 保持为 None，由调用方自行构建。
    if schema_builder is not None:
        dataset_schema, constraint_warnings = schema_builder(schema_files, constraint_files, registries)
        warnings.extend(constraint_warnings)
    else:
        dataset_schema = None

    # 阶段 6：配置格式自检（ID 一致性、引用完整性等）
    from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

    inspect_config(
        manifest_file,
        manifest,
        schema_files,
        constraint_files,
        regex_files,
        transform_files,
        manual_data_files,
        warnings,
        loading_errors,
    )

    return LoadedProject(
        manifest_path=manifest_file,
        manifest=manifest,
        schema_files=schema_files,
        constraint_files=constraint_files,
        regex_node_files=regex_files,
        transform_files=transform_files,
        manual_data_files=manual_data_files,
        dataset_schema=dataset_schema,
        warnings=warnings,
        loading_errors=loading_errors,
        constraint_source_files=constraint_source_files,
    )
