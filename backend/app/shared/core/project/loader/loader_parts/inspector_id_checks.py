"""ID 一致性检查模块。

检查 manifest 引用 ID 与文件内部 id 字段是否一致。
不一致会导致配置无法正常生效（manifest 找不到文件，或文件被错误引用）。

依赖：→ inspector_helpers（display + actions）+ inspection_ids + LoadingError
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.shared.core.project.loader.loader_parts import inspection_ids as ids
from app.shared.core.project.loader.loader_parts.inspector_helpers import (
    constraint_display,
    default_actions_for_file,
    manual_data_display,
    regex_display,
    schema_display,
    transform_display,
)
from app.shared.core.project.loader.types import LoadingError

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.manifest.types import ProjectManifest
    from app.shared.core.project.manual_data.types import ManualDataFile
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import TableSchemaFile
    from app.shared.core.project.transform.types import TransformFile


def build_id_mismatch_loading_error(
    resource_type: str,
    manifest_id: str,
    file_id: str,
    file_path: str,
    manifest_display: str,
    file_display: str,
) -> LoadingError:
    """构建 ID 不一致类型的 LoadingError（通用）。"""
    return LoadingError(
        id=ids.id_mismatch(resource_type, manifest_id, file_id),
        severity="warning",
        title="名字对不上",
        description=(
            f"项目配置里记的名字（{manifest_id}）和文件里的名字（{file_id}）对不上，可能导致这条配置无法正常生效。"
        ),
        fix_hint="点「一键修正」让两边名字统一即可。",
        error_type="IdMismatchWarning",
        file_path=file_path,
        ref_id=manifest_id,
        suggestion="请更新项目配置中的引用编号，或修改文件内部的编号使其一致",
        actions=default_actions_for_file(file_path, manifest_id),
        title_key=f"inspection.issues.idMismatch.{resource_type}.title",
        description_key=f"inspection.issues.idMismatch.{resource_type}.description",
        fix_hint_key=f"inspection.issues.idMismatch.{resource_type}.fixHint",
        message_params={
            "manifestId": manifest_id,
            "fileId": file_id,
            "manifestDisplay": manifest_display,
            "fileDisplay": file_display,
        },
        fix_api={
            "method": "POST",
            "path": "/project/manifest/fix-id-mismatch",
            "body": {"resource_type": resource_type, "manifest_id": manifest_id, "file_id": file_id},
        },
    )


def inspect_id_consistency(
    manifest: ProjectManifest,
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    regex_node_files: dict[str, RegexNodeFile],
    transform_files: dict[str, TransformFile],
    manual_data_files: dict[str, ManualDataFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """检查 manifest 引用 ID 与文件内部 ID 的一致性。"""
    for schema_ref in manifest.schemas or []:
        schema_file = schema_files.get(schema_ref.id)
        if schema_file and schema_file.id != schema_ref.id:
            manifest_display = schema_display(schema_files.get(schema_ref.id))
            file_display = schema_display(schema_file)
            msg = (
                f"Schema ID 不一致: manifest 引用 ID '{schema_ref.id}' "
                f"与文件内部 id '{schema_file.id}' 不匹配 (文件: {schema_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                build_id_mismatch_loading_error(
                    "schema", schema_ref.id, schema_file.id, schema_ref.path, manifest_display, file_display
                )
            )

    for constraint_ref in manifest.constraints or []:
        constraint_file = constraint_files.get(constraint_ref.id)
        if constraint_file and constraint_file.id != constraint_ref.id:
            manifest_display = constraint_display(constraint_files.get(constraint_ref.id))
            file_display = constraint_display(constraint_file)
            msg = (
                f"Constraint ID 不一致: manifest 引用 ID '{constraint_ref.id}' "
                f"与文件内部 id '{constraint_file.id}' 不匹配 (文件: {constraint_ref.path})"
            )
            warnings.append(msg)
            correct_ref_exists = any(
                other_ref.id == constraint_file.id
                for other_ref in (manifest.constraints or [])
                if other_ref.id != constraint_ref.id
            )
            if correct_ref_exists:
                loading_errors.append(
                    LoadingError(
                        id=ids.constraint_dup_ref(constraint_ref.id, constraint_file.id),
                        severity="warning",
                        title="同一条规则被重复登记",
                        description=(
                            f"项目配置中，规则文件「{constraint_ref.path}」被登记了两次，"
                            f"其中一条的编号「{constraint_ref.id}」与文件中实际编号「{constraint_file.id}」不一致。"
                            "重复登记会导致这条规则加载冲突。"
                        ),
                        fix_hint="点击「一键去重」自动清理重复记录（推荐），或手动从项目配置中删除多余条目。",
                        error_type="IdMismatchWarning",
                        file_path="project.precis.yaml",
                        ref_id=constraint_ref.id,
                        message=msg,
                        suggestion="请更新项目配置中的引用编号，或修改文件内部的编号使其一致",
                        actions=default_actions_for_file("project.precis.yaml", constraint_ref.id),
                        title_key="inspection.issues.dupConstraintRef.title",
                        description_key="inspection.issues.dupConstraintRef.description",
                        fix_hint_key="inspection.issues.dupConstraintRef.fixHint",
                        message_params={
                            "manifestId": constraint_ref.id,
                            "fileId": constraint_file.id,
                            "filePath": constraint_ref.path,
                            "manifestDisplay": manifest_display,
                            "fileDisplay": file_display,
                        },
                        fix_api={
                            "method": "POST",
                            "path": "/project/manifest/constraint/deduplicate",
                        },
                    )
                )
            else:
                loading_errors.append(
                    build_id_mismatch_loading_error(
                        "constraint",
                        constraint_ref.id,
                        constraint_file.id,
                        constraint_ref.path,
                        manifest_display,
                        file_display,
                    )
                )

    for regex_ref in manifest.regex_nodes or []:
        regex_file = regex_node_files.get(regex_ref.id)
        if regex_file and regex_file.id != regex_ref.id:
            manifest_display = regex_display(regex_node_files.get(regex_ref.id))
            file_display = regex_display(regex_file)
            msg = (
                f"Regex ID 不一致: manifest 引用 ID '{regex_ref.id}' "
                f"与文件内部 id '{regex_file.id}' 不匹配 (文件: {regex_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                build_id_mismatch_loading_error(
                    "regex", regex_ref.id, regex_file.id, regex_ref.path, manifest_display, file_display
                )
            )

    for transform_ref in manifest.transforms or []:
        transform_file = transform_files.get(transform_ref.id)
        if transform_file and transform_file.id != transform_ref.id:
            manifest_display = transform_display(transform_files.get(transform_ref.id))
            file_display = transform_display(transform_file)
            msg = (
                f"Transform ID 不一致: manifest 引用 ID '{transform_ref.id}' "
                f"与文件内部 id '{transform_file.id}' 不匹配 (文件: {transform_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                build_id_mismatch_loading_error(
                    "transform", transform_ref.id, transform_file.id, transform_ref.path, manifest_display, file_display
                )
            )

    for manual_data_ref in manifest.manual_data or []:
        manual_data_file = manual_data_files.get(manual_data_ref.id)
        if manual_data_file and manual_data_file.id != manual_data_ref.id:
            manifest_display = manual_data_display(manual_data_files.get(manual_data_ref.id))
            file_display = manual_data_display(manual_data_file)
            msg = (
                f"ManualData ID 不一致: manifest 引用 ID '{manual_data_ref.id}' "
                f"与文件内部 id '{manual_data_file.id}' 不匹配 (文件: {manual_data_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                build_id_mismatch_loading_error(
                    "manual_data",
                    manual_data_ref.id,
                    manual_data_file.id,
                    manual_data_ref.path,
                    manifest_display,
                    file_display,
                )
            )
