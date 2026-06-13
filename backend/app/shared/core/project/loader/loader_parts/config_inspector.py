"""
@fileoverview 配置文件格式自检模块

功能概述:
- 在项目加载完成后执行跨文件一致性检查
- 检测 ID 不匹配、引用缺失等问题
- 将检查结果记录到 warnings 和 loading_errors
- 输出面向 UI 的友好字段（title / severity / actions / fix_api 等）

架构设计:
- 纯函数设计: 所有检查函数无副作用，仅读取已加载的配置数据
- 错误收集: 所有问题收集后统一返回，不中断加载流程
- 分级处理: 错误(error)和警告(warning)分开记录

检查项:
1. ID 跨文件一致性: manifest 引用 ID 与文件内部 id 字段是否一致
2. 引用完整性: constraint/regex 的引用指向是否有效
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.project.loader.types import LoadingError

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.manifest.types import ProjectManifest
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
    from app.shared.core.project.transform.types import TransformFile


_CONSTRAINT_LABELS: dict[str, str] = {
    "NotNull": "非空",
    "Unique": "唯一",
    "AllowedValues": "允许值",
    "ForeignKey": "外键",
    "Conditional": "条件",
    "Scripted": "脚本",
    "Range": "区间",
    "Charset": "字符集",
    "DateLogic": "日期逻辑",
    "Composite": "组合",
}


def _schema_display(schema_file: TableSchemaFile | None, fallback_id: str = "") -> str:
    """生成数据表的友好显示名称。"""
    if schema_file is None:
        id_text = fallback_id or "未知"
        return f"数据表（编号 {id_text}）"
    name = getattr(schema_file, "name", None) or getattr(schema_file, "id", "")
    return f"数据表「{name}」"


def _constraint_display(cf: ConstraintFile | None) -> str:
    """生成约束规则的友好显示名称。"""
    if cf is None:
        return "未知规则"
    label = _CONSTRAINT_LABELS.get(getattr(cf, "type", ""), "规则")
    name = getattr(cf, "description", None) or ""
    refs = getattr(cf, "refs", None) or {}
    if not name:
        t = refs.get("table_id") or refs.get("from_table_id")
        c = refs.get("column_id") or refs.get("column_ids") or refs.get("from_column_id")
        if isinstance(c, list):
            c = c[0] if c else None
        if t and c:
            name = f"{t}.{c}"
    if not name:
        name = getattr(cf, "id", "")
    return f"{label}规则「{name}」"


def _regex_display(rf: RegexNodeFile | None) -> str:
    """生成正则规则的友好显示名称。"""
    if rf is None:
        return "未知正则规则"
    name = getattr(rf, "name", None) or getattr(rf, "id", "")
    return f"正则规则「{name}」"


def _transform_display(tf: TransformFile | None) -> str:
    """生成转换规则的友好显示名称。"""
    if tf is None:
        return "未知转换规则"
    name = getattr(tf, "name", None) or getattr(tf, "id", "")
    return f"转换规则「{name}」"


def _collect_column_identifiers(columns: list[ColumnSpec]) -> set[str]:
    """递归收集 schema 中所有列的 id 和 name（包括嵌套子列）。"""
    ids: set[str] = set()
    for c in columns or []:
        ids.add(c.id)
        ids.add(c.name)
        if c.children:
            ids |= _collect_column_identifiers(c.children)
    return ids


def _default_actions_for_file(
    file_path: str,
    ref_id: str | None = None,
    include_dismiss: bool = True,
) -> list[dict]:
    """为指向某个文件的错误生成通用动作列表。"""
    actions: list[dict] = []
    if file_path:
        actions.append(
            {
                "type": "open_file",
                "label": "打开文件",
                "label_key": "inspection.actions.openFile",
                "file_path": file_path,
            }
        )
        actions.append(
            {
                "type": "copy",
                "label": "复制文件路径",
                "label_key": "inspection.actions.copyFilePath",
                "text": file_path,
            }
        )
    if ref_id:
        actions.append(
            {
                "type": "copy",
                "label": "复制 ID",
                "label_key": "inspection.actions.copyId",
                "text": ref_id,
            }
        )
    if include_dismiss:
        actions.append(
            {
                "type": "dismiss",
                "label": "忽略",
                "label_key": "inspection.actions.dismiss",
            }
        )
    return actions


def _build_id_mismatch_loading_error(
    resource_type: str,
    manifest_id: str,
    file_id: str,
    file_path: str,
    manifest_display: str,
    file_display: str,
) -> LoadingError:
    """构建 ID 不一致类型的 LoadingError（通用）。"""
    return LoadingError(
        id=f"id_mismatch_{resource_type}:{manifest_id}:{file_id}",
        severity="warning",
        title="编号不一致",
        description=(
            f"项目配置中记录的（编号 {manifest_id}）"
            f"与文件中的记录（编号 {file_id}）不一致。"
            "编号不统一可能导致该资源无法正常生效。"
        ),
        fix_hint="请统一编号：建议以文件中的记录为准，更新项目配置中的编号。",
        error_type="IdMismatchWarning",
        file_path=file_path,
        ref_id=manifest_id,
        suggestion="请更新项目配置中的引用编号，或修改文件内部的编号使其一致",
        actions=_default_actions_for_file(file_path, manifest_id),
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
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """检查 manifest 引用 ID 与文件内部 ID 的一致性。"""
    for ref in manifest.schemas or []:
        schema_file = schema_files.get(ref.id)
        if schema_file and schema_file.id != ref.id:
            manifest_display = _schema_display(schema_files.get(ref.id))
            file_display = _schema_display(schema_file)
            msg = (
                f"Schema ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{schema_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "schema", ref.id, schema_file.id, ref.path, manifest_display, file_display
                )
            )

    for ref in manifest.constraints or []:
        constraint_file = constraint_files.get(ref.id)
        if constraint_file and constraint_file.id != ref.id:
            manifest_display = _constraint_display(constraint_files.get(ref.id))
            file_display = _constraint_display(constraint_file)
            msg = (
                f"Constraint ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{constraint_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            correct_ref_exists = any(
                other_ref.id == constraint_file.id
                for other_ref in (manifest.constraints or [])
                if other_ref.id != ref.id
            )
            if correct_ref_exists:
                loading_errors.append(
                    LoadingError(
                        id=f"id_mismatch_constraint:{ref.id}:{constraint_file.id}",
                        severity="warning",
                        title="同一条规则被重复登记",
                        description=(
                            f"项目配置中，规则文件「{ref.path}」被登记了两次，"
                            f"其中一条的编号「{ref.id}」与文件中实际编号「{constraint_file.id}」不一致。"
                            "重复登记会导致这条规则加载冲突。"
                        ),
                        fix_hint="点击「一键去重」自动清理重复记录（推荐），或手动从项目配置中删除多余条目。",
                        error_type="IdMismatchWarning",
                        file_path="project.precis.yaml",
                        ref_id=ref.id,
                        message=msg,
                        suggestion="请更新项目配置中的引用编号，或修改文件内部的编号使其一致",
                        actions=_default_actions_for_file("project.precis.yaml", ref.id),
                        title_key="inspection.issues.dupConstraintRef.title",
                        description_key="inspection.issues.dupConstraintRef.description",
                        fix_hint_key="inspection.issues.dupConstraintRef.fixHint",
                        message_params={
                            "manifestId": ref.id,
                            "fileId": constraint_file.id,
                            "filePath": ref.path,
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
                    _build_id_mismatch_loading_error(
                        "constraint", ref.id, constraint_file.id, ref.path, manifest_display, file_display
                    )
                )

    for ref in manifest.regex_nodes or []:
        regex_file = regex_node_files.get(ref.id)
        if regex_file and regex_file.id != ref.id:
            manifest_display = _regex_display(regex_node_files.get(ref.id))
            file_display = _regex_display(regex_file)
            msg = (
                f"Regex ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{regex_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "regex", ref.id, regex_file.id, ref.path, manifest_display, file_display
                )
            )

    for ref in manifest.transforms or []:
        transform_file = transform_files.get(ref.id)
        if transform_file and transform_file.id != ref.id:
            manifest_display = _transform_display(transform_files.get(ref.id))
            file_display = _transform_display(transform_file)
            msg = (
                f"Transform ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{transform_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "transform", ref.id, transform_file.id, ref.path, manifest_display, file_display
                )
            )


def _check_table_missing(
    table_id: str,
    constraint_id: str,
    constraint_display: str,
    schema_files: dict[str, TableSchemaFile],
    available_schemas: list[dict],
    error_prefix: str,
    title_key: str,
    description_key: str,
    fix_hint_key: str,
    loading_errors: list[LoadingError],
    warnings: list[str],
    role_label: str,
) -> None:
    """检查引用的表是否存在，不存在时生成 LoadingError。"""
    schema = schema_files.get(table_id)
    schema_display = _schema_display(schema, fallback_id=table_id)
    msg = f"约束 '{constraint_id}' 引用的表 '{table_id}' 不存在"
    warnings.append(msg)
    loading_errors.append(
        LoadingError(
            id=f"{error_prefix}:{constraint_id}:{table_id}",
            severity="blocker",
            title=f"规则引用的{role_label}数据表已不存在",
            description=(
                f"{constraint_display} {role_label}的 {_schema_display(schema, fallback_id=table_id)}"
                "已被删除或改名，当前无法找到。"
            ),
            fix_hint="请从下方列表中选择一张现有数据表进行关联，点击即可自动修正。",
            error_type="ReferenceIntegrityError",
            file_path="",
            ref_id=constraint_id,
            message=msg,
            suggestion=f"请检查约束关联的表是否正确，可用的表: {[s['id'] for s in available_schemas]}",
            actions=_default_actions_for_file("", constraint_id),
            context={"available_schemas": available_schemas, "missing_table_id": table_id},
            title_key=title_key,
            description_key=description_key,
            fix_hint_key=fix_hint_key,
            message_params={
                "constraintId": constraint_id,
                "tableId": table_id,
                "constraintDisplay": constraint_display,
                "schemaDisplay": schema_display,
            },
            fix_api={
                "method": "POST",
                "path": "/project/inspection/fix-table-ref",
                "body": {"constraint_id": constraint_id, "field": error_prefix.split(":")[0], "old_table_id": table_id},
            },
        )
    )


def _check_column_missing(
    col_id: str,
    table_id: str,
    constraint_id: str,
    constraint_display: str,
    schema_files: dict[str, TableSchemaFile],
    schema_column_cache: dict[str, set[str]],
    error_prefix: str,
    title_key: str,
    description_key: str,
    fix_hint_key: str,
    loading_errors: list[LoadingError],
    warnings: list[str],
    role_label: str,
) -> None:
    """检查引用的列是否存在，不存在时生成 LoadingError。"""
    schema = schema_files.get(table_id)
    available_cols = sorted(schema_column_cache.get(table_id, set()))
    msg = f"约束 '{constraint_id}' 引用的列 '{col_id}' 在表 '{table_id}' 中不存在"
    warnings.append(msg)
    loading_errors.append(
        LoadingError(
            id=f"{error_prefix}:{constraint_id}:{table_id}:{col_id}",
            severity="blocker",
            title=f"规则引用的{role_label}列已不存在",
            description=(
                f"{constraint_display} {role_label}到 {_schema_display(schema)}的「{col_id}」列，但该列已被删除或改名。"
            ),
            fix_hint="请从下方该表的可用列中选择一个进行关联，点击即可自动修正。",
            error_type="ReferenceIntegrityError",
            file_path="",
            ref_id=constraint_id,
            message=msg,
            suggestion=f"请检查列编号是否正确，表 '{table_id}' 的可用列: {available_cols}",
            actions=_default_actions_for_file("", constraint_id),
            context={
                "table_id": table_id,
                "available_columns": available_cols,
                "missing_column_id": col_id,
            },
            title_key=title_key,
            description_key=description_key,
            fix_hint_key=fix_hint_key,
            message_params={
                "constraintId": constraint_id,
                "tableId": table_id,
                "columnId": col_id,
                "constraintDisplay": constraint_display,
                "schemaDisplay": _schema_display(schema),
            },
            fix_api={
                "method": "POST",
                "path": "/project/inspection/fix-column-ref",
                "body": {
                    "constraint_id": constraint_id,
                    "field": error_prefix.split(":")[0],
                    "table_id": table_id,
                    "old_column_id": col_id,
                },
            },
        )
    )


def inspect_reference_integrity(
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """检查约束引用的完整性。"""
    schema_column_cache: dict[str, set[str]] = {}
    for table_id, schema_file in schema_files.items():
        schema_column_cache[table_id] = _collect_column_identifiers(schema_file.columns)

    available_schemas: list[dict] = [{"id": sid, "name": s.name} for sid, s in schema_files.items()]

    for constraint_id, constraint_file in constraint_files.items():
        refs = constraint_file.refs
        if not refs:
            continue

        table_id = None
        column_ids_to_check: list[str] = []

        constraint_type = constraint_file.type

        if constraint_type in ("NotNull", "AllowedValues", "Range", "DateLogic", "Charset", "Scripted"):
            table_id = refs.get("table_id")
            col = refs.get("column_id")
            if col:
                column_ids_to_check.append(col)

        elif constraint_type == "Unique":
            table_id = refs.get("table_id")
            cols = refs.get("column_ids") or refs.get("column_id")
            if isinstance(cols, str):
                cols = [cols]
            if cols:
                column_ids_to_check.extend(cols)

        elif constraint_type == "ForeignKey":
            from_table_id = refs.get("from_table_id")
            from_column_id = refs.get("from_column_id")
            to_table_id = refs.get("to_table_id")
            to_column_id = refs.get("to_column_id")

            constraint_display = _constraint_display(constraint_file)

            if from_table_id:
                if from_table_id not in schema_files:
                    _check_table_missing(
                        from_table_id,
                        constraint_id,
                        constraint_display,
                        schema_files,
                        available_schemas,
                        "fk_src_table_missing",
                        "inspection.issues.fk.srcTableMissing.title",
                        "inspection.issues.fk.srcTableMissing.description",
                        "inspection.issues.fk.srcTableMissing.fixHint",
                        loading_errors,
                        warnings,
                        "数据来源",
                    )
                elif from_column_id and from_column_id not in schema_column_cache.get(from_table_id, set()):
                    _check_column_missing(
                        from_column_id,
                        from_table_id,
                        constraint_id,
                        constraint_display,
                        schema_files,
                        schema_column_cache,
                        "fk_src_col_missing",
                        "inspection.issues.fk.srcColMissing.title",
                        "inspection.issues.fk.srcColMissing.description",
                        "inspection.issues.fk.srcColMissing.fixHint",
                        loading_errors,
                        warnings,
                        "数据来源",
                    )

            if to_table_id:
                if to_table_id not in schema_files:
                    _check_table_missing(
                        to_table_id,
                        constraint_id,
                        constraint_display,
                        schema_files,
                        available_schemas,
                        "fk_dst_table_missing",
                        "inspection.issues.fk.dstTableMissing.title",
                        "inspection.issues.fk.dstTableMissing.description",
                        "inspection.issues.fk.dstTableMissing.fixHint",
                        loading_errors,
                        warnings,
                        "关联目标",
                    )
                elif to_column_id and to_column_id not in schema_column_cache.get(to_table_id, set()):
                    _check_column_missing(
                        to_column_id,
                        to_table_id,
                        constraint_id,
                        constraint_display,
                        schema_files,
                        schema_column_cache,
                        "fk_dst_col_missing",
                        "inspection.issues.fk.dstColMissing.title",
                        "inspection.issues.fk.dstColMissing.description",
                        "inspection.issues.fk.dstColMissing.fixHint",
                        loading_errors,
                        warnings,
                        "关联目标",
                    )

            continue

        elif constraint_type == "Conditional":
            table_id = refs.get("table_id")
            then_col = refs.get("then_column_id")
            if then_col:
                column_ids_to_check.append(then_col)
            if_conditions = refs.get("if_conditions") or []
            for cond in if_conditions:
                if isinstance(cond, dict):
                    if_col = cond.get("if_column_id")
                else:
                    if_col = getattr(cond, "if_column_id", None)
                if if_col:
                    column_ids_to_check.append(if_col)

        elif constraint_type == "Composite":
            continue

        if table_id and table_id not in schema_files:
            constraint_display = _constraint_display(constraint_file)
            _check_table_missing(
                table_id,
                constraint_id,
                constraint_display,
                schema_files,
                available_schemas,
                "ref_table_missing",
                "inspection.issues.ref.tableMissing.title",
                "inspection.issues.ref.tableMissing.description",
                "inspection.issues.ref.tableMissing.fixHint",
                loading_errors,
                warnings,
                "",
            )
            continue

        if table_id and table_id in schema_column_cache:
            valid_columns = schema_column_cache[table_id]
            for col_id in column_ids_to_check:
                if col_id not in valid_columns:
                    constraint_display = _constraint_display(constraint_file)
                    _check_column_missing(
                        col_id,
                        table_id,
                        constraint_id,
                        constraint_display,
                        schema_files,
                        schema_column_cache,
                        "ref_col_missing",
                        "inspection.issues.ref.colMissing.title",
                        "inspection.issues.ref.colMissing.description",
                        "inspection.issues.ref.colMissing.fixHint",
                        loading_errors,
                        warnings,
                        "",
                    )


def inspect_regex_reference_integrity(
    regex_node_files: dict[str, RegexNodeFile],
    schema_files: dict[str, TableSchemaFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """检查正则节点的 source_ref 引用完整性。"""
    schema_column_cache: dict[str, set[str]] = {}
    for table_id, schema_file in schema_files.items():
        schema_column_cache[table_id] = _collect_column_identifiers(schema_file.columns)

    available_schemas: list[dict] = [{"id": sid, "name": s.name} for sid, s in schema_files.items()]

    for regex_id, regex_file in regex_node_files.items():
        source_ref = getattr(regex_file, "source_ref", None)
        if not source_ref:
            continue

        table_id = source_ref.table_id
        column_id = source_ref.column_id

        if table_id and table_id not in schema_files:
            regex_display = _regex_display(regex_file)
            msg = f"正则节点 '{regex_id}' 引用的表 '{table_id}' 不存在"
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"regex_table_missing:{regex_id}:{table_id}",
                    severity="blocker",
                    title="正则规则引用的数据表已不存在",
                    description=(
                        f"{regex_display} 引用的 {_schema_display(None, fallback_id=table_id)}"
                        "已被删除或改名，当前无法找到。"
                    ),
                    fix_hint="请从下方列表中选择一张现有数据表进行关联，点击即可自动修正。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion="请检查正则节点关联的表是否正确",
                    actions=_default_actions_for_file("", regex_id),
                    context={"available_schemas": available_schemas, "missing_table_id": table_id},
                    title_key="inspection.issues.regex.tableMissing.title",
                    description_key="inspection.issues.regex.tableMissing.description",
                    fix_hint_key="inspection.issues.regex.tableMissing.fixHint",
                    message_params={
                        "regexId": regex_id,
                        "tableId": table_id,
                        "regexDisplay": regex_display,
                    },
                    fix_api={
                        "method": "POST",
                        "path": "/project/inspection/fix-regex-table-ref",
                        "body": {"regex_id": regex_id, "old_table_id": table_id},
                    },
                )
            )
            continue

        if table_id and column_id and column_id not in schema_column_cache.get(table_id, set()):
            available_cols = sorted(schema_column_cache.get(table_id, set()))
            regex_display = _regex_display(regex_file)
            msg = f"正则节点 '{regex_id}' 引用的列 '{column_id}' 在表 '{table_id}' 中不存在"
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"regex_col_missing:{regex_id}:{table_id}:{column_id}",
                    severity="blocker",
                    title="正则规则引用的列已不存在",
                    description=(
                        f"{regex_display} 引用到 {_schema_display(schema_files.get(table_id))}"
                        f"的「{column_id}」列，但该列已被删除或改名。"
                    ),
                    fix_hint="请从下方该表的可用列中选择一个进行关联，点击即可自动修正。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion=f"请检查列编号是否正确，表 '{table_id}' 的可用列: {available_cols}",
                    actions=_default_actions_for_file("", regex_id),
                    context={
                        "table_id": table_id,
                        "available_columns": available_cols,
                        "missing_column_id": column_id,
                    },
                    title_key="inspection.issues.regex.colMissing.title",
                    description_key="inspection.issues.regex.colMissing.description",
                    fix_hint_key="inspection.issues.regex.colMissing.fixHint",
                    message_params={
                        "regexId": regex_id,
                        "tableId": table_id,
                        "columnId": column_id,
                        "regexDisplay": regex_display,
                    },
                    fix_api={
                        "method": "POST",
                        "path": "/project/inspection/fix-regex-column-ref",
                        "body": {
                            "regex_id": regex_id,
                            "table_id": table_id,
                            "old_column_id": column_id,
                        },
                    },
                )
            )


def inspect_schema_id_global_uniqueness(
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError],
) -> None:
    """检测多个 schema 文件使用了同一个 ID（blocker）。

    遍历所有 schema_files，构建 id → [table_ids] 索引。
    如果同一 schema id 出现在多个条目中，记录 blocker 级错误。
    """
    id_counts: dict[str, int] = {}
    for sid, sdoc in schema_files.items():
        file_internal_id = getattr(sdoc, "id", None) or sid
        id_counts[file_internal_id] = id_counts.get(file_internal_id, 0) + 1

    for sid, count in id_counts.items():
        if count > 1:
            loading_errors.append(
                LoadingError(
                    id=f"schema_id_duplicate:{sid}",
                    severity="blocker",
                    title=f"Schema ID 重复: {sid}",
                    description=f"Schema ID '{sid}' 被 {count} 个 schema 配置使用，可能导致约束引用指向错误的表。请确保每个 schema ID 唯一。",
                    fix_hint=f"请为重复的 schema 重新命名 ID（当前: {sid}），使其在项目内唯一。",
                    error_type="SchemaIdDuplicate",
                    file_path="",
                    ref_id=sid,
                    suggestion="修改其中一个 schema 文件的 id 字段，使其与其他 schema 不同",
                    actions=[],
                )
            )


def inspect_source_uniqueness(
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError],
) -> None:
    """检测两个 schema 指向同一数据源（blocker）。

    遍历所有 schema 的 source.path + source.sheet，标准化后构建索引。
    如果同一 source 被多个 schema 引用，记录 blocker 级错误。
    """
    from app.shared.core.project.schema.types_parts.schema_id import normalize_source_key

    source_map: dict[tuple[str, str | None], list[str]] = {}
    for sid, sdoc in schema_files.items():
        source = getattr(sdoc, "source", None)
        if source is None:
            continue
        path = getattr(source, "path", None) or ""
        sheet = getattr(source, "sheet", None)
        if not path:
            continue
        key = normalize_source_key(path, sheet)
        source_map.setdefault(key, []).append(sid)

    for key, sids in source_map.items():
        if len(sids) > 1:
            path_str, sheet_str = key
            source_display = f"{path_str}"
            if sheet_str:
                source_display += f" ({sheet_str})"
            loading_errors.append(
                LoadingError(
                    id=f"schema_source_duplicate:{path_str}:{sheet_str}",
                    severity="blocker",
                    title=f"数据源重复: {source_display}",
                    description=f"数据源 '{source_display}' 被 {len(sids)} 个 schema 引用: {', '.join(sids)}。每个数据源只能被一个 schema 定义。请删除重复的 schema 或修改其 source.path。",
                    fix_hint=f"请保留其中一个 schema（如 {sids[0]}），删除或修改其他的。",
                    error_type="SchemaSourceDuplicate",
                    file_path="",
                    ref_id=sids[0],
                    suggestion=f"保留 schema '{sids[0]}'，删除或修改: {', '.join(sids[1:])}",
                    actions=[],
                )
            )


def inspect_config(
    manifest_path: Path,
    manifest: ProjectManifest,
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    regex_node_files: dict[str, RegexNodeFile],
    transform_files: dict[str, TransformFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """配置文件格式自检主入口。"""
    logger.info("[配置自检] 开始检查项目配置: %s", manifest_path.parent.name)
    logger.info(
        "[配置自检] 检查范围: %d schemas, %d constraints, %d regex, %d transforms",
        len(schema_files),
        len(constraint_files),
        len(regex_node_files),
        len(transform_files),
    )

    errors_before = len(loading_errors)
    warnings_before = len(warnings)

    inspect_id_consistency(
        manifest, schema_files, constraint_files, regex_node_files, transform_files, warnings, loading_errors
    )

    inspect_schema_id_global_uniqueness(schema_files, loading_errors)

    inspect_source_uniqueness(schema_files, loading_errors)

    inspect_reference_integrity(schema_files, constraint_files, warnings, loading_errors)

    inspect_regex_reference_integrity(regex_node_files, schema_files, warnings, loading_errors)

    errors_found = len(loading_errors) - errors_before
    warnings_found = len(warnings) - warnings_before

    if errors_found == 0 and warnings_found == 0:
        logger.info("[配置自检] 检查通过，未发现问题")
    else:
        logger.warning("[配置自检] 发现 %d 个问题", errors_found)
        for err in loading_errors[errors_before:]:
            logger.warning("[配置自检] [%s] %s", err.error_type, err.message)
