# backend/app/cli/shell/commands/ai/resolver.py
"""
@fileoverview AI 动作歧义解析模块

功能概述:
- 解析 AI 返回动作中的表名歧义（支持模糊匹配）
- 当表名匹配到多个结果时，弹出交互式菜单让用户选择正确的表
- 处理 VALIDATE_PROJECT 与约束操作（ADD/UPDATE/DELETE_CONSTRAINT_NODE）中的表名解析

架构设计:
- resolve_table_name(): 使用 find_matching_schemas 对表名进行模糊匹配
- resolve_ambiguities(): 遍历 AI 返回的动作列表，解析表名歧义并标记跳过项
- 静默模式下自动选择第一个匹配项，避免阻塞非交互流程

输入示例:
    resolve_table_name("users", "/path/to/project")
    resolve_ambiguities(actions, "/path/to/project")

输出示例:
    "users_table_id" 或 None（未找到）
    True/False（是否还有有效动作需要继续执行）
"""

from __future__ import annotations

import logging
from typing import Any

from app.cli.shell.formatter import Formatter
from app.cli.shell.interactive_menu import InteractiveMenu
from app.shared.services.llm.schema_resolver import find_matching_schemas

logger = logging.getLogger(__name__)


def resolve_table_name(table_name: str, project_path: str, silent: bool = False) -> str | None:
    """将表名解析为表ID。

    支持模糊匹配，如果有多个匹配则让用户选择。

    Args:
        table_name: 用户输入的表名
        project_path: 项目路径
        silent: 是否静默模式（不显示选择菜单）

    Returns:
        表ID，如果未找到则返回 None
    """
    matches = find_matching_schemas(project_path, table_name)

    if not matches:
        if not silent:
            print(Formatter.warning(f"[!] 未找到匹配的表: '{table_name}'"))
        return None

    if len(matches) == 1:
        # 只有一个匹配，直接返回
        selected = matches[0]
        if not silent:
            print(Formatter.info(f"[i] 表 '{table_name}' 匹配到: {selected['name']} ({selected['id'][:10]}...)"))
        return selected["id"]

    # 多个匹配，让用户选择
    if not silent:
        print(f"\n{Formatter.warning('[!]')} 表名 '{table_name}' 匹配到多个表:")

        menu = InteractiveMenu("请选择要校验的表:")
        for m in matches:
            display_id = f"{m['id'][:10]}..." if len(m["id"]) > 15 else m["id"]
            menu.add_item(m["id"], f"{m['name']} ({display_id})", f"ID: {m['id']}")

        menu.add_item("_cancel_", "取消", "不执行此操作")

        choice = menu.show()
        if choice and choice != "_cancel_":
            selected = next(m for m in matches if m["id"] == choice)
            return selected["id"]
        # 用户取消，返回 None
        return None

    # 静默模式下有多个匹配，记录警告并返回第一个（最安全的选择）
    logger.warning(f"表名 '{table_name}' 匹配到多个表，静默模式下默认选择第一个: {matches[0]['name']}")
    return matches[0]["id"]


def resolve_ambiguities(actions: list[dict[str, Any]], project_path: str) -> bool:
    """解决动作中的歧义。返回是否继续执行。

    遍历 AI 返回的动作列表，解析表名和列名的歧义。
    对于模糊匹配的表名，弹出交互式菜单让用户选择。
    标记为跳过的动作会在最后过滤掉。

    Args:
        actions: AI 返回的动作列表
        project_path: 项目路径

    Returns:
        是否还有有效动作需要继续执行
    """
    if not actions or not project_path:
        return True

    for action in actions:
        action_type = action.get("actionType", "")
        spec = action.get("constraintSpec", {})

        # 处理 VALIDATE_PROJECT 的表名解析
        if action_type == "VALIDATE_PROJECT":
            table_name = spec.get("tableName") or spec.get("targetNodeId")
            tables = spec.get("tables", [])

            # 解析单个表名
            if table_name:
                table_id = resolve_table_name(table_name, project_path)
                if table_id:
                    spec["targetNodeId"] = table_id
                    spec["tableName"] = table_name
                else:
                    action["_skip"] = True
                    continue

            # 解析表名列表
            elif tables:
                resolved_ids = []
                for name in tables:
                    table_id = resolve_table_name(name, project_path, silent=True)
                    if table_id:
                        resolved_ids.append(table_id)
                if resolved_ids:
                    spec["tableIds"] = resolved_ids
                else:
                    action["_skip"] = True
                    continue
            continue

        # Schema/Regex/Transform/Settings 操作不需要表名歧义解析
        non_table_types = {
            "ADD_SCHEMA",
            "UPDATE_SCHEMA",
            "DELETE_SCHEMA",
            "ADD_REGEX",
            "UPDATE_REGEX",
            "DELETE_REGEX",
            "ADD_TRANSFORM",
            "UPDATE_TRANSFORM",
            "DELETE_TRANSFORM",
            "UPDATE_SETTINGS",
        }
        if action_type in non_table_types:
            continue

        # 处理约束操作的表名解析
        table_id = spec.get("targetNodeId")
        table_name = spec.get("tableName")

        # 尝试匹配
        identifier = table_id or table_name
        if not identifier:
            continue

        matches = find_matching_schemas(project_path, identifier)

        # 如果有多个模糊匹配，且没有精确匹配 ID 的情况
        if len(matches) > 1:
            print(f"\n{Formatter.warning('[!]')} 发现多个匹配的表 '{identifier}':")

            menu = InteractiveMenu("请选择正确的表:")
            for m in matches:
                # 检查是否为加密 ID 格式，若是则显示一部分，否则显示全名
                display_id = f"{m['id'][:10]}..." if len(m["id"]) > 15 else m["id"]
                menu.add_item(m["id"], f"{m['name']} ({display_id})", f"ID: {m['id']}")

            menu.add_item("_skip_", "跳过此操作", "不执行此约束更新")

            choice = menu.show()
            if choice is None or choice == "_skip_":
                action["_skip"] = True
                continue

            # 找到选中的匹配项
            selected = next(m for m in matches if m["id"] == choice)

            # 更新 Action 中的关键字段
            spec["targetNodeId"] = selected["id"]
            spec["tableName"] = selected["name"]

            # 同样更新列 (如果是根据名称匹配，可能也存在列名冲突)
            # 这里简化处理，假设列在特定表内唯一
            print(f"{Formatter.success('[OK]')} 已选择表: {selected['name']}")
        elif len(matches) == 1:
            # 只有一个匹配，直接更新为表ID
            selected = matches[0]
            spec["targetNodeId"] = selected["id"]
            spec["tableName"] = selected["name"]

    # 统计并提示被跳过的动作
    skipped_actions = [a for a in actions if a.get("_skip")]
    if skipped_actions:
        print(Formatter.info(f"\n[i] 已跳过 {len(skipped_actions)} 个操作（用户取消或表名未找到）"))

    # 过滤掉标记为跳过的动作
    actions[:] = [a for a in actions if not a.get("_skip")]
    return len(actions) > 0
