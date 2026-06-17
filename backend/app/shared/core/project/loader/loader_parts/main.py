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

from pathlib import Path
from typing import Callable, TypeVar

from app.shared.core.manifest_schema import is_supported_version
from app.shared.core.project.constraint.factory import create_constraints
from app.shared.core.project.loader.loader_parts import loading_error_messages
from app.shared.core.project.loader.loader_parts.embedded_constraints import collect_constraints_from_schemas
from app.shared.core.project.loader.loader_parts.file_loaders import (
    load_constraint_file,
    load_regex_node_file,
    load_schema_file,
    load_template_file,
    load_transform_file,
)
from app.shared.core.project.loader.loader_parts.path_validation import validate_path_inside_project
from app.shared.core.project.loader.loader_parts.runtime import build_registries, build_runtime_schemas
from app.shared.core.project.loader.types import LoadedProject, LoadingError
from app.shared.core.project.manifest.reader import load_manifest
from app.shared.domain import DataSetSchema

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
                    **loading_error_messages.path_validation_error(file_type, ref.id, str(e)),
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
            print(f"[WARN] {warning_msg}")
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
            print(f"[WARN] {file_type} 加载失败: {ref.id}, {e}")

    return result


def load_project(manifest_path: str) -> LoadedProject:
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
    """
    manifest_file = Path(manifest_path)
    project_root = manifest_file.parent

    manifest = load_manifest(manifest_file)

    version = manifest.version
    if not is_supported_version(version):
        supported = ", ".join(str(v) for v in [2])
        raise ValueError(f"不支持的项目配置版本: {version}，支持的版本: {supported}")

    registries = build_registries(project_root, manifest)

    warnings: list[str] = []
    loading_errors: list[LoadingError] = []

    # 阶段 1：加载 Schema 文件
    schema_files = _load_referenced_files(
        project_root,
        manifest.schemas,
        load_schema_file,
        "Schema",
        warnings,
        loading_errors,
    )

    # 阶段 2：加载独立 Constraint 文件
    constraint_files = _load_referenced_files(
        project_root,
        manifest.constraints,
        load_constraint_file,
        "Constraint",
        warnings,
        loading_errors,
    )

    # 阶段 3：收集 Schema 中内嵌的约束
    embedded_constraints = collect_constraints_from_schemas(schema_files)
    for cid, const in embedded_constraints.items():
        if cid in constraint_files:
            warnings.append(f"约束 ID '{cid}' 同时存在于独立文件和内嵌配置中，内嵌配置优先")
        constraint_files[cid] = const

    # 阶段 4：加载 Regex 节点文件
    regex_files = _load_referenced_files(
        project_root,
        manifest.regex_nodes,
        load_regex_node_file,
        "Regex",
        warnings,
        loading_errors,
    )

    # 阶段 4b：加载 Transform 节点文件
    transform_files = _load_referenced_files(
        project_root,
        manifest.transforms,
        load_transform_file,
        "Transform",
        warnings,
        loading_errors,
    )

    # 阶段 4c：加载模板定义文件
    template_files = _load_referenced_files(
        project_root,
        manifest.templates,
        load_template_file,
        "Template",
        warnings,
        loading_errors,
    )

    # 阶段 4d：展开模板实例
    if template_files and manifest.template_instances:
        from app.shared.core.project.template.expander import expand_template

        for instance in manifest.template_instances:
            if not instance.enabled:
                continue
            template_def = template_files.get(instance.template_id)
            if not template_def:
                warnings.append(f"模板实例 '{instance.id}' 引用的模板 '{instance.template_id}' 不存在，跳过")
                continue
            try:
                exp_transforms, exp_constraints, exp_regex = expand_template(
                    template_def,
                    instance.id,
                    instance.params,
                    instance.input_from_node,
                )
                for t in exp_transforms:
                    transform_files[t.id] = t
                for c in exp_constraints:
                    constraint_files[c.id] = c
                for r in exp_regex:
                    regex_files[r.id] = r
            except Exception as e:
                loading_errors.append(
                    LoadingError(
                        error_type="TemplateExpansionError",
                        file_path="",
                        ref_id=instance.id,
                        **loading_error_messages.template_expansion_error(instance.id, e),
                    )
                )

    # 阶段 5：构建运行时数据结构
    runtime_tables = build_runtime_schemas(schema_files, registries)
    runtime_constraints, constraint_warnings = create_constraints(constraint_files, schema_files)
    warnings.extend(constraint_warnings)

    dataset_schema = DataSetSchema(tables=runtime_tables, constraints=runtime_constraints)

    # 阶段 6：配置格式自检（ID 一致性、引用完整性等）
    from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

    inspect_config(
        manifest_file,
        manifest,
        schema_files,
        constraint_files,
        regex_files,
        transform_files,
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
        dataset_schema=dataset_schema,
        warnings=warnings,
        loading_errors=loading_errors,
    )
