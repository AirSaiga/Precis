"""@fileoverview read_project 工具

Chat mini-agent 可调用的工具：读取当前项目的完整概览。

返回项目中的所有表结构、约束、转换、正则节点和设置信息，
供 LLM 了解"当前项目里有什么"，从而决定后续操作。

体积控制：大项目的 overview 可能几万字符，直接全量返回会被 memory 的 8000 字符硬切
在 JSON 中途，破坏结构、让 LLM 拿到半截数据。本工具在返回前做语义截断：
schemas/constraints/transforms/regex_nodes 各保留前 N 项 + 计数，每张表的 columns
也只列前 N 个，让 LLM 既能判断项目规模，又能在需要详情时调 read_table。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.ai.utils import get_project_overview

logger = logging.getLogger(__name__)

# 语义截断阈值（参考 validate_table 的"列表前 N 项 + 计数"模式）。
# 目标：截断后 observation 控制在 memory 8000 字符硬切线以内，且仍是合法 JSON。
_MAX_SCHEMAS_IN_OBSERVATION = 20
_MAX_CONSTRAINTS_IN_OBSERVATION = 30
_MAX_OTHER_NODES_IN_OBSERVATION = 10  # transforms / regex_nodes 共用
_MAX_COLUMNS_PER_SCHEMA = 50


class ReadProjectTool:
    """
    @classdesc 读取项目概览工具

    封装 get_project_overview，返回项目的结构信息（大项目自动语义截断）。
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

    @staticmethod
    def _truncate_overview(overview: dict[str, Any]) -> dict[str, Any]:
        """对 overview 做语义截断，避免 observation 过大被 memory 硬切破坏 JSON 结构。

        截断策略：各资源列表保留前 N 项，并附 truncated_*_count 告知 LLM "还有更多"；
        schemas 的 columns 也只列前 N 个（大宽表的关键体积来源）。
        小项目（各项均未超阈值）原样返回，零影响。
        """
        schemas = overview.get("schemas", [])
        truncated_schemas: list[dict[str, Any]] = []
        truncated_column_total = 0
        for schema in schemas[:_MAX_SCHEMAS_IN_OBSERVATION]:
            cols = schema.get("columns", [])
            if len(cols) > _MAX_COLUMNS_PER_SCHEMA:
                truncated_column_total += len(cols) - _MAX_COLUMNS_PER_SCHEMA
                schema = {**schema, "columns": cols[:_MAX_COLUMNS_PER_SCHEMA]}
            truncated_schemas.append(schema)

        constraints = overview.get("constraints", [])
        transforms = overview.get("transforms", [])
        regex_nodes = overview.get("regex_nodes", [])

        result: dict[str, Any] = {
            "schemas": truncated_schemas,
            "constraints": constraints[:_MAX_CONSTRAINTS_IN_OBSERVATION],
            "transforms": transforms[:_MAX_OTHER_NODES_IN_OBSERVATION],
            "regex_nodes": regex_nodes[:_MAX_OTHER_NODES_IN_OBSERVATION],
            "settings": overview.get("settings", {}),
        }

        # 截断计数：让 LLM 知道被省略了多少，需要详情时调 read_table
        result["truncated_schema_count"] = max(0, len(schemas) - _MAX_SCHEMAS_IN_OBSERVATION)
        result["truncated_constraint_count"] = max(0, len(constraints) - _MAX_CONSTRAINTS_IN_OBSERVATION)
        result["truncated_transform_count"] = max(0, len(transforms) - _MAX_OTHER_NODES_IN_OBSERVATION)
        result["truncated_regex_count"] = max(0, len(regex_nodes) - _MAX_OTHER_NODES_IN_OBSERVATION)
        result["truncated_column_count"] = truncated_column_total
        return result

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行项目概览读取

        参数:
            arguments: tool 参数（本工具无参数）

        返回:
            {"success": bool, "overview": {...}, "summary": {...}, "error": str}
            overview 形如 {"schemas": [...], "constraints": [...], "transforms": [...],
            "regex_nodes": [...], "settings": {...}, "truncated_*_count": int}
            大项目会语义截断（列表前 N 项 + 计数），详见 _truncate_overview。
        """
        # arguments 无参数，但保留接口一致性
        _ = arguments

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "overview": {}}

        try:
            # get_project_overview 是同步函数，放到线程池避免阻塞事件循环
            raw_overview = await asyncio.to_thread(get_project_overview, self.project_path)

            # 语义截断，避免 observation 被 memory 硬切破坏 JSON
            overview = self._truncate_overview(raw_overview)

            # 统计摘要（基于截断前的真实数量，让 LLM 判断项目真实规模）
            summary = {
                "schema_count": len(raw_overview.get("schemas", [])),
                "constraint_count": len(raw_overview.get("constraints", [])),
                "transform_count": len(raw_overview.get("transforms", [])),
                "regex_count": len(raw_overview.get("regex_nodes", [])),
            }
            return {"success": True, "overview": overview, "summary": summary}
        except Exception as e:
            logger.exception("read_project 工具执行失败")
            return {"success": False, "error": f"读取项目概览失败: {e}", "overview": {}}
