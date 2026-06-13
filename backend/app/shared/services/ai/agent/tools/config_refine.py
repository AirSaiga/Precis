"""@fileoverview 配置精修工具

Agent 可调用的工具：根据校验结果让 LLM 修正配置。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class ConfigRefineTool:
    """
    @classdesc 配置精修工具

    根据校验问题生成修正建议或修正后的配置。
    """

    NAME = "refine_config"

    def __init__(self, service: Any):
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
                "description": "根据校验结果修正配置，输出修正后的完整配置。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "config": {
                            "type": "object",
                            "description": "当前配置",
                        },
                        "issues": {
                            "type": "array",
                            "items": {"type": "object"},
                            "description": "校验发现的问题列表",
                        },
                        "strategy": {
                            "type": "string",
                            "description": "修正策略，如'relax'（放宽）、'remove'（删除）、'adjust'（调整参数）",
                            "enum": ["relax", "remove", "adjust", "auto"],
                        },
                    },
                    "required": ["config", "issues"],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行配置精修

        参数:
            arguments: tool 参数

        返回:
            {"success": bool, "config": {...}, "removed_rules": [...], "warnings": [...], "error": str}
        """
        config = arguments.get("config", {})
        issues = arguments.get("issues", [])
        strategy = arguments.get("strategy", "auto")

        if not issues:
            return {"success": True, "config": config, "removed_rules": [], "warnings": []}

        try:
            result = await self.service._refine_config_with_llm(
                config=config,
                issues=issues,
                strategy=strategy,
            )
            return {
                "success": True,
                "config": result.get("config", config),
                "removed_rules": result.get("removed_rules", []),
                "modified_rules": result.get("modified_rules", []),
                "warnings": result.get("warnings", []),
            }
        except Exception as e:
            logger.exception("配置精修工具执行失败")
            return {"success": False, "error": f"配置精修失败: {e}"}
