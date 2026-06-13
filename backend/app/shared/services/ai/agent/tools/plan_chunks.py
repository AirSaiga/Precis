"""@fileoverview 分块规划工具

Agent 可调用的工具：根据数据画像输出分块执行计划。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.ai.agent.planner import build_chunk_plan, plan_to_dict


class PlanChunksTool:
    """
    @classdesc 分块规划工具

    根据数据画像自动决定分块策略。
    """

    NAME = "plan_chunks"

    def __init__(self, profiling_data: list[dict], file_paths: list[str], chunk_max_columns: int, chunk_max_files: int):
        """
        @methoddesc 初始化工具

        参数:
            profiling_data: 数据画像
            file_paths: 文件路径列表
            chunk_max_columns: 每个 chunk 最大列数
            chunk_max_files: 每个 chunk 最大文件数
        """
        self.profiling_data = profiling_data
        self.file_paths = file_paths
        self.chunk_max_columns = chunk_max_columns
        self.chunk_max_files = chunk_max_files

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": "根据数据画像生成分块执行计划，用于大数据量场景。",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        }

    def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行分块规划

        返回:
            {"success": bool, "plan": {...}}
        """
        plan = build_chunk_plan(
            self.profiling_data,
            self.file_paths,
            max_columns_per_chunk=self.chunk_max_columns,
            max_files_per_chunk=self.chunk_max_files,
        )
        return {"success": True, "plan": plan_to_dict(plan)}
