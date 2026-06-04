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
2. 引用完整性: constraint 的 refs 指向是否有效（包括递归遍历 schema 嵌套子列）
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


def _collect_column_identifiers(columns: list[ColumnSpec]) -> set[str]:
    """递归收集 schema 中所有列的 id 和 name（包括嵌套子列）。

    JSON 等嵌套 schema 的列结构是树形的，父列的 children 中包含子列。
    引用完整性检查需要把整棵树的列都纳入候选集合，否则会误报
    "子列不存在"。
    """
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
    """为指向某个文件的错误生成通用动作列表（打开文件 / 复制 / 忽略）。

    每个动作同时携带 label（中文 fallback）和 label_key（前端 i18n 键）。
    """
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


def inspect_id_consistency(
    manifest: ProjectManifest,
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    regex_node_files: dict[str, RegexNodeFile],
    transform_files: dict[str, TransformFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """@methoddesc 检查 manifest 引用 ID 与文件内部 ID 的一致性。

    业务规则:
    - manifest 中引用的 id 应与文件内部的 id 字段一致
    - 不一致时记录警告（可能是文件被手动修改或 manifest 过期）

    检查逻辑:
    1. 遍历 manifest.schemas，对比 schema_files 中对应文件的 id
    2. 遍历 manifest.constraints，对比 constraint_files 中对应文件的 id
    3. 遍历 manifest.regex_nodes，对比 regex_node_files 中对应文件的 id

    Args:
        manifest: 项目清单对象
        schema_files: 已加载的 schema 文件字典 {manifest_id: TableSchemaFile}
        constraint_files: 已加载的约束文件字典 {manifest_id: ConstraintFile}
        regex_node_files: 已加载的正则文件字典 {manifest_id: RegexNodeFile}
        transform_files: 已加载的转换文件字典 {manifest_id: TransformFile}
        warnings: 警告列表（会被修改）
        loading_errors: 错误列表（会被修改）
    """
    # 检查 Schema ID 一致性
    for ref in manifest.schemas or []:
        schema_file = schema_files.get(ref.id)
        if schema_file and schema_file.id != ref.id:
            msg = (
                f"Schema ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{schema_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"id_mismatch_schema:{ref.id}:{schema_file.id}",
                    severity="warning",
                    title="表 ID 与项目清单对不上",
                    description=(
                        f"项目清单里登记的表 ID 是「{ref.id}」，"
                        f"但实际文件里的表 ID 是「{schema_file.id}」。"
                        "这可能会导致其他引用到这张表的地方失效。"
                    ),
                    fix_hint="把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。",
                    error_type="IdMismatchWarning",
                    file_path=ref.path,
                    ref_id=ref.id,
                    message=msg,
                    suggestion="请更新项目清单中的引用 ID 或修改文件内部的 id 字段使其一致",
                    actions=_default_actions_for_file(ref.path, ref.id),
                    title_key="inspection.issues.idMismatch.schema.title",
                    description_key="inspection.issues.idMismatch.schema.description",
                    fix_hint_key="inspection.issues.idMismatch.schema.fixHint",
                    message_params={
                        "manifestId": ref.id,
                        "fileId": schema_file.id,
                    },
                )
            )

    # 检查 Constraint ID 一致性
    for ref in manifest.constraints or []:
        constraint_file = constraint_files.get(ref.id)
        if constraint_file and constraint_file.id != ref.id:
            msg = (
                f"Constraint ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{constraint_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            # 检测是否同时存在指向同文件且 id 匹配的"正确"条目
            # → 这是 manifest 重复引用场景，给出针对性文案
            correct_ref_exists = any(
                other_ref.id == constraint_file.id
                for other_ref in (manifest.constraints or [])
                if other_ref.id != ref.id
            )
            if correct_ref_exists:
                title = "同一个约束被引用了多次"
                description = (
                    f"项目清单里同一个约束文件「{ref.path}」被列了两次，"
                    f"其中一条登记的 ID「{ref.id}」与文件里的实际 ID「{constraint_file.id}」对不上。"
                    "这会让这条规则被加载两次，可能产生冲突。"
                )
                fix_hint = '点击"一键去重"自动清理（推荐），或手动从项目清单里删掉多余的那一条。'
                title_key = "inspection.issues.dupConstraintRef.title"
                description_key = "inspection.issues.dupConstraintRef.description"
                fix_hint_key = "inspection.issues.dupConstraintRef.fixHint"
                actions = _default_actions_for_file("project.precis.yaml", ref.id)
                actions.insert(
                    0,
                    {
                        "type": "auto_fix",
                        "label": "一键去重",
                        "label_key": "inspection.actions.autoFix.deduplicate",
                        "fix_kind": "deduplicate_constraint_refs",
                    },
                )
                fix_api = {
                    "method": "POST",
                    "path": "/project/v2/manifest/constraint/deduplicate",
                }
            else:
                title = "约束 ID 与项目清单对不上"
                description = (
                    f"项目清单里登记的约束 ID 是「{ref.id}」，"
                    f"但实际文件里的约束 ID 是「{constraint_file.id}」。"
                    "这可能让这条规则无法被正确引用。"
                )
                fix_hint = "把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。"
                title_key = "inspection.issues.idMismatch.constraint.title"
                description_key = "inspection.issues.idMismatch.constraint.description"
                fix_hint_key = "inspection.issues.idMismatch.constraint.fixHint"
                actions = _default_actions_for_file(ref.path, ref.id)
                fix_api = None
            loading_errors.append(
                LoadingError(
                    id=f"id_mismatch_constraint:{ref.id}:{constraint_file.id}",
                    severity="warning",
                    title=title,
                    description=description,
                    fix_hint=fix_hint,
                    error_type="IdMismatchWarning",
                    file_path=ref.path,
                    ref_id=ref.id,
                    message=msg,
                    suggestion="请更新项目清单中的引用 ID 或修改文件内部的 id 字段使其一致",
                    actions=actions,
                    fix_api=fix_api,
                    title_key=title_key,
                    description_key=description_key,
                    fix_hint_key=fix_hint_key,
                    message_params={
                        "manifestId": ref.id,
                        "fileId": constraint_file.id,
                        "filePath": ref.path,
                    },
                )
            )

    # 检查 Regex ID 一致性
    for ref in manifest.regex_nodes or []:
        regex_file = regex_node_files.get(ref.id)
        if regex_file and regex_file.id != ref.id:
            msg = (
                f"Regex ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{regex_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"id_mismatch_regex:{ref.id}:{regex_file.id}",
                    severity="warning",
                    title="正则规则 ID 与项目清单对不上",
                    description=(
                        f"项目清单里登记的正则规则 ID 是「{ref.id}」，"
                        f"但实际文件里的 ID 是「{regex_file.id}」。"
                        "这可能让这条规则无法被正确引用。"
                    ),
                    fix_hint="把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。",
                    error_type="IdMismatchWarning",
                    file_path=ref.path,
                    ref_id=ref.id,
                    message=msg,
                    suggestion="请更新项目清单中的引用 ID 或修改文件内部的 id 字段使其一致",
                    actions=_default_actions_for_file(ref.path, ref.id),
                    title_key="inspection.issues.idMismatch.regex.title",
                    description_key="inspection.issues.idMismatch.regex.description",
                    fix_hint_key="inspection.issues.idMismatch.regex.fixHint",
                    message_params={
                        "manifestId": ref.id,
                        "fileId": regex_file.id,
                    },
                )
            )

    # 检查 Transform ID 一致性
    for ref in manifest.transforms or []:
        transform_file = transform_files.get(ref.id)
        if transform_file and transform_file.id != ref.id:
            msg = (
                f"Transform ID 不一致: manifest 引用 ID '{ref.id}' "
                f"与文件内部 id '{transform_file.id}' 不匹配 (文件: {ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"id_mismatch_transform:{ref.id}:{transform_file.id}",
                    severity="warning",
                    title="数据转换 ID 与项目清单对不上",
                    description=(
                        f"项目清单里登记的数据转换 ID 是「{ref.id}」，"
                        f"但实际文件里的 ID 是「{transform_file.id}」。"
                        "这可能让这个转换无法被正确引用。"
                    ),
                    fix_hint="把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。",
                    error_type="IdMismatchWarning",
                    file_path=ref.path,
                    ref_id=ref.id,
                    message=msg,
                    suggestion="请更新项目清单中的引用 ID 或修改文件内部的 id 字段使其一致",
                    actions=_default_actions_for_file(ref.path, ref.id),
                    title_key="inspection.issues.idMismatch.transform.title",
                    description_key="inspection.issues.idMismatch.transform.description",
                    fix_hint_key="inspection.issues.idMismatch.transform.fixHint",
                    message_params={
                        "manifestId": ref.id,
                        "fileId": transform_file.id,
                    },
                )
            )


def inspect_reference_integrity(
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """@methoddesc 检查约束引用的完整性。

    业务规则:
    - constraint.refs.table_id 必须指向 manifest 中存在的 schema
    - constraint.refs.column_id/column_ids 必须指向 schema 中存在的列
      （包括递归遍历的 JSON 嵌套子列）
    - 引用无效时记录错误

    检查逻辑:
    1. 遍历所有 constraint_files
    2. 根据约束类型提取 table_id 和 column_id/column_ids
    3. 检查 table_id 是否在 schema_files 中存在
    4. 检查 column_id 是否在对应 schema 的列集合中存在（递归）

    Args:
        schema_files: 已加载的 schema 文件字典 {id: TableSchemaFile}
        constraint_files: 已加载的约束文件字典 {id: ConstraintFile}
        warnings: 警告列表（会被修改）
        loading_errors: 错误列表（会被修改）
    """
    # 构建 schema 列集合的缓存 {table_id: {id_or_name 集合}}
    # 递归遍历 children 以支持 JSON 嵌套列（如 supplier.children 中的 supplier_rating）
    schema_column_cache: dict[str, set[str]] = {}
    for table_id, schema_file in schema_files.items():
        schema_column_cache[table_id] = _collect_column_identifiers(schema_file.columns)

    # 构建"可用的 schema"列表，用于 FK 悬挂错误时给出可选目标
    available_schemas: list[dict] = [{"id": sid, "name": s.name} for sid, s in schema_files.items()]

    for constraint_id, constraint_file in constraint_files.items():
        refs = constraint_file.refs
        if not refs:
            continue

        # 根据约束类型提取引用信息
        table_id = None
        column_ids_to_check: list[str] = []

        constraint_type = constraint_file.type

        if constraint_type in ("NotNull", "AllowedValues", "Range", "DateLogic", "Charset", "Scripted"):
            # 单表单列约束
            table_id = refs.get("table_id")
            col = refs.get("column_id")
            if col:
                column_ids_to_check.append(col)

        elif constraint_type == "Unique":
            # 单表多列约束
            table_id = refs.get("table_id")
            cols = refs.get("column_ids") or refs.get("column_id")
            if isinstance(cols, str):
                cols = [cols]
            if cols:
                column_ids_to_check.extend(cols)

        elif constraint_type == "ForeignKey":
            # 外键约束：检查 from_table/from_column 和 to_table/to_column
            from_table_id = refs.get("from_table_id")
            from_column_id = refs.get("from_column_id")
            to_table_id = refs.get("to_table_id")
            to_column_id = refs.get("to_column_id")

            # 检查 from 端
            if from_table_id:
                if from_table_id not in schema_files:
                    msg = f"约束 '{constraint_id}' 引用的源表 '{from_table_id}' 不存在"
                    warnings.append(msg)
                    loading_errors.append(
                        LoadingError(
                            id=f"fk_src_table_missing:{constraint_id}:{from_table_id}",
                            severity="blocker",
                            title="找不到外键来源的表",
                            description=(
                                f"外键规则「{constraint_id}」要从来源表「{from_table_id}」"
                                "取数据进行匹配，但这张表已不在项目里（可能被删除或重命名）。"
                            ),
                            fix_hint='从下方"项目中可用的表"挑一张作为来源表。',
                            error_type="ReferenceIntegrityError",
                            file_path="",
                            ref_id=constraint_id,
                            message=msg,
                            suggestion="请检查外键来源表是否正确",
                            actions=_default_actions_for_file("", constraint_id)
                            + [
                                {
                                    "type": "navigate",
                                    "label": "查看可用表",
                                    "label_key": "inspection.actions.viewAvailableTables",
                                    "target": "schemas",
                                }
                            ],
                            context={"available_schemas": available_schemas},
                            title_key="inspection.issues.fk.srcTableMissing.title",
                            description_key="inspection.issues.fk.srcTableMissing.description",
                            fix_hint_key="inspection.issues.fk.srcTableMissing.fixHint",
                            message_params={
                                "constraintId": constraint_id,
                                "tableId": from_table_id,
                            },
                        )
                    )
                elif from_column_id and from_column_id not in schema_column_cache.get(from_table_id, set()):
                    available_cols = sorted(schema_column_cache.get(from_table_id, set()))
                    msg = f"约束 '{constraint_id}' 引用的源列 '{from_column_id}' 在表 '{from_table_id}' 中不存在"
                    warnings.append(msg)
                    loading_errors.append(
                        LoadingError(
                            id=f"fk_src_col_missing:{constraint_id}:{from_table_id}:{from_column_id}",
                            severity="blocker",
                            title="找不到外键来源的列",
                            description=(
                                f"外键规则「{constraint_id}」要从来源表「{from_table_id}」"
                                f"的「{from_column_id}」列取数据，但这一列已不存在。"
                            ),
                            fix_hint='从下方"可用的列"挑一个作为来源列。',
                            error_type="ReferenceIntegrityError",
                            file_path="",
                            ref_id=constraint_id,
                            message=msg,
                            suggestion="请检查外键来源列是否正确",
                            actions=_default_actions_for_file("", constraint_id),
                            context={
                                "table_id": from_table_id,
                                "available_columns": available_cols,
                            },
                            title_key="inspection.issues.fk.srcColMissing.title",
                            description_key="inspection.issues.fk.srcColMissing.description",
                            fix_hint_key="inspection.issues.fk.srcColMissing.fixHint",
                            message_params={
                                "constraintId": constraint_id,
                                "tableId": from_table_id,
                                "columnId": from_column_id,
                            },
                        )
                    )

            # 检查 to 端（表不存在时跳过列检查，避免重复报告）
            if to_table_id:
                if to_table_id not in schema_files:
                    msg = f"约束 '{constraint_id}' 引用的目标表 '{to_table_id}' 不存在"
                    warnings.append(msg)
                    loading_errors.append(
                        LoadingError(
                            id=f"fk_dst_table_missing:{constraint_id}:{to_table_id}",
                            severity="blocker",
                            title="找不到外键关联的目标表",
                            description=(
                                f"外键规则「{constraint_id}」要关联到目标表「{to_table_id}」，"
                                "但这张表已不在项目里（可能被删除或重命名）。"
                            ),
                            fix_hint='从下方"项目中可用的表"挑一张作为目标表。',
                            error_type="ReferenceIntegrityError",
                            file_path="",
                            ref_id=constraint_id,
                            message=msg,
                            suggestion="请检查外键目标表是否正确",
                            actions=_default_actions_for_file("", constraint_id),
                            context={"available_schemas": available_schemas},
                            title_key="inspection.issues.fk.dstTableMissing.title",
                            description_key="inspection.issues.fk.dstTableMissing.description",
                            fix_hint_key="inspection.issues.fk.dstTableMissing.fixHint",
                            message_params={
                                "constraintId": constraint_id,
                                "tableId": to_table_id,
                            },
                        )
                    )
                elif to_column_id and to_column_id not in schema_column_cache.get(to_table_id, set()):
                    available_cols = sorted(schema_column_cache.get(to_table_id, set()))
                    msg = f"约束 '{constraint_id}' 引用的目标列 '{to_column_id}' 在表 '{to_table_id}' 中不存在"
                    warnings.append(msg)
                    loading_errors.append(
                        LoadingError(
                            id=f"fk_dst_col_missing:{constraint_id}:{to_table_id}:{to_column_id}",
                            severity="blocker",
                            title="找不到外键关联的列",
                            description=(
                                f"外键规则「{constraint_id}」要关联到目标表「{to_table_id}」"
                                f"的「{to_column_id}」列，但这一列已不存在。"
                            ),
                            fix_hint='从下方"可用的列"挑一个作为目标列。',
                            error_type="ReferenceIntegrityError",
                            file_path="",
                            ref_id=constraint_id,
                            message=msg,
                            suggestion="请检查外键目标列是否正确",
                            actions=_default_actions_for_file("", constraint_id),
                            context={
                                "table_id": to_table_id,
                                "available_columns": available_cols,
                            },
                            title_key="inspection.issues.fk.dstColMissing.title",
                            description_key="inspection.issues.fk.dstColMissing.description",
                            fix_hint_key="inspection.issues.fk.dstColMissing.fixHint",
                            message_params={
                                "constraintId": constraint_id,
                                "tableId": to_table_id,
                                "columnId": to_column_id,
                            },
                        )
                    )

            continue  # ForeignKey 已单独处理，跳过后续通用检查

        elif constraint_type == "Conditional":
            # 条件约束：检查 table_id、then_column_id、if_conditions 中的列
            table_id = refs.get("table_id")
            then_col = refs.get("then_column_id")
            if then_col:
                column_ids_to_check.append(then_col)
            # 检查 if_conditions 中的列
            if_conditions = refs.get("if_conditions") or []
            for cond in if_conditions:
                if isinstance(cond, dict):
                    if_col = cond.get("if_column_id")
                else:
                    if_col = getattr(cond, "if_column_id", None)
                if if_col:
                    column_ids_to_check.append(if_col)

        elif constraint_type == "Composite":
            # 组合约束：refs 结构可能不同，跳过深度检查
            continue

        # 通用检查：table_id 存在性
        if table_id and table_id not in schema_files:
            msg = f"约束 '{constraint_id}' 引用的表 '{table_id}' 不存在"
            warnings.append(msg)
            loading_errors.append(
                LoadingError(
                    id=f"ref_table_missing:{constraint_id}:{table_id}",
                    severity="blocker",
                    title="规则关联的表已不存在",
                    description=(
                        f"规则「{constraint_id}」要关联到表「{table_id}」，但这张表已不在项目里（可能被删除或重命名）。"
                    ),
                    fix_hint='从下方"项目中可用的表"挑一张作为关联的表。',
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=constraint_id,
                    message=msg,
                    suggestion=f"请检查约束关联的表是否正确，可用的表: {[s['id'] for s in available_schemas]}",
                    actions=_default_actions_for_file("", constraint_id),
                    context={"available_schemas": available_schemas},
                    title_key="inspection.issues.ref.tableMissing.title",
                    description_key="inspection.issues.ref.tableMissing.description",
                    fix_hint_key="inspection.issues.ref.tableMissing.fixHint",
                    message_params={
                        "constraintId": constraint_id,
                        "tableId": table_id,
                    },
                )
            )
            continue  # 表不存在，跳过列检查

        # 通用检查：column_id 存在性
        if table_id and table_id in schema_column_cache:
            valid_columns = schema_column_cache[table_id]
            for col_id in column_ids_to_check:
                if col_id not in valid_columns:
                    available_cols = sorted(valid_columns)
                    msg = f"约束 '{constraint_id}' 引用的列 '{col_id}' 在表 '{table_id}' 中不存在"
                    warnings.append(msg)
                    loading_errors.append(
                        LoadingError(
                            id=f"ref_col_missing:{constraint_id}:{table_id}:{col_id}",
                            severity="blocker",
                            title="规则关联的列已不存在",
                            description=(
                                f"规则「{constraint_id}」要关联到表「{table_id}」的「{col_id}」列，但这一列已不存在。"
                            ),
                            fix_hint='从下方"可用的列"挑一个作为关联的列。',
                            error_type="ReferenceIntegrityError",
                            file_path="",
                            ref_id=constraint_id,
                            message=msg,
                            suggestion=f"请检查列 ID 是否正确，表 '{table_id}' 的可用列: {available_cols}",
                            actions=_default_actions_for_file("", constraint_id),
                            context={
                                "table_id": table_id,
                                "available_columns": available_cols,
                            },
                            title_key="inspection.issues.ref.colMissing.title",
                            description_key="inspection.issues.ref.colMissing.description",
                            fix_hint_key="inspection.issues.ref.colMissing.fixHint",
                            message_params={
                                "constraintId": constraint_id,
                                "tableId": table_id,
                                "columnId": col_id,
                            },
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
    """@methoddesc 配置文件格式自检主入口。

    在项目加载完成后执行跨文件一致性检查，将发现的问题记录到
    warnings 和 loading_errors 中。

    检查流程:
    1. ID 跨文件一致性检查
    2. 引用完整性检查（嵌套列）

    Args:
        manifest_path: manifest 文件路径
        manifest: 项目清单对象
        schema_files: 已加载的 schema 文件字典
        constraint_files: 已加载的约束文件字典
        regex_node_files: 已加载的正则文件字典
        transform_files: 已加载的转换文件字典
        warnings: 警告列表（会被修改）
        loading_errors: 错误列表（会被修改）
    """
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

    # 检查 1: ID 跨文件一致性
    inspect_id_consistency(
        manifest, schema_files, constraint_files, regex_node_files, transform_files, warnings, loading_errors
    )

    # 检查 2: 引用完整性（包含嵌套列递归）
    inspect_reference_integrity(schema_files, constraint_files, warnings, loading_errors)

    errors_found = len(loading_errors) - errors_before
    warnings_found = len(warnings) - warnings_before

    if errors_found == 0 and warnings_found == 0:
        logger.info("[配置自检] 检查通过，未发现问题")
    else:
        logger.warning("[配置自检] 发现 %d 个问题", errors_found)
        for err in loading_errors[errors_before:]:
            logger.warning("[配置自检] [%s] %s", err.error_type, err.message)
