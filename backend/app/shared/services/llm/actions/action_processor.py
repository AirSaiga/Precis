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
from app.shared.services.llm.actions.regex_handlers import process_regex_action
from app.shared.services.llm.actions.registry import (
    CONSTRAINT_ACTION_TYPES,
    REGEX_ACTION_TYPES,
    SCHEMA_ACTION_TYPES,
    TRANSFORM_ACTION_TYPES,
)
from app.shared.services.llm.actions.schema_handlers import process_schema_action
from app.shared.services.llm.actions.settings_handlers import process_settings_action
from app.shared.services.llm.actions.transform_handlers import process_transform_action

logger = logging.getLogger(__name__)


def _collect_affected_files(actions: list[dict[str, Any]], workspace_path: str) -> set[str]:
    """收集动作列表可能影响的所有文件路径（用于备份）。

    扫描所有动作类型中的相关文件路径，包括约束、Schema、Regex、Transform 和项目设置。
    始终包含 project.precis.yaml（所有资源类型操作都可能修改它）。
    """
    affected: set[str] = set()
    has_file_modifications = False

    workspace_abs = os.path.abspath(workspace_path)

    def _safe_resolve(raw_path: str) -> str | None:
        """解析路径并验证不超出工作区范围，防止路径穿越。"""
        if not os.path.isabs(raw_path):
            raw_path = os.path.join(workspace_path, raw_path)
        resolved = os.path.normpath(os.path.abspath(raw_path))
        if not resolved.startswith(workspace_abs + os.sep) and resolved != workspace_abs:
            logger.warning("LLM 返回的路径超出工作区范围，已忽略: %s", raw_path)
            return None
        return resolved

    def _sanitize_id(resource_id: str) -> str | None:
        """清洗资源 ID，禁止目录分隔符和路径穿越。"""
        if "/" in resource_id or "\\" in resource_id or ".." in resource_id:
            logger.warning("LLM 返回的资源 ID 包含非法字符，已忽略: %s", resource_id)
            return None
        return os.path.basename(resource_id)

    # 从注册表派生分类集合（单一事实源），避免本地硬编码与注册表不同步
    schema_action_types = SCHEMA_ACTION_TYPES
    regex_action_types = REGEX_ACTION_TYPES
    transform_action_types = TRANSFORM_ACTION_TYPES
    constraint_action_types = CONSTRAINT_ACTION_TYPES

    for action in actions:
        action_type = action.get("actionType", "")

        if action_type in constraint_action_types:
            spec = action.get("constraintSpec", {})
            constraint_file = spec.get("constraintFile") or spec.get("filePath")
            if constraint_file:
                resolved = _safe_resolve(constraint_file)
                if resolved:
                    affected.add(resolved)
            schema_file = spec.get("schemaFile") or spec.get("schemaFilePath")
            if schema_file:
                resolved = _safe_resolve(schema_file)
                if resolved:
                    affected.add(resolved)
            has_file_modifications = True

        elif action_type in schema_action_types:
            spec = action.get("schemaSpec", {})
            schema_id = spec.get("schemaId") or spec.get("id") or spec.get("name")
            if schema_id:
                safe_id = _sanitize_id(str(schema_id))
                if safe_id:
                    for candidate in [
                        os.path.join(workspace_path, "schemas", f"{safe_id}.schema.yaml"),
                        os.path.join(workspace_path, "schemas", f"{safe_id}.yaml"),
                    ]:
                        if os.path.isfile(candidate):
                            affected.add(candidate)
            has_file_modifications = True

        elif action_type in regex_action_types:
            spec = action.get("regexSpec", {})
            regex_id = spec.get("regexId") or spec.get("id") or spec.get("name")
            if regex_id:
                safe_id = _sanitize_id(str(regex_id))
                if safe_id:
                    for dirname in ("regex_nodes", "regex"):
                        for candidate in [
                            os.path.join(workspace_path, dirname, f"{safe_id}.regex.yaml"),
                            os.path.join(workspace_path, dirname, f"{safe_id}.yaml"),
                        ]:
                            if os.path.isfile(candidate):
                                affected.add(candidate)
            has_file_modifications = True

        elif action_type in transform_action_types:
            spec = action.get("transformSpec", {})
            transform_id = spec.get("transformId") or spec.get("id")
            if transform_id:
                safe_id = _sanitize_id(str(transform_id))
                if safe_id:
                    candidate = os.path.join(workspace_path, "transforms", f"{safe_id}.transform.yaml")
                    if os.path.isfile(candidate):
                        affected.add(candidate)
            has_file_modifications = True

        elif action_type == "UPDATE_SETTINGS":
            has_file_modifications = True

    # 所有资源操作都可能修改 manifest，始终备份
    if has_file_modifications:
        manifest_path = os.path.join(workspace_path, "project.precis.yaml")
        if os.path.isfile(manifest_path):
            affected.add(manifest_path)

    return affected


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


def _snapshot_resource_files(workspace_path: str) -> set[str]:
    """快照工作区内的资源文件（constraints/schemas/regex*/transforms 目录下的 yaml）。

    用于回滚时对比前后差异，检测本次新建的文件。比按 spec 推断路径更可靠——
    spec 可能不含 constraintFile 字段，而 handler 内部用 _generate_constraint_id 派生路径。
    """
    snapshot: set[str] = set()
    for sub in ("constraints", "schemas", "regex_nodes", "regex", "transforms"):
        d = os.path.join(workspace_path, sub)
        if os.path.isdir(d):
            for name in os.listdir(d):
                if name.endswith((".yaml", ".yml")):
                    snapshot.add(os.path.join(d, name))
    return snapshot


def _detect_created_files(pre_snapshot: set[str], post_snapshot: set[str]) -> set[str]:
    """检测本次执行新建的文件：执行后快照中存在、执行前快照中不存在的部分。

    用于回滚时删除新建文件（避免孤儿 YAML）。
    """
    return post_snapshot - pre_snapshot


def process_actions(actions: list[dict[str, Any]], workspace_path: str = "") -> dict[str, Any]:
    """
    @methoddesc 处理动作列表（支持批量优化和文件级备份回滚）

    核心优化策略：
    1. 独立约束文件：每个单独处理（文件路径不同，不会冲突）
    2. 内联约束：按 schema 分组，同一 schema 的多个约束合并为一次读写，
       避免多次打开关闭同一文件

    备份回滚策略：
    - 执行前备份所有可能受影响的文件到临时目录
    - 如果任何动作执行失败，恢复所有备份文件，并删除本次新建的文件
    - 无论成功失败，最后清理临时目录

    参数:
        actions: LLM 返回的动作列表
        workspace_path: 项目工作区路径

    返回:
        处理结果字典，格式为 {"success": bool, "results": [...]}
    """
    # 执行前备份受影响的文件（仅含已存在的文件）
    affected_files = _collect_affected_files(actions, workspace_path)
    pre_snapshot = _snapshot_resource_files(workspace_path)  # 执行前资源文件快照
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

        if not all_success:
            # 有动作失败，回滚：恢复已备份文件 + 删除本次新建的文件（避免孤儿）
            failed_count = sum(1 for r in results if not r["success"])
            logger.warning(f"[process_actions] {failed_count} 个动作执行失败，正在回滚")
            if backups:
                _restore_backups(backups)
            # 检测本次新建的文件（快照对比，可靠捕获 spec 未声明路径的新文件）
            post_snapshot = _snapshot_resource_files(workspace_path)
            created = _detect_created_files(pre_snapshot, post_snapshot)
            for f in created:
                try:
                    os.remove(f)
                    logger.info(f"[process_actions] 回滚删除新建文件: {f}")
                except OSError as e:
                    logger.warning(f"[process_actions] 删除新建文件失败: {f} -> {e}")

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
    schema_actions: list[dict[str, Any]] = []
    regex_actions: list[dict[str, Any]] = []
    transform_actions: list[dict[str, Any]] = []
    settings_actions: list[dict[str, Any]] = []
    canvas_actions: list[dict[str, Any]] = []
    other_actions: list[dict[str, Any]] = []

    # 从注册表派生分类集合（单一事实源）
    constraint_types = CONSTRAINT_ACTION_TYPES
    schema_types = SCHEMA_ACTION_TYPES
    regex_types = REGEX_ACTION_TYPES
    transform_types = TRANSFORM_ACTION_TYPES

    for action in actions:
        action_type = action.get("actionType")

        if action_type in constraint_types:
            if _is_inline_action(action):
                schema_id = _collect_target_schema_id(action)
                if schema_id:
                    inline_actions_by_schema[schema_id].append(action)
                else:
                    standalone_actions.append(action)
            else:
                standalone_actions.append(action)
        elif action_type in schema_types:
            schema_actions.append(action)
        elif action_type in regex_types:
            regex_actions.append(action)
        elif action_type in transform_types:
            transform_actions.append(action)
        elif action_type == "UPDATE_SETTINGS":
            settings_actions.append(action)
        elif action_type == "ADD_TO_CANVAS":
            # ADD_TO_CANVAS 是纯读动作（只读现有配置 + 发指令，不写盘），独立处理
            canvas_actions.append(action)
        else:
            other_actions.append(action)

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
                # ADD/UPDATE/DELETE 均生成指令：前端据此增/改/删画布节点（保持画布与磁盘同步）
                "frontendInstructions": generate_frontend_instructions(action, workspace_path) if success else None,
            }
        )

    # 2. 批量处理内联约束（同一 schema 合并为一次文件读写）
    for schema_id, schema_actions_list in inline_actions_by_schema.items():
        if len(schema_actions_list) == 1:
            action = schema_actions_list[0]
            success, message = update_yaml_config(action, workspace_path)
            results.append(
                {
                    "action": action,
                    "success": success,
                    "message": message,
                    "frontendInstructions": generate_frontend_instructions(action, workspace_path) if success else None,
                }
            )
        else:
            logger.info(f"[process_actions] 批量处理 schema '{schema_id}' 的 {len(schema_actions_list)} 个内联约束")
            batch_results = process_inline_batch(schema_actions_list, workspace_path)
            results.extend(batch_results)

    # 3. 处理 Schema 动作
    for action in schema_actions:
        result = process_schema_action(action, workspace_path)
        results.append(
            {
                "action": action,
                "success": result["success"],
                "message": result["message"],
                # ADD/UPDATE/DELETE 均生成指令：前端据此建/刷/删画布 Schema 节点
                "frontendInstructions": generate_frontend_instructions(action, workspace_path)
                if result["success"]
                else None,
            }
        )

    # 4. 处理 Regex 动作
    for action in regex_actions:
        result = process_regex_action(action, workspace_path)
        results.append(
            {
                "action": action,
                "success": result["success"],
                "message": result["message"],
                # ADD/UPDATE/DELETE 均生成指令：前端据此建/刷/删画布 Regex 节点
                "frontendInstructions": generate_frontend_instructions(action, workspace_path)
                if result["success"]
                else None,
            }
        )

    # 5. 处理 Transform 动作
    for action in transform_actions:
        result = process_transform_action(action, workspace_path)
        results.append(
            {
                "action": action,
                "success": result["success"],
                "message": result["message"],
                # ADD/UPDATE/DELETE 均生成指令：前端据此建/刷/删画布 Transform 节点
                "frontendInstructions": generate_frontend_instructions(action, workspace_path)
                if result["success"]
                else None,
            }
        )

    # 6. 处理 Settings 动作
    for action in settings_actions:
        result = process_settings_action(action, workspace_path)
        results.append(
            {
                "action": action,
                "success": result["success"],
                "message": result["message"],
                "frontendInstructions": None,
            }
        )

    # 7. 处理 ADD_TO_CANVAS 动作（纯读：不写盘，只读现有配置生成 frontendInstructions）
    # 语义：把项目配置里已存在的资源"显示到画布"，区别于 ADD_*（创建新配置文件）。
    # 复用 generate_frontend_instructions 的重读逻辑，确保画布拿到磁盘真实数据。
    for action in canvas_actions:
        action_type = action.get("actionType", "ADD_TO_CANVAS")
        spec = action.get("canvasSpec", {})
        resource_kind = spec.get("resourceKind", "")
        resource_id = spec.get("resourceId") or spec.get("resourceName") or spec.get("name", "")
        logger.info(f"[process_actions] ADD_TO_CANVAS: {resource_kind} '{resource_id}'（只读，不写盘）")
        results.append(
            {
                "action": action,
                "success": True,
                "message": f"已生成显示到画布指令: {resource_kind} '{resource_id}'",
                # 重读磁盘真实配置，生成前端指令（前端委托 importV2ResourceToCanvas 创建节点）
                "frontendInstructions": generate_frontend_instructions(action, workspace_path),
            }
        )

    # 8. 处理 VALIDATE_PROJECT 等其他动作
    for action in other_actions:
        action_type = action.get("actionType", "UNKNOWN")

        if action_type == "VALIDATE_PROJECT":
            spec = action.get("constraintSpec", {})
            table_filter = spec.get("targetNodeId") or spec.get("tableName")
            if not table_filter:
                tables = spec.get("tableIds") or spec.get("tables", [])
                if tables:
                    table_filter = tables

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
