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
import re
from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.project.loader.loader_parts import inspection_ids as ids
from app.shared.core.project.loader.types import LoadingError

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.manifest.types import ProjectManifest
    from app.shared.core.project.manual_data.types import ManualDataFile
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
    from app.shared.core.project.transform.types import TransformFile


_UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _is_machine_id(value: str) -> bool:
    """判断一个 id 是否为机器生成的不可读标识（UUID 或冗长编码）。

    这类 id 直接拼进面向用户的文案会变成噪音，应由 _friendly_id 转为中性占位。
    """
    if not value:
        return False
    # 标准 UUID
    if _UUID_PATTERN.match(value):
        return True
    # 较长的 base64url / 编码串（schema id 常见形态，如 sc_ 后接 22 位编码）
    stripped = value.split("_", 1)[-1] if value.startswith(("sc_", "c_", "r_", "t_")) else value
    if len(stripped) >= 20 and re.fullmatch(r"[A-Za-z0-9_\-]+", stripped):
        return True
    return False


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
        return f"数据表「{id_text}」"
    name = getattr(schema_file, "name", None) or getattr(schema_file, "id", "")
    return f"数据表「{name}」"


_PLACEHOLDER_NAMES = {
    "新建",
    "未命名",
    "新建规则",
    "新规则",
    "约束",
    "规则",
    "脚本约束",
    "新建脚本约束",
    "未命名约束",
    "新建正则",
    "正则",
    "constraint",
    "rule",
    "new rule",
}
# 形如"新建XXX规则/约束/正则"这类类型词堆叠、无实质内容的占位值
_PLACEHOLDER_PATTERN = re.compile(r"(新建|未命名|新的?|新增)[\w\u4e00-\u9fa5]*(规则|约束|正则)?")


def _is_meaningful_name(name: str | None) -> bool:
    """判断 description/name 是否对用户有定位价值。

    项目里约束的 description 常被填成"新建脚本约束""未命名规则"这类占位值，
    把它们当"规则名"展示反而误导用户、无法定位。
    """
    if not name:
        return False
    text = name.strip()
    if len(text) < 2:
        return False
    if text.lower() in _PLACEHOLDER_NAMES:
        return False
    if _PLACEHOLDER_PATTERN.fullmatch(text):
        return False
    return True


def _constraint_display(cf: ConstraintFile | None) -> str:
    """生成约束规则的友好显示名称。

    优先用有信息量的 description；若 description 是占位垃圾值（如"新建脚本约束"），
    则不展示名字，只给类型标签（如"脚本规则"），避免误导。
    """
    if cf is None:
        return "未知规则"
    label = _CONSTRAINT_LABELS.get(getattr(cf, "type", ""), "规则")
    desc = getattr(cf, "description", None)
    # 仅当 description 有信息量时才展示名字；否则只给类型标签（如"脚本规则"），
    # 避免用 UUID / 占位值凑名字误导用户。定位交给 navigate 动作。
    if _is_meaningful_name(desc):
        return f"{label}规则「{desc}」"
    return f"{label}规则"


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


def _manual_data_display(mdf: ManualDataFile | None) -> str:
    """生成 ManualData 节点的友好显示名称。"""
    if mdf is None:
        return "未知 ManualData 节点"
    name = getattr(mdf, "column_name", None) or getattr(mdf, "id", "")
    return f"ManualData 节点「{name}」"


def _collect_column_identifiers(columns: list[ColumnSpec]) -> set[str]:
    """递归收集 schema 中所有列的 id 和 name（包括嵌套子列）。"""
    ids: set[str] = set()
    for c in columns or []:
        if c.id is not None:
            ids.add(c.id)
        if c.name is not None:
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


def _actions_for_node_ref(node_id: str | None) -> list[dict]:
    """为指向画布节点（约束/正则等）的问题生成动作列表。

    核心是提供 navigate（定位到画布节点），让用户能直接跳转到出问题的规则，
    解决"不知道是哪条约束"的定位难题。辅以复制 ID 和忽略。
    """
    actions: list[dict] = []
    if node_id:
        actions.append(
            {
                "type": "navigate",
                "label": "定位到节点",
                "label_key": "inspection.actions.navigateToNode",
                "target": node_id,
            }
        )
        actions.append(
            {
                "type": "copy",
                "label": "复制 ID",
                "label_key": "inspection.actions.copyId",
                "text": node_id,
            }
        )
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
    manual_data_files: dict[str, ManualDataFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """检查 manifest 引用 ID 与文件内部 ID 的一致性。"""
    for schema_ref in manifest.schemas or []:
        schema_file = schema_files.get(schema_ref.id)
        if schema_file and schema_file.id != schema_ref.id:
            manifest_display = _schema_display(schema_files.get(schema_ref.id))
            file_display = _schema_display(schema_file)
            msg = (
                f"Schema ID 不一致: manifest 引用 ID '{schema_ref.id}' "
                f"与文件内部 id '{schema_file.id}' 不匹配 (文件: {schema_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "schema", schema_ref.id, schema_file.id, schema_ref.path, manifest_display, file_display
                )
            )

    for constraint_ref in manifest.constraints or []:
        constraint_file = constraint_files.get(constraint_ref.id)
        if constraint_file and constraint_file.id != constraint_ref.id:
            manifest_display = _constraint_display(constraint_files.get(constraint_ref.id))
            file_display = _constraint_display(constraint_file)
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
                        actions=_default_actions_for_file("project.precis.yaml", constraint_ref.id),
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
                    _build_id_mismatch_loading_error(
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
            manifest_display = _regex_display(regex_node_files.get(regex_ref.id))
            file_display = _regex_display(regex_file)
            msg = (
                f"Regex ID 不一致: manifest 引用 ID '{regex_ref.id}' "
                f"与文件内部 id '{regex_file.id}' 不匹配 (文件: {regex_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "regex", regex_ref.id, regex_file.id, regex_ref.path, manifest_display, file_display
                )
            )

    for transform_ref in manifest.transforms or []:
        transform_file = transform_files.get(transform_ref.id)
        if transform_file and transform_file.id != transform_ref.id:
            manifest_display = _transform_display(transform_files.get(transform_ref.id))
            file_display = _transform_display(transform_file)
            msg = (
                f"Transform ID 不一致: manifest 引用 ID '{transform_ref.id}' "
                f"与文件内部 id '{transform_file.id}' 不匹配 (文件: {transform_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "transform", transform_ref.id, transform_file.id, transform_ref.path, manifest_display, file_display
                )
            )

    for manual_data_ref in manifest.manual_data or []:
        manual_data_file = manual_data_files.get(manual_data_ref.id)
        if manual_data_file and manual_data_file.id != manual_data_ref.id:
            manifest_display = _manual_data_display(manual_data_files.get(manual_data_ref.id))
            file_display = _manual_data_display(manual_data_file)
            msg = (
                f"ManualData ID 不一致: manifest 引用 ID '{manual_data_ref.id}' "
                f"与文件内部 id '{manual_data_file.id}' 不匹配 (文件: {manual_data_ref.path})"
            )
            warnings.append(msg)
            loading_errors.append(
                _build_id_mismatch_loading_error(
                    "manual_data",
                    manual_data_ref.id,
                    manual_data_file.id,
                    manual_data_ref.path,
                    manifest_display,
                    file_display,
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
            actions=_actions_for_node_ref(constraint_id),
            context={"available_schemas": available_schemas, "missing_table_id": table_id},
            title_key=title_key,
            description_key=description_key,
            fix_hint_key=fix_hint_key,
            message_params={
                "constraintId": constraint_id,
                "tableId": table_id,
                "tableName": getattr(schema, "name", "") or "",
                "constraintDisplay": constraint_display,
                "schemaDisplay": schema_display,
                "tableIdIsMachine": _is_machine_id(table_id),
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
            actions=_actions_for_node_ref(constraint_id),
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
                "schemaDisplay": _schema_display(schema),
                "tableIdIsMachine": _is_machine_id(table_id),
                "columnIdIsMachine": _is_machine_id(col_id),
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
        schema_column_cache[schema_id] = _collect_column_identifiers(schema_file.columns)

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
            # Composite 有两层引用需要校验：
            # 1. 外层 refs.table_id —— 复合约束本身的目标表
            # 2. params.sub_constraints[] —— 每个子约束有自己的 type/refs
            # 子约束禁止嵌套 Composite（由 factory 保证），故此处只处理叶子类型。
            table_id = refs.get("table_id")

            # 校验外层目标表（若指定）
            if table_id and table_id not in schema_files:
                constraint_display = _constraint_display(constraint_file)
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
                        constraint_display = _constraint_display(constraint_file)
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
                        # 复用主循环的列提取规则
                        if sub_type == "Unique":
                            cols = sub_refs.get("column_ids") or sub_refs.get("column_id")
                            if isinstance(cols, str):
                                cols = [cols]
                            if cols:
                                sub_cols.extend(cols)
                        elif sub_type == "ForeignKey":
                            # FK 的列单独处理
                            for fk_col in (sub_refs.get("from_column_id"), sub_refs.get("to_column_id")):
                                if fk_col:
                                    sub_cols.append(fk_col)
                        else:
                            col = sub_refs.get("column_id")
                            if col:
                                sub_cols.append(col)
                            # Conditional 的 then_column_id / if_column_id
                            then_col = sub_refs.get("then_column_id")
                            if then_col:
                                sub_cols.append(then_col)

                        valid_columns = schema_column_cache[sub_table_id]
                        for col_id in sub_cols:
                            if col_id not in valid_columns:
                                constraint_display = _constraint_display(constraint_file)
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
                    id=ids.regex_table_missing(regex_id, table_id),
                    severity="blocker",
                    title="正则规则要用的表找不到了",
                    description=(
                        f"{regex_display} 要用到 {_schema_display(None, fallback_id=table_id)}，"
                        "但这张表可能已被删除或改名了。"
                    ),
                    fix_hint="点选下方一张现有的表即可。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion="请检查正则节点关联的表是否正确",
                    actions=_actions_for_node_ref(regex_id),
                    context={"available_schemas": available_schemas, "missing_table_id": table_id},
                    title_key="inspection.issues.regex.tableMissing.title",
                    description_key="inspection.issues.regex.tableMissing.description",
                    fix_hint_key="inspection.issues.regex.tableMissing.fixHint",
                    message_params={
                        "regexId": regex_id,
                        "tableId": table_id,
                        "tableName": "",
                        "regexDisplay": regex_display,
                        "tableIdIsMachine": _is_machine_id(table_id),
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
                    id=ids.regex_column_missing(regex_id, table_id, column_id),
                    severity="blocker",
                    title="正则规则要用的列找不到了",
                    description=(
                        f"{regex_display} 要用到 {_schema_display(schema_files.get(table_id))}"
                        f"的「{column_id}」列，但这一列已不存在了。"
                    ),
                    fix_hint="点选下方一个现有的列即可。",
                    error_type="ReferenceIntegrityError",
                    file_path="",
                    ref_id=regex_id,
                    message=msg,
                    suggestion=f"请检查列编号是否正确，表 '{table_id}' 的可用列: {available_cols}",
                    actions=_actions_for_node_ref(regex_id),
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
                        "regexDisplay": regex_display,
                        "tableIdIsMachine": _is_machine_id(table_id),
                        "columnIdIsMachine": _is_machine_id(column_id),
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
    # 先构建 id → 重复条目的 manifest ref key 列表，便于 navigate 定位
    id_to_refs: dict[str, list[str]] = {}
    for sid, sdoc in schema_files.items():
        file_internal_id = getattr(sdoc, "id", None) or sid
        id_to_refs.setdefault(file_internal_id, []).append(sid)

    for sid, ref_keys in id_to_refs.items():
        count = len(ref_keys)
        if count > 1:
            primary_ref = ref_keys[0]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_id_duplicate(sid),
                    severity="blocker",
                    title=f"有表重名了：{sid}",
                    description=f"Schema ID '{sid}' 被 {count} 个 schema 配置使用，可能导致约束引用指向错误的表。请确保每个 schema ID 唯一。",
                    fix_hint=f"请为重复的 schema 重新命名 ID（当前: {sid}），使其在项目内唯一。",
                    error_type="SchemaIdDuplicate",
                    file_path="",
                    ref_id=sid,
                    message="",
                    suggestion="修改其中一个 schema 文件的 id 字段，使其与其他 schema 不同",
                    actions=[
                        # 导航到画布中第一个重复 schema 节点，便于用户定位修改
                        {
                            "type": "navigate",
                            "label": "定位到节点",
                            "label_key": "inspection.actions.navigateToNode",
                            "target": primary_ref,
                        },
                        # 复制重复 ID，便于排查
                        {
                            "type": "copy",
                            "label": "复制 ID",
                            "label_key": "inspection.actions.copyId",
                            "text": sid,
                        },
                        # 允许忽略（此类问题需用户手动决策保留哪个，无法自动修复）
                        {
                            "type": "dismiss",
                            "label": "忽略",
                            "label_key": "inspection.actions.dismiss",
                        },
                    ],
                    title_key="inspection.issues.schemaIdDuplicate.title",
                    description_key="inspection.issues.schemaIdDuplicate.description",
                    fix_hint_key="inspection.issues.schemaIdDuplicate.fixHint",
                    message_params={"schemaId": sid, "count": count},
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
            primary_ref = sids[0]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_source_duplicate(path_str, sheet_str),
                    severity="blocker",
                    title=f"有表指向了同一个数据文件：{source_display}",
                    description=f"数据源 '{source_display}' 被 {len(sids)} 个 schema 引用: {', '.join(sids)}。每个数据源只能被一个 schema 定义。请删除重复的 schema 或修改其 source.path。",
                    fix_hint=f"请保留其中一个 schema（如 {sids[0]}），删除或修改其他的。",
                    error_type="SchemaSourceDuplicate",
                    file_path="",
                    ref_id=primary_ref,
                    message="",
                    suggestion=f"保留 schema '{sids[0]}'，删除或修改: {', '.join(sids[1:])}",
                    actions=[
                        # 导航到第一个重复 schema 节点
                        {
                            "type": "navigate",
                            "label": "定位到节点",
                            "label_key": "inspection.actions.navigateToNode",
                            "target": primary_ref,
                        },
                        # 复制数据源路径，便于排查
                        {
                            "type": "copy",
                            "label": "复制数据源",
                            "label_key": "inspection.actions.copyFilePath",
                            "text": source_display,
                        },
                        # 允许忽略（需用户手动决策保留哪个 schema）
                        {
                            "type": "dismiss",
                            "label": "忽略",
                            "label_key": "inspection.actions.dismiss",
                        },
                    ],
                    title_key="inspection.issues.sourceDuplicate.title",
                    description_key="inspection.issues.sourceDuplicate.description",
                    fix_hint_key="inspection.issues.sourceDuplicate.fixHint",
                    message_params={
                        "sourceDisplay": source_display,
                        "count": len(sids),
                        "schemas": ", ".join(sids),
                        "primarySchema": primary_ref,
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
    manual_data_files: dict[str, ManualDataFile],
    warnings: list[str],
    loading_errors: list[LoadingError],
) -> None:
    """配置文件格式自检主入口。"""
    logger.info("[配置自检] 开始检查项目配置: %s", manifest_path.parent.name)
    logger.info(
        "[配置自检] 检查范围: %d schemas, %d constraints, %d regex, %d transforms, %d manual_data",
        len(schema_files),
        len(constraint_files),
        len(regex_node_files),
        len(transform_files),
        len(manual_data_files),
    )

    errors_before = len(loading_errors)
    warnings_before = len(warnings)

    inspect_id_consistency(
        manifest,
        schema_files,
        constraint_files,
        regex_node_files,
        transform_files,
        manual_data_files,
        warnings,
        loading_errors,
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
