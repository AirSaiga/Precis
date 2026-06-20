"""
@fileoverview 动作执行处理器模块

功能概述:
- 处理约束的 YAML 配置更新（添加、更新、删除）
- 批量处理内联约束（同一 schema 合并为一次文件读写）
- 执行项目数据校验
- 生成前端渲染指令

输入示例:
    success, message = update_yaml_config(action, "/workspace")
    results = process_inline_batch(actions, "/workspace")
    result = execute_validate_project("/workspace", table_filter="users")

输出示例:
    (True, "notnull_users_email")
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
from app.shared.services.llm.actions.regex_handlers import process_regex_action
from app.shared.services.llm.actions.schema_handlers import process_schema_action
from app.shared.services.llm.actions.settings_handlers import process_settings_action
from app.shared.services.llm.actions.transform_handlers import process_transform_action
from app.shared.services.llm.constraints.constraint_builder import (
    CONSTRAINT_TYPE_MAP,
    _build_constraint_params,
    _build_constraint_refs,
)
from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file
from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id
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

    # 统一转换类型名
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)

    if not std_type or not target_column:
        error_msg = f"无效的约束规格: constraint_type={constraint_type}, std_type={std_type}, table_name={table_name}, target_column={target_column}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg

    # 确定用于文件名的表标识符 (优先使用可读的名称)
    filename_table = table_name or target_node_id or "unknown"
    filename_column = target_column or target_column_id or "unknown"

    if is_inline:
        logger.info(f"[updateYamlConfig] 内联约束: {std_type} on {filename_table}.{filename_column}")
        constraint_id = _generate_constraint_id(std_type, filename_table or "inline", filename_column)

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
                logger.warning(f"[updateYamlConfig] 未找到 schema 文件: {target_table_id}")
                return True, f"inline:{constraint_id}"

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

                if not column_id:
                    logger.warning(f"[updateYamlConfig] 未找到列 ID: {target_column}")
                    return True, f"inline:{constraint_id}"

                # 构建内联约束结构
                inline_constraint = {
                    "id": constraint_id,
                    "column": column_id,
                    "type": std_type,
                }
                params = _build_constraint_params(std_type, constraint_spec)
                if params:
                    inline_constraint["params"] = params

                # 检查是否已存在相同列和类型的约束
                existing_idx = None
                for idx, existing in enumerate(schema_data["constraints"]):
                    if existing.get("column") == column_id and existing.get("type") == std_type:
                        existing_idx = idx
                        break

                if existing_idx is not None:
                    # 更新现有约束
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

    elif action_type == "DELETE_CONSTRAINT_NODE":
        # 删除独立约束文件
        success, message = delete_constraint_file(std_type, filename_table, filename_column, workspace_path)
        return success, message

    else:
        # 添加/更新独立约束文件
        constraint_id = _generate_constraint_id(std_type, filename_table, filename_column)
        constraint_file_path = Path(workspace_path) / "constraints" / f"{constraint_id}.constraint.yaml"

        try:
            # 构建约束配置
            constraint_config = ConstraintFile(
                id=constraint_id,
                type=std_type,
                refs=_build_constraint_refs(constraint_spec),
                params=_build_constraint_params(std_type, constraint_spec),
            )

            # 保存约束文件
            save_constraint(str(constraint_file_path), constraint_config)
            logger.info(f"[updateYamlConfig] 成功保存约束: {constraint_id}")
            return True, constraint_id

        except Exception as e:
            error_msg = f"保存约束配置失败: {str(e)}"
            logger.error(f"[updateYamlConfig] {error_msg}")
            return False, error_msg
