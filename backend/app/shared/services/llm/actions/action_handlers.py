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
@fileoverview 动作执行处理器模块

功能概述:
- 处理约束的 YAML 配置更新（添加、更新、删除）
- 批量处理内联约束（同一 schema 合并为一次文件读写）
- 执行项目数据校验
- 生成前端变更集指令（v2 信封，见 constraints/frontend_instructions.py）

输入示例:
    success, message = update_yaml_config(action, "/workspace")
    results = process_inline_batch(actions, "/workspace")
    result = execute_validate_project("/workspace", table_filter="users")

输出示例:
    (True, "notnull_users_1f0c8e52-9d1e-4f0a-9b3e-6a2f5c8d7e90")
    [{"action": action, "success": True, "message": "..."}]
    {"success": True, "message": "校验通过", "details": {...}}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.constraint.writer import save_constraint
from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.writer import ensure_constraint_ref, save_manifest
from app.shared.services.llm.actions.regex_handlers import process_regex_action
from app.shared.services.llm.actions.schema_handlers import process_schema_action
from app.shared.services.llm.actions.settings_handlers import process_settings_action
from app.shared.services.llm.actions.transform_handlers import process_transform_action
from app.shared.services.llm.constraints.constraint_builder import (
    CONSTRAINT_TYPE_MAP,
    _build_constraint_params,
    _build_constraint_refs,
    _build_inline_constraint_item,
)
from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file
from app.shared.services.llm.constraints.constraint_lookup import (
    default_constraint_id,
    find_constraint_file_by_id,
    find_constraint_file_by_semantics,
    sanitize_constraint_id,
)
from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions
from app.shared.services.llm.constraints.inline_batch import (
    _collect_target_schema_id,
    _is_inline_action,
    process_inline_batch,
)
from app.shared.services.llm.validate_executor import execute_validate_project
from app.shared.services.llm.yaml_io import FileLock, YamlUpdateError, atomic_write_yaml

logger = logging.getLogger(__name__)

# 重新导出子模块函数，保持向后兼容
__all__ = [
    "update_yaml_config",
    "delete_constraint_file",
    "generate_frontend_instructions",
    "execute_validate_project",
    "_collect_target_schema_id",
    "_is_inline_action",
    "process_inline_batch",
    "process_schema_action",
    "process_regex_action",
    "process_transform_action",
    "process_settings_action",
]


def _ensure_manifest_constraint_ref(workspace_path: str, constraint_id: str, rel_path: str | None = None) -> None:
    """确保 manifest 中包含指定独立约束的引用（镜像 _ensure_manifest_schema_ref）。

    失败时抛出异常 —— 避免约束文件已写盘但 manifest 未登记，
    导致校验引擎永不加载该约束（C1：静默失效）。
    """
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    manifest = load_manifest(manifest_path)
    ensure_constraint_ref(manifest, constraint_id, default_path=rel_path)
    save_manifest(manifest, manifest_path)


def _remove_manifest_constraint_ref(workspace_path: str, constraint_id: str) -> None:
    """从 manifest 中移除指定独立约束的引用（镜像 _remove_manifest_schema_ref）。

    失败时抛出异常 —— 避免约束文件已删除但 manifest 仍残留引用（dangling ref）。
    """
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    manifest = load_manifest(manifest_path)
    manifest.constraints = [c for c in manifest.constraints if c.id != constraint_id]
    save_manifest(manifest, manifest_path)


def _delete_inline_constraint(
    std_type: str,
    workspace_path: str,
    table_name: str,
    target_column: str,
    target_node_id: str,
    target_column_id: str,
) -> tuple[bool, str]:
    """从 schema 文件中删除内联约束

    定位方式与添加/更新内联约束保持一致：schema 按 id/name 匹配，
    列按传入 ID 或名称解析，约束项按「同列 + 同类型」匹配（镜像内联分支的既有约束查找）。

    参数:
        std_type: 标准化后的约束类型（如 NotNull）
        workspace_path: 项目工作区路径
        table_name: 目标表名
        target_column: 目标列名
        target_node_id: 目标表节点 ID（优先用于匹配 schema 文件）
        target_column_id: 目标列 ID（优先用于匹配列）

    返回:
        元组 (是否成功, 约束ID 或错误信息)
    """
    try:
        schemas_dir = Path(workspace_path) / "schemas"
        target_table_id = target_node_id or table_name
        schema_file = None

        for sf in schemas_dir.glob("*.yaml"):
            with open(sf, encoding="utf-8") as f:
                sd = yaml.safe_load(f) or {}
            if sd.get("id") == target_table_id or sd.get("name") == table_name:
                schema_file = sf
                break

        if not schema_file:
            return False, f"未找到 schema 文件: {target_table_id}"

        with FileLock(str(schema_file)):
            # 重新读取文件（确保在锁保护下读取最新内容）
            with open(schema_file, encoding="utf-8") as f:
                schema_data = yaml.safe_load(f) or {}

            columns = schema_data.get("columns", [])
            column_id = target_column_id
            if not column_id:
                for col in columns:
                    if col.get("name") == target_column:
                        column_id = col.get("id")
                        break

            if not column_id:
                return False, f"未找到列: {target_column}"

            constraints = schema_data.get("constraints", [])
            # 移除「同列 + 同类型」的内联约束项，其余保持不变
            remaining = [c for c in constraints if not (c.get("column") == column_id and c.get("type") == std_type)]
            if len(remaining) == len(constraints):
                return False, f"未找到内联约束: {std_type} on {table_name}.{target_column}"

            # 回传被删内联项自身的 id（不再派生）：信封与展示消费真实落盘结果
            removed_id = next(
                (
                    str(c.get("id"))
                    for c in constraints
                    if c.get("column") == column_id and c.get("type") == std_type and c.get("id")
                ),
                f"{std_type.lower()}_{column_id or target_column}",
            )

            schema_data["constraints"] = remaining
            # 必须全量替换写入：atomic_write_yaml 的 preserve_format 路径按 id
            # 合并列表（只更新/追加、不删除），会把本次删除的约束"复活"
            atomic_write_yaml(schema_file, schema_data, preserve_format=False)

        logger.info(f"[updateYamlConfig] 删除内联约束: {removed_id}")
        return True, f"inline:{removed_id}"

    except YamlUpdateError as e:
        error_msg = f"删除内联约束失败: {str(e)}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg
    except OSError as e:
        error_msg = f"删除内联约束文件操作失败: {str(e)}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg
    except Exception as e:
        error_msg = f"删除内联约束失败: {str(e)}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg


def update_yaml_config(action: dict[str, Any], workspace_path: str) -> tuple[bool, str]:
    """
    @methoddesc 更新 YAML 配置文件

    将 LLM 返回的约束动作写入到项目的 constraints 目录或 schema 文件的内联约束中。
    支持添加、更新、删除三种操作类型，以及内联和独立两种约束存储方式。

    参数:
        action: 动作字典，包含 actionType 和 constraintSpec
        workspace_path: 工作区路径

    返回:
        元组 (是否成功, 错误信息或约束ID)

    示例:
        >>> success, msg = update_yaml_config(
        ...     {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {...}},
        ...     "/workspace"
        ... )
    """
    action_type = action.get("actionType")
    constraint_spec = action.get("constraintSpec", {})

    constraint_type = constraint_spec.get("type", "")
    table_name = constraint_spec.get("tableName", "")
    target_column = constraint_spec.get("targetColumn", "")
    target_node_id = constraint_spec.get("targetNodeId", "")
    target_column_id = constraint_spec.get("targetColumnId", "")
    is_inline = constraint_spec.get("isInline", False)
    # 多列联合唯一：targetColumns（列名/ID 数组）可作为 targetColumn 的替代
    target_columns = constraint_spec.get("targetColumnIds") or constraint_spec.get("targetColumns") or []

    # 统一转换类型名
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)

    # LLM 显式给出的约束 ID：清洗为文件名安全形式（空串=未提供，回退自动生成）
    try:
        explicit_constraint_id = sanitize_constraint_id(constraint_spec.get("constraintId"))
    except ValueError as e:
        logger.error(f"[updateYamlConfig] {e}")
        return False, str(e)

    # DELETE 携带显式 constraintId 时可仅凭 id 定位（无需列信息）；其余情况
    # 类型与列（或列组合）缺一不可
    if not std_type or (not target_column and not target_columns):
        if not (action_type == "DELETE_CONSTRAINT_NODE" and explicit_constraint_id):
            error_msg = (
                f"无效的约束规格: constraint_type={constraint_type}, std_type={std_type}, "
                f"table_name={table_name}, target_column={target_column}"
            )
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg

    # 内联日志与错误信息用的表/列展示标识（优先可读名称；独立约束文件名由 id 决定）
    display_table = table_name or target_node_id or "unknown"
    display_column = (
        target_column or target_column_id or ("_".join(str(c) for c in target_columns) if target_columns else "unknown")
    )

    # DELETE 动作必须先于 is_inline 分支处理：删除语义与存储形态无关，
    # 旧实现 isInline=true 时先命中内联"添加"分支，只增不删还误报 success。
    # 内联约束从 schema 文件的 constraints 列表移除，独立约束删除 .constraint.yaml 文件。
    if action_type == "DELETE_CONSTRAINT_NODE":
        if is_inline:
            return _delete_inline_constraint(
                std_type=std_type,
                workspace_path=workspace_path,
                table_name=table_name,
                target_column=target_column,
                target_node_id=target_node_id,
                target_column_id=target_column_id,
            )
        # 删除独立约束文件：优先显式 constraintId，其次语义引用磁盘搜索
        # （对存量语义 ID 文件与新 UUID 文件都能正确删除）
        success, message = delete_constraint_file(constraint_spec, workspace_path)
        # 同步从 manifest 移除引用（避免 dangling ref）——message 即被删文件真实 id
        if success:
            try:
                _remove_manifest_constraint_ref(workspace_path, message)
            except Exception as e:
                # 文件已删成功，manifest 清理失败仅告警（不回滚文件删除）
                logger.warning(f"[updateYamlConfig] 删除 manifest 引用失败（文件已删）: {e}")
        return success, message

    if is_inline:
        logger.info(f"[updateYamlConfig] 内联约束: {std_type} on {display_table}.{display_column}")
        constraint_id = explicit_constraint_id or default_constraint_id(std_type)

        # 将内联约束添加到 schema 文件
        try:
            schemas_dir = Path(workspace_path) / "schemas"

            # 查找匹配的 schema 文件
            target_table_id = target_node_id or table_name
            schema_file = None

            for sf in schemas_dir.glob("*.yaml"):
                with open(sf, encoding="utf-8") as f:
                    sd = yaml.safe_load(f) or {}
                if sd.get("id") == target_table_id or sd.get("name") == table_name:
                    schema_file = sf
                    break

            if not schema_file:
                # 找不到匹配的 schema 文件时必须返回失败，否则会静默成功
                # 并触发前端生成幽灵节点（画布有、文件无）。对齐 process_inline_batch 的行为。
                error_msg = f"未找到 schema 文件: {target_table_id}"
                logger.warning(f"[updateYamlConfig] {error_msg}")
                return False, error_msg

            # 使用文件锁保护写入操作
            with FileLock(str(schema_file)):
                # 重新读取文件（确保在锁保护下读取最新内容）
                with open(schema_file, encoding="utf-8") as f:
                    schema_data = yaml.safe_load(f) or {}

                columns = schema_data.get("columns", [])
                if "constraints" not in schema_data:
                    schema_data["constraints"] = []

                # 查找目标列的 ID（优先使用传入的 ID，否则按名称查找）
                column_id = target_column_id
                if not column_id:
                    for col in columns:
                        if col.get("name") == target_column:
                            column_id = col.get("id")
                            break

                # 多列联合唯一：单列引用可缺省（targetColumns 携带全部列引用，由共用构建器解析）
                is_multi_unique = std_type == "Unique" and isinstance(target_columns, list) and len(target_columns) > 1
                if not column_id and not is_multi_unique:
                    # 目标列不存在时必须返回失败，否则会静默成功（与 process_inline_batch 对齐）。
                    error_msg = f"未找到列: {target_column}"
                    logger.warning(f"[updateYamlConfig] {error_msg}")
                    return False, error_msg

                # 构建内联约束结构（共用构建器：Conditional 引用入 params、FK 目标入顶层字段、
                # 多列 Unique 用 columns 列表，三种特殊形态与 process_inline_batch 收敛到同一实现）
                inline_constraint = _build_inline_constraint_item(
                    std_type,
                    constraint_spec,
                    column_id or "",
                    columns,
                    table_name,
                    target_column,
                    workspace_path,
                    constraint_id,
                )

                # 检查是否已存在相同列（或列组合）和类型的约束
                existing_idx = None
                for idx, existing in enumerate(schema_data["constraints"]):
                    same_target = (
                        existing.get("columns") == inline_constraint.get("columns")
                        if "columns" in inline_constraint
                        else existing.get("column") == inline_constraint.get("column")
                    )
                    if same_target and existing.get("type") == std_type:
                        existing_idx = idx
                        break

                if existing_idx is not None:
                    # 更新现有约束：保留既有项的 id（内嵌约束全局 id 含 item id，
                    # UUID 化后每次更新换 id 会造成无谓的引用漂移）
                    prev_id = schema_data["constraints"][existing_idx].get("id")
                    if prev_id:
                        inline_constraint["id"] = prev_id
                        constraint_id = str(prev_id)
                    schema_data["constraints"][existing_idx] = inline_constraint
                    logger.info(f"[updateYamlConfig] 更新内联约束: {constraint_id}")
                else:
                    # 添加新约束
                    schema_data["constraints"].append(inline_constraint)
                    logger.info(f"[updateYamlConfig] 添加内联约束: {constraint_id}")

                # 原子性写入
                atomic_write_yaml(schema_file, schema_data)
                return True, f"inline:{constraint_id}"

        except YamlUpdateError as e:
            error_msg = f"YAML 更新失败: {str(e)}"
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg
        except OSError as e:
            error_msg = f"文件操作失败: {str(e)}"
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = f"保存约束配置失败: {str(e)}"
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg

    else:
        # 添加/更新独立约束文件（ID 已 UUID 化：缺省自动生成，显式 constraintId 尊重）
        constraint_file_path: Path | None = None

        try:
            located: tuple[str, Path] | None = None
            if action_type == "ADD_CONSTRAINT_NODE":
                # 语义查重：同表 + 同列 + 同类型已存在即视为重复——UUID 化后派生
                # ID 撞名的存在性检查失效，此处防止 LLM 重复添加产出 UUID 不同
                # 的双份约束（口径与 _constraint_validator 的表/列/类型一致）
                dup = find_constraint_file_by_semantics(
                    workspace_path,
                    std_type,
                    table_name=table_name,
                    target_node_id=target_node_id,
                    target_column=target_column,
                    target_column_id=target_column_id,
                    target_columns=target_columns,
                )
                if dup:
                    error_msg = f"约束已存在（id={dup[0]}），如需修改请用 UPDATE，如需新建请先删除现有约束。"
                    logger.warning(f"[updateYamlConfig] {error_msg}")
                    return False, error_msg
                if explicit_constraint_id and find_constraint_file_by_id(workspace_path, explicit_constraint_id):
                    error_msg = (
                        f"约束已存在（id={explicit_constraint_id}），如需修改请用 UPDATE，如需新建请先删除现有约束。"
                    )
                    logger.warning(f"[updateYamlConfig] {error_msg}")
                    return False, error_msg
                constraint_id = explicit_constraint_id or default_constraint_id(std_type)
            else:
                # UPDATE：优先显式 constraintId，其次语义引用定位既有文件——命中则
                # 保留原 id 原地覆写（含存量语义 ID 文件）；未命中保持宽容行为新建
                if explicit_constraint_id:
                    located = find_constraint_file_by_id(workspace_path, explicit_constraint_id)
                if located is None:
                    located = find_constraint_file_by_semantics(
                        workspace_path,
                        std_type,
                        table_name=table_name,
                        target_node_id=target_node_id,
                        target_column=target_column,
                        target_column_id=target_column_id,
                        target_columns=target_columns,
                    )
                if located:
                    constraint_id = located[0]
                    constraint_file_path = located[1]
                else:
                    constraint_id = explicit_constraint_id or default_constraint_id(std_type)

            if constraint_file_path is None:
                constraint_file_path = Path(workspace_path) / "constraints" / f"{constraint_id}.constraint.yaml"

            # 构建约束配置
            constraint_config = ConstraintFile(
                version=2,
                id=constraint_id,
                type=std_type,
                enabled=True,
                description=None,
                refs=_build_constraint_refs(std_type, table_name, target_column, constraint_spec, workspace_path),
                params=_build_constraint_params(
                    std_type, constraint_spec, table_name, target_column, workspace_path, constraint_id
                ),
                input_from_node=None,
                input_column=None,
            )

            # 保存约束文件
            save_constraint(constraint_config, str(constraint_file_path))
            # 注册到 manifest（C1 修复：否则约束文件成为孤儿，校验引擎永不加载）；
            # 登记路径取实际落盘文件名（UPDATE 命中的既有文件名可能与 id 不同）
            try:
                rel_path = constraint_file_path.relative_to(Path(workspace_path)).as_posix()
            except ValueError:
                rel_path = None
            try:
                _ensure_manifest_constraint_ref(workspace_path, constraint_id, rel_path)
            except Exception as e:
                logger.error(f"[updateYamlConfig] 登记 manifest 失败，回滚约束文件: {e}")
                constraint_file_path.unlink(missing_ok=True)
                return False, f"更新 manifest 引用失败: {e}"
            logger.info(f"[updateYamlConfig] 成功保存约束: {constraint_id}")
            return True, constraint_id

        except Exception as e:
            error_msg = f"保存约束配置失败: {str(e)}"
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg
