"""@fileoverview 配置生成工具

Agent 可调用的工具：根据数据画像生成 Precis V2 配置。
支持按 scope 生成局部配置，也支持基于上一轮结果增量生成。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.shared.services.llm.generation.service import ConfigGenerationService

logger = logging.getLogger(__name__)


class ConfigGenerateTool:
    """
    @classdesc 配置生成工具

    封装 build_prompt + LLM 调用 + build_config。
    """

    NAME = "generate_config"

    def __init__(self, service: ConfigGenerationService):
        """
        @methoddesc 初始化工具

        参数:
            service: ConfigGenerationService 实例
        """
        self.service = service

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "根据数据画像生成或修正 Precis V2 项目配置（schemas、constraints、regex_nodes）。"
                    "这是最终输出工具：调用成功后，返回的 config 会被 Agent 直接作为最终结果返回给用户，"
                    "不需要再输出 JSON 文本或调用其他工具。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "object",
                            "description": "生成范围，包含 file_paths、columns 等",
                            "properties": {
                                "file_paths": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "要分析的文件路径列表",
                                },
                                "columns": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "可选，仅分析指定列（格式：table.column）",
                                },
                                "table_names": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "可选，仅分析指定表",
                                },
                            },
                        },
                        "instructions": {
                            "type": "string",
                            "description": "生成指令，如'尽量只生成关键规则'、'补充缺失的外键规则'等",
                        },
                        "previous_config": {
                            "type": "object",
                            "description": "可选，上一轮生成的配置，用于增量修正",
                        },
                    },
                    "required": ["scope"],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行配置生成

        参数:
            arguments: tool 参数

        返回:
            {"success": bool, "config": {...}, "warnings": [...], "error": str}
        """
        scope = arguments.get("scope", {})
        instructions = arguments.get("instructions", "")
        previous_config = arguments.get("previous_config")

        file_paths = scope.get("file_paths", self.service._file_paths)
        if not file_paths:
            return {"success": False, "error": "未指定数据文件路径"}

        try:
            result = await self.service._generate_config_for_scope(
                file_paths=file_paths,
                instructions=instructions,
                previous_config=previous_config,
                scope=scope,
            )
            return {
                "success": True,
                "config": result,
                "warnings": result.get("warnings", []),
                "is_final_config": True,
            }
        except Exception as e:
            logger.exception("配置生成工具执行失败")
            return {"success": False, "error": f"配置生成失败: {e}"}
