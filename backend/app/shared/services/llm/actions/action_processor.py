"""
@fileoverview 动作处理器模块

功能概述:
- 处理 LLM 返回的动作列表（支持批量优化）
- 独立约束：每个单独处理
- 内联约束：按 schema 分组，同一 schema 的多个约束合并为一次读写
- 支持 VALIDATE_PROJECT 等校验动作
- 支持文件级备份回滚：动作执行前备份受影响文件，失败时恢复

输入示例:
    result = process_actions(actions, workspace_path="/path/to/project")

输出示例:
    {"success": True, "results": [{"action": ..., "success": True, "message": ...}]}
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from collections import defaultdict
from typing import Any

from app.shared.services.llm.actions.action_handlers import (
    _collect_target_schema_id,
    _is_inline_action,
    execute_validate_project,
    generate_frontend_instructions,
    process_inline_batch,
    update_yaml_config,
)

logger = logging.getLogger(__name__)


def _collect_affected_files(actions: list[dict[str, Any]], workspace_path: str) -> set[str]:
    """收集动作列表可能影响的所有文件路径（用于备份）。

    扫描动作中的 schema/constraint/regex 相关文件路径。
    """
    affected: set[str] = set()
    for action in actions:
        spec = action.get("constraintSpec", {})
        # 收集约束文件路径
        constraint_file = spec.get("constraintFile") or spec.get("filePath")
        if constraint_file and not os.path.isabs(constraint_file):
            constraint_file = os.path.join(workspace_path, constraint_file)
        if constraint_file:
            affected.add(constraint_file)
        # 收集 schema 文件路径
        schema_file = spec.get("schemaFile") or spec.get("schemaFilePath")
        if schema_file and not os.path.isabs(schema_file):
            schema_file = os.path.join(workspace_path, schema_file)
        if schema_file:
            affected.add(schema_file)
    return {f for f in affected if os.path.isfile(f)}


def _backup_files(file_paths: set[str], backup_dir: str) -> dict[str, str]:
    """将文件备份到指定目录，返回 {原始路径: 备份路径} 映射。"""
    backups: dict[str, str] = {}
    for fp in file_paths:
        backup_path = os.path.join(backup_dir, os.path.basename(fp))
        # 处理同名文件：添加后缀
        if os.path.exists(backup_path):
            base, ext = os.path.splitext(backup_path)
            backup_path = f"{base}_{id(fp)}{ext}"
        try:
            shutil.copy2(fp, backup_path)
            backups[fp] = backup_path
        except OSError as e:
            logger.warning(f"备份文件失败: {fp} -> {e}")
    return backups


def _restore_backups(backups: dict[str, str]) -> None:
    """从备份恢复文件。"""
    for original_path, backup_path in backups.items():
        try:
            shutil.copy2(backup_path, original_path)
            logger.info(f"已回滚文件: {original_path}")
        except OSError as e:
            logger.error(f"回滚文件失败: {original_path} -> {e}")


def process_actions(actions: list[dict[str, Any]], workspace_path: str = "") -> dict[str, Any]:
    """
    @methoddesc 处理动作列表（支持批量优化和文件级备份回滚）

    核心优化策略：
    1. 独立约束文件：每个单独处理（文件路径不同，不会冲突）
    2. 内联约束：按 schema 分组，同一 schema 的多个约束合并为一次读写，
       避免多次打开关闭同一文件

    备份回滚策略：
    - 执行前备份所有可能受影响的文件到临时目录
    - 如果任何动作执行失败，恢复所有备份文件
    - 无论成功失败，最后清理临时目录

    参数:
        actions: LLM 返回的动作列表
        workspace_path: 项目工作区路径

    返回:
        处理结果字典，格式为 {"success": bool, "results": [...]}
    """
    # 执行前备份受影响的文件
    affected_files = _collect_affected_files(actions, workspace_path)
    backup_dir = ""
    backups: dict[str, str] = {}
    if affected_files:
        backup_dir = tempfile.mkdtemp(prefix="precis_action_backup_")
        backups = _backup_files(affected_files, backup_dir)
        logger.info(f"[process_actions] 已备份 {len(backups)} 个文件到 {backup_dir}")

    try:
        results = _execute_actions(actions, workspace_path)

        # 检查是否有失败的动作
        all_success = all(r["success"] for r in results)

        if not all_success and backups:
            # 有动作失败，回滚所有已备份的文件
            failed_count = sum(1 for r in results if not r["success"])
            logger.warning(f"[process_actions] {failed_count} 个动作执行失败，正在回滚 {len(backups)} 个文件")
            _restore_backups(backups)

        return {"success": all_success, "results": results}
    finally:
        # 清理备份目录
        if backup_dir and os.path.isdir(backup_dir):
            try:
                shutil.rmtree(backup_dir)
            except OSError:
                pass


def _execute_actions(actions: list[dict[str, Any]], workspace_path: str) -> list[dict[str, Any]]:
    """执行动作列表的内部函数（不含备份回滚逻辑）。"""
    # 按类型分类 actions
    inline_actions_by_schema: dict[str, list[dict[str, Any]]] = defaultdict(list)
    standalone_actions: list[dict[str, Any]] = []
    other_actions: list[dict[str, Any]] = []

    for action in actions:
        action_type = action.get("actionType")

        # 非约束类动作放入 other_actions
        if action_type not in [
            "ADD_CONSTRAINT_NODE",
            "UPDATE_CONSTRAINT_NODE",
            "DELETE_CONSTRAINT_NODE",
        ]:
            other_actions.append(action)
        elif _is_inline_action(action):
            # 内联约束按 schema ID 分组
            schema_id = _collect_target_schema_id(action)
            if schema_id:
                inline_actions_by_schema[schema_id].append(action)
            else:
                # 无法识别 schema ID，降级为独立处理
                standalone_actions.append(action)
        else:
            standalone_actions.append(action)

    results = []

    # 1. 处理独立约束（每个约束单独读写文件）
    for action in standalone_actions:
        action_type = action.get("actionType")
        success, message = update_yaml_config(action, workspace_path)
        results.append(
            {
                "action": action,
                "success": success,
                "message": message,
                "frontendInstructions": generate_frontend_instructions(action)
                if success and action_type != "DELETE_CONSTRAINT_NODE"
                else None,
            }
        )

    # 2. 批量处理内联约束（同一 schema 合并为一次文件读写）
    for schema_id, schema_actions in inline_actions_by_schema.items():
        if len(schema_actions) == 1:
            # 单个约束，无需批量优化，直接处理
            action = schema_actions[0]
            success, message = update_yaml_config(action, workspace_path)
            results.append(
                {
                    "action": action,
                    "success": success,
                    "message": message,
                    "frontendInstructions": generate_frontend_instructions(action) if success else None,
                }
            )
        else:
            # 多个约束针对同一 schema，使用批量处理减少 IO
            logger.info(f"[process_actions] 批量处理 schema '{schema_id}' 的 {len(schema_actions)} 个内联约束")
            batch_results = process_inline_batch(schema_actions, workspace_path)
            results.extend(batch_results)

    # 3. 处理 VALIDATE_PROJECT 等其他动作
    for action in other_actions:
        action_type = action.get("actionType", "UNKNOWN")

        if action_type == "VALIDATE_PROJECT":
            # 提取可选的表名过滤参数
            spec = action.get("constraintSpec", {})
            table_filter = spec.get("targetNodeId") or spec.get("tableName")
            if not table_filter:
                tables = spec.get("tableIds") or spec.get("tables", [])
                if tables:
                    table_filter = tables

            # 执行项目数据校验
            validate_result = execute_validate_project(workspace_path, table_filter=table_filter)
            results.append(
                {
                    "action": action,
                    "success": validate_result["success"],
                    "message": validate_result["message"],
                    "frontendInstructions": None,
                    "validate_details": validate_result.get("details"),
                }
            )
        else:
            logger.warning(f"未知动作类型: {action_type}")
            results.append(
                {
                    "action": action,
                    "success": False,
                    "message": f"未知动作类型: {action_type}",
                    "frontendInstructions": None,
                }
            )

    return results
