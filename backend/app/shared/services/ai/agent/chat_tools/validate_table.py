"""@fileoverview validate_table 工具

Chat mini-agent 可调用的工具：执行项目数据校验。

复用 execute_validate_project，支持校验全部表或单个表。
让 LLM 在执行配置修改后，能自主验证改动效果，
若发现问题可进一步调整 actions，实现"改-验-修"自我纠错循环。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.llm.validate_executor import execute_validate_project

logger = logging.getLogger(__name__)

# 返回给 LLM 的错误条目上限，避免 observation 过长
_MAX_ERRORS_IN_OBSERVATION = 15


class ValidateTableTool:
    """
    @classdesc 数据校验工具

    封装 execute_validate_project，支持全表或单表校验。
    """

    NAME = "validate_table"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
        """
        self.project_path = project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "执行项目数据校验，检查当前约束规则是否通过。"
                    "可校验全部表（不传 table_name）或指定单表（传 table_name）。"
                    "建议在 apply_actions 修改约束后调用此工具验证效果；"
                    "用户明确要求'校验项目'或'校验某表'时也应调用。"
                    "返回错误数量和具体错误列表。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "要校验的表名（schema 的 name 或 id）。不传则校验所有表。",
                        }
                    },
                    "required": [],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行数据校验

        参数:
            arguments: tool 参数，包含可选的 table_name

        返回:
            {"success": bool, "error_count": int, "errors": [...], "message": str}
        """
        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "error_count": 0, "errors": []}

        table_name = arguments.get("table_name")
        # 空字符串视为不指定表
        table_filter = table_name if table_name else None

        try:
            # execute_validate_project 是同步函数（内部跑校验引擎），放到线程池
            result = await asyncio.to_thread(
                execute_validate_project,
                self.project_path,
                table_filter,
            )
        except Exception as e:
            logger.exception("validate_table 工具执行失败")
            return {"success": False, "error": f"校验执行失败: {e}", "error_count": 0, "errors": []}

        # execute_validate_project 返回 {success, message, details}
        # success=True 表示校验流程跑通（不代表数据无错），details 含 error_count
        details = result.get("details") or {}
        error_count = details.get("error_count", 0)
        raw_errors = details.get("errors", []) or []

        # 截断错误列表，避免 observation 过长
        truncated_errors = raw_errors[:_MAX_ERRORS_IN_OBSERVATION]
        if len(raw_errors) > _MAX_ERRORS_IN_OBSERVATION:
            truncated_count = len(raw_errors) - _MAX_ERRORS_IN_OBSERVATION
        else:
            truncated_count = 0

        return {
            "success": result.get("success", False),
            "error_count": error_count,
            "errors": truncated_errors,
            "truncated_error_count": truncated_count,
            "table_filter": table_filter,
            "message": result.get("message", ""),
        }
