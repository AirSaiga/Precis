# backend/app/cli/shell/commands/ai/interaction.py
"""
@fileoverview AI 交互辅助模块

功能概述:
- 在执行修改操作前向用户展示操作列表并确认
- 从项目 schema 文件中提取表格和列信息作为上下文，供 AI 理解项目结构
- 提供 Spinner 动画辅助函数（创建与停止）

架构设计:
- confirm_actions(): 展示 AI 计划执行的操作列表，等待用户输入 y/yes 确认
- build_context_data(): 读取项目 schema 目录下的 YAML 文件，构建 AI 上下文
- create_spinner()/stop_spinner(): 简单的终端加载动画线程控制

输入示例:
    confirm_actions(actions, "AI 回复说明")
    build_context_data("用户消息", context)

输出示例:
    True/False（用户是否确认执行）
    {"message": "...", "context": {...}, "projectOverview": {...}}
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from app.cli.shell.formatter import Colors, Formatter
from app.shared.services.ai.utils import get_project_overview

logger = logging.getLogger(__name__)


def confirm_actions(actions: list[dict[str, Any]], reply: str) -> bool:
    """显示操作确认提示，等待用户确认。

    在执行修改操作前，向用户展示 AI 计划执行的操作列表，
    等待用户输入 y/yes 确认后才继续。

    Args:
        actions: 动作列表
        reply: AI 的回复说明

    Returns:
        用户是否确认执行
    """
    print(Formatter.info("\n即将执行以下操作:"))
    print("-" * 40)

    # 显示 AI 的说明
    if reply:
        print(Formatter.info(f"说明: {reply}"))
        print("-" * 40)

    # 显示每个动作详情
    for i, action in enumerate(actions, 1):
        action_type = action.get("actionType", "UNKNOWN")
        spec = action.get("constraintSpec", {})

        # 处理 VALIDATE_PROJECT 特殊显示
        if action_type == "VALIDATE_PROJECT":
            table_name = spec.get("tableName", spec.get("targetNodeId", "所有表"))
            tables = spec.get("tables") or spec.get("tableIds")

            if tables:
                if len(tables) == 1:
                    display = f"校验表: {tables[0]}"
                else:
                    display = f"校验 {len(tables)} 个表"
            elif table_name and table_name != "所有表":
                display = f"校验表: {table_name}"
            else:
                display = "校验所有表"

            print(f"  {i}. {display}")
            continue

        # 约束操作的显示
        constraint_type = spec.get("type", "Unknown")
        table_name = spec.get("tableName", spec.get("targetNodeId", "未知"))
        column_name = spec.get("targetColumn", spec.get("targetColumnId", "未知"))

        action_desc = {
            "ADD_CONSTRAINT_NODE": "添加约束",
            "UPDATE_CONSTRAINT_NODE": "更新约束",
            "DELETE_CONSTRAINT_NODE": "删除约束",
        }.get(action_type, action_type)

        print(f"  {i}. {action_desc}")
        print(f"     表: {table_name}")
        print(f"     字段: {column_name}")
        print(f"     约束类型: {constraint_type}")

    print("-" * 40)

    # 等待用户确认
    try:
        confirm = input(Formatter.warning("确认执行? (y/N): ")).strip().lower()
        return confirm in ("y", "yes")
    except (KeyboardInterrupt, EOFError):
        print()
        return False


def build_context_data(message: str, context: Any) -> dict[str, Any]:
    """构建上下文数据。

    从项目配置中提取表格和列信息作为上下文，供 AI 理解项目结构。

    Args:
        message: 用户消息
        context: 命令上下文

    Returns:
        上下文数据字典，包含 message、context 和 projectOverview
    """
    project_path = context.project_path
    selected_nodes = []

    # 尝试从 schema 文件中提取表格信息
    if project_path:
        schemas_dir = Path(project_path) / "schemas"
        if schemas_dir.exists():
            for schema_file in schemas_dir.glob("*.yaml"):
                try:
                    import yaml

                    with open(schema_file, encoding="utf-8") as f:
                        schema_data = yaml.safe_load(f) or {}

                    # Schema 文件直接包含 columns 列表
                    table_name = schema_data.get("name", "")
                    table_id = schema_data.get("id", table_name)

                    columns = schema_data.get("columns", [])
                    column_info = []
                    for c in columns:
                        col_name = c.get("name", "")
                        col_id = c.get("id", col_name)
                        column_info.append({"id": col_id, "name": col_name})

                    if table_name or table_id:
                        # 优先使用 schema 文件中定义的 id
                        node_id = table_id
                        selected_nodes.append(
                            {
                                "id": node_id,
                                "type": "schema",
                                "data": {
                                    "label": table_name or table_id,
                                    "columns": column_info,
                                },
                            }
                        )
                except Exception as e:
                    logger.debug(f"读取 schema 文件失败 {schema_file}: {e}")

    # 获取项目概览（表结构和约束）
    project_overview = get_project_overview(project_path)

    return {
        "message": message,
        "context": {
            "hasContext": len(selected_nodes) > 0,
            "selectedNodes": selected_nodes,
        },
        "projectOverview": project_overview,
    }


def create_spinner(message: str = "AI> "):
    """创建并启动一个 spinner 线程。

    Args:
        message: spinner 前显示的消息前缀

    Returns:
        tuple: (stop_event, spinner_thread)
    """
    stop_event = threading.Event()

    def spinner():
        chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        i = 0
        while not stop_event.is_set():
            print(f"\r{Formatter.colorize(message, Colors.CYAN)}{chars[i % len(chars)]}", end="", flush=True)
            time.sleep(0.1)
            i += 1

    thread = threading.Thread(target=spinner)
    thread.start()
    return stop_event, thread


def stop_spinner(stop_event: threading.Event, thread: threading.Thread):
    """停止 spinner 线程。

    Args:
        stop_event: 停止事件
        thread: spinner 线程
    """
    stop_event.set()
    thread.join()
