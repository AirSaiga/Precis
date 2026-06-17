"""@fileoverview apply_actions 工具

Chat mini-agent 可调用的工具：执行配置修改动作。

复用 process_actions 统一入口，执行 LLM 生成的 actions 列表
（约束/Schema/Regex/Transform/Settings/Validate 六类）。
关键机制：工具内部把 process_actions 产出的 frontendInstructions
旁路累积到 runner.collected_instructions，供 orchestrator 最终
注入 ChatExecutionResult.frontend_instructions，实现前端画布双写。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.llm.actions.action_processor import process_actions

logger = logging.getLogger(__name__)


class ApplyActionsTool:
    """
    @classdesc 执行配置修改动作工具

    封装 process_actions，同时旁路收集 frontendInstructions。
    """

    NAME = "apply_actions"

    def __init__(self, project_path: str, collected_instructions: list[Any]):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
            collected_instructions: runner 持有的累积列表引用，工具会把
                frontendInstructions 追加到此列表（共享可变引用）
        """
        self.project_path = project_path
        # 共享引用：runner 创建的列表，工具 append，runner 最终读取
        self._collected_instructions = collected_instructions

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "执行配置修改动作。当用户明确要求添加/修改/删除约束、表结构、"
                    "正则节点、转换节点或修改项目设置时调用此工具。"
                    "actions 数组中的每个元素必须包含 actionType 和对应的 spec 字段。"
                    "执行成功后，改动会立即写入项目文件并同步到画布。"
                    "如果是纯查询类问题（如'有哪些表'），不要调用此工具，改用 read_project。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "actions": {
                            "type": "array",
                            "description": "要执行的动作列表",
                            "items": {
                                "type": "object",
                                "description": (
                                    "单个动作，必须含 actionType 字段。"
                                    "动作类型: ADD/UPDATE/DELETE_CONSTRAINT_NODE, "
                                    "ADD/UPDATE/DELETE_SCHEMA, ADD/UPDATE/DELETE_REGEX, "
                                    "ADD/UPDATE/DELETE_TRANSFORM, UPDATE_SETTINGS, VALIDATE_PROJECT。"
                                    "约束动作需 constraintSpec，Schema 动作需 schemaSpec，以此类推。"
                                ),
                            },
                        }
                    },
                    "required": ["actions"],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行配置修改动作

        参数:
            arguments: tool 参数，包含 actions 列表

        返回:
            {"success": bool, "results": [...], "error": str}
            results 为每个动作的执行结果摘要（不含 frontendInstructions，避免污染 observation）
        """
        actions = arguments.get("actions", [])
        if not isinstance(actions, list) or not actions:
            return {"success": False, "error": "actions 必须是非空数组", "results": []}

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "results": []}

        try:
            # process_actions 是同步函数（含文件 I/O + 备份回滚），放到线程池执行
            process_result = await asyncio.to_thread(process_actions, actions, self.project_path)
        except Exception as e:
            logger.exception("apply_actions 工具执行失败")
            return {"success": False, "error": f"执行动作失败: {e}", "results": []}

        all_success = process_result.get("success", False)
        raw_results = process_result.get("results", [])

        # 关键：旁路收集 frontendInstructions 到 runner 共享列表
        # 返回给 LLM 的 observation 只含摘要，不含 frontendInstructions
        summarized_results = []
        for r in raw_results:
            # 累积前端指令（供 orchestrator 注入响应）
            frontend_instruction = r.get("frontendInstructions")
            if frontend_instruction:
                self._collected_instructions.append(frontend_instruction)

            # 构建给 LLM 看的摘要
            action = r.get("action", {})
            summarized_results.append(
                {
                    "actionType": action.get("actionType", "unknown"),
                    "success": r.get("success", False),
                    "message": r.get("message", ""),
                }
            )

        # 附加校验类动作的详细结果（如果有）
        for r in raw_results:
            if r.get("validate_details"):
                summarized_results.append({"validate_details": r["validate_details"]})

        return {
            "success": all_success,
            "results": summarized_results,
            "instructions_collected": len(self._collected_instructions),
        }
