"""引用完整性检查模块。

检查 constraint / regex 引用的表、列是否实际存在。
引用缺失会导致约束校验无法执行，或指向错误的数据。

包含：
- inspect_reference_integrity：检查约束引用的表/列
- _check_table_missing / _check_column_missing：表/列缺失的 LoadingError 构建
- inspect_regex_reference_integrity：检查正则节点引用的表/列

依赖：→ inspector_helpers（display + actions + columns）+ inspection_ids + LoadingError
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.shared.core.project.loader.loader_parts import inspection_ids as ids
from app.shared.core.project.loader.loader_parts.inspector_helpers import (
    actions_for_node_ref,
    collect_column_identifiers,
    is_machine_id,
    regex_display,
    schema_display,
)
from app.shared.core.project.loader.loader_parts.inspector_helpers import (
    constraint_display as _constraint_display_fn,
)
from app.shared.core.project.loader.types import LoadingError

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import TableSchemaFile


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
    schema_disp = schema_display(schema, fallback_id=table_id)
    msg = f"约束 '{constraint_id}' 引用的表 '{table_id}' 不存在"
    warnings.append(msg)
    loading_errors.append(
        LoadingError(
            id=ids.ref_table_missing(error_prefix, constraint_id, table_id),
            severity="blocker",
            title=f"规则要用的{role_label}表找不到了",
            description=(f"{constraint_display} 要用到{role_label}表「{table_id}」，但这张表可能已被删除或改名了。"),
            fix_hint="点选下方一张现有的表即可。",
            error_type="ReferenceIntegrityError",
            file_path="",
            ref_id=constraint_id,
            message=msg,
            suggestion=f"请检查约束关联的表是否正确，可用的表: {[s['id'] for s in available_schemas]}",
            actions=actions_for_node_ref(constraint_id),
            context={"available_schemas": available_schemas, "missing_table_id": table_id},
            title_key=title_key,
            description_key=description_key,
            fix_hint_key=fix_hint_key,
            message_params={
                "constraintId": constraint_id,
                "tableId": table_id,
                "tableName": getattr(schema, "name", "") or "",
                "constraintDisplay": constraint_display,
                "schemaDisplay": schema_disp,
                "tableIdIsMachine": is_machine_id(table_id),
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
            id=ids.ref_column_missing(error_prefix, constraint_id, table_id, col_id),
            severity="blocker",
            title=f"规则要用的{role_label}列找不到了",
            description=(
                f"{constraint_display} 要用到{role_label}表「{table_id}」的「{col_id}」列，但这一列已不存在了。"
            ),
            fix_hint="点选下方一个现有的列即可。",
            error_type="ReferenceIntegrityError",
            file_path="",
            ref_id=constraint_id,
            message=msg,
            suggestion=f"请检查列编号是否正确，表 '{table_id}' 的可用列: {available_cols}",
            actions=actions_for_node_ref(constraint_id),
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
                "tableName": getattr(schema, "name", "") or "",
                "columnId": col_id,
                "constraintDisplay": constraint_display,
                "schemaDisplay": schema_display(schema),
                "tableIdIsMachine": is_machine_id(table_id),
                "columnIdIsMachine": is_machine_id(col_id),
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
    for schema_id, schema_file in schema_files.items():
        schema_column_cache[schema_id] = collect_column_identifiers(schema_file.columns)

    available_schemas: list[dict] = [{"id": sid, "name": s.name} for sid, s in schema_files.items()]

    for constraint_id, constraint_file in constraint_files.items():
        refs = constraint_file.refs
        if not refs:
            continue

        table_id: str | None = None
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

            constraint_display = _constraint_display_fn(constraint_file)

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
            # Composite 有两层引用需要校验：
            # 1. 外层 refs.table_id —— 复合约束本身的目标表
            # 2. params.sub_constraints[] —— 每个子约束有自己的 type/refs
            table_id = refs.get("table_id")

            # 校验外层目标表（若指定）
            if table_id and table_id not in schema_files:
                constraint_display = _constraint_display_fn(constraint_file)
                _check_table_missing(
                    table_id,
                    constraint_id,
                    constraint_display,
                    schema_files,
                    available_schemas,
                    "composite_table_missing",
                    "inspection.issues.ref.tableMissing.title",
                    "inspection.issues.ref.tableMissing.description",
                    "inspection.issues.ref.tableMissing.fixHint",
                    loading_errors,
                    warnings,
                    "",
                )
            else:
                # 校验每个子约束的引用完整性（递归叶子检查）
                params = getattr(constraint_file, "params", None) or {}
                sub_configs = params.get("sub_constraints", []) if isinstance(params, dict) else []
                for idx, sub_cfg in enumerate(sub_configs):
                    if not isinstance(sub_cfg, dict):
                        continue
                    sub_refs = sub_cfg.get("refs", {}) or {}
                    sub_table_id = sub_refs.get("table_id")
                    # 子约束的目标表缺失
                    if sub_table_id and sub_table_id not in schema_files:
                        constraint_display = _constraint_display_fn(constraint_file)
                        _check_table_missing(
                            sub_table_id,
                            constraint_id,
                            constraint_display,
                            schema_files,
                            available_schemas,
                            f"composite_sub_table_missing:{idx}",
                            "inspection.issues.ref.tableMissing.title",
                            "inspection.issues.ref.tableMissing.description",
                            "inspection.issues.ref.tableMissing.fixHint",
                            loading_errors,
                            warnings,
                            f"（子规则 #{idx + 1}）",
                        )
                        continue
                    # 子约束的目标列缺失
                    if sub_table_id and sub_table_id in schema_column_cache:
                        sub_type = sub_cfg.get("type", "")
                        sub_cols: list[str] = []
                        if sub_type == "Unique":
                            cols = sub_refs.get("column_ids") or sub_refs.get("column_id")
                            if isinstance(cols, str):
                                cols = [cols]
                            if cols:
                                sub_cols.extend(cols)
                        elif sub_type == "ForeignKey":
                            for fk_col in (sub_refs.get("from_column_id"), sub_refs.get("to_column_id")):
                                if fk_col:
                                    sub_cols.append(fk_col)
                        else:
                            col = sub_refs.get("column_id")
                            if col:
                                sub_cols.append(col)
                            then_col = sub_refs.get("then_column_id")
                            if then_col:
                                sub_cols.append(then_col)

                        valid_columns = schema_column_cache[sub_table_id]
                        for col_id in sub_cols:
                            if col_id not in valid_columns:
                                constraint_display = _constraint_display_fn(constraint_file)
                                _check_column_missing(
                                    col_id,
                                    sub_table_id,
                                    constraint_id,
                                    constraint_display,
                                    schema_files,
                                    schema_column_cache,
                                    f"composite_sub_col_missing:{idx}",
                                    "inspection.issues.ref.colMissing.title",
                                    "inspection.issues.ref.colMissing.description",
                                    "inspection.issues.ref.colMissing.fixHint",
                                    loading_errors,
                                    warnings,
                                    f"（子规则 #{idx + 1}）",
                                )
            # Composite 已自行完成引用校验，跳过下方通用逻辑
            continue

        if table_id and table_id not in schema_files:
            constraint_display = _constraint_display_fn(constraint_file)
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
                    constraint_display = _constraint_display_fn(constraint_file)
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
        schema_column_cache[table_id] = collect_column_identifiers(schema_file.columns)

    available_schemas: list[dict] = [{"id": sid, "name": s.name} for sid, s in schema_files.items()]

    for regex_id, regex_file in regex_node_files.items():
        source_ref = getattr(regex_file, "source_ref", None)
        if not source_ref:
            continue

        table_id = source_ref.table_id
        column_id = source_ref.column_id

        if table_id and table_id not in schema_files:
            regex_disp = regex_display(regex_file)
            msg = f"正则节点 '{regex_id}' 引用的表 '{table_id}' 不存在"
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=ids.regex_table_missing(regex_id, table_id),
                    severity="blocker",
                    title="正则规则要用的表找不到了",
                    description=(
                        f"{regex_disp} 要用到 {schema_display(None, fallback_id=table_id)}，"
                        "但这张表可能已被删除或改名了。"
                    ),
                    fix_hint="点选下方一张现有的表即可。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion="请检查正则节点关联的表是否正确",
                    actions=actions_for_node_ref(regex_id),
                    context={"available_schemas": available_schemas, "missing_table_id": table_id},
                    title_key="inspection.issues.regex.tableMissing.title",
                    description_key="inspection.issues.regex.tableMissing.description",
                    fix_hint_key="inspection.issues.regex.tableMissing.fixHint",
                    message_params={
                        "regexId": regex_id,
                        "tableId": table_id,
                        "tableName": "",
                        "regexDisplay": regex_disp,
                        "tableIdIsMachine": is_machine_id(table_id),
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
            regex_disp = regex_display(regex_file)
            msg = f"正则节点 '{regex_id}' 引用的列 '{column_id}' 在表 '{table_id}' 中不存在"
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=ids.regex_column_missing(regex_id, table_id, column_id),
                    severity="blocker",
                    title="正则规则要用的列找不到了",
                    description=(
                        f"{regex_disp} 要用到 {schema_display(schema_files.get(table_id))}"
                        f"的「{column_id}」列，但这一列已不存在了。"
                    ),
                    fix_hint="点选下方一个现有的列即可。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion=f"请检查列编号是否正确，表 '{table_id}' 的可用列: {available_cols}",
                    actions=actions_for_node_ref(regex_id),
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
                        "tableName": getattr(schema_files.get(table_id), "name", "") or "",
                        "columnId": column_id,
                        "regexDisplay": regex_disp,
                        "tableIdIsMachine": is_machine_id(table_id),
                        "columnIdIsMachine": is_machine_id(column_id),
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
