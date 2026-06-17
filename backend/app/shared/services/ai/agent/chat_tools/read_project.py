"""@fileoverview read_project 工具

Chat mini-agent 可调用的工具：读取当前项目的完整概览。

返回项目中的所有表结构、约束、转换、正则节点和设置信息，
供 LLM 了解"当前项目里有什么"，从而决定后续操作。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.ai.utils import get_project_overview

logger = logging.getLogger(__name__)


class ReadProjectTool:
    """
    @classdesc 读取项目概览工具

    封装 get_project_overview，返回项目的全量结构信息。
    不接收任何参数——它读取的就是 runner 绑定的当前项目。
    """

    NAME = "read_project"

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
                    "读取当前项目的完整概览，包括所有表结构(schemas)、约束规则(constraints)、"
                    "数据转换(transforms)、正则节点(regex)和项目设置(settings)。"
                    "当用户询问'有哪些表'、'某个表有哪些约束'、'当前项目配置'等查询类问题时，"
                    "先调用此工具获取信息，再用自然语言回答。无需参数。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行项目概览读取

        参数:
            arguments: tool 参数（本工具无参数）

        返回:
            {"success": bool, "overview": {...}, "error": str}
            overview 形如 {"schemas": [...], "constraints": [...], "transforms": [...],
            "regex_nodes": [...], "settings": {...}}
        """
        # arguments 无参数，但保留接口一致性
        _ = arguments

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "overview": {}}

        try:
            # get_project_overview 是同步函数，放到线程池避免阻塞事件循环
            overview = await asyncio.to_thread(get_project_overview, self.project_path)

            # 统计摘要，便于 LLM 快速判断
            summary = {
                "schema_count": len(overview.get("schemas", [])),
                "constraint_count": len(overview.get("constraints", [])),
                "transform_count": len(overview.get("transforms", [])),
                "regex_count": len(overview.get("regex_nodes", [])),
            }
            return {"success": True, "overview": overview, "summary": summary}
        except Exception as e:
            logger.exception("read_project 工具执行失败")
            return {"success": False, "error": f"读取项目概览失败: {e}", "overview": {}}
