"""@fileoverview ask_user 工具

Chat mini-agent 可调用的工具：在 loop 中途向用户提问。

支持 4 种 question_type:
1. free_text — 开放提问，用户输入任意文本
2. choice — 消歧/选方案，单选或多选
3. value — 补参数，结构化输入（带类型校验）
4. confirm — 非写盘意图确认（yes/no）

机制：
- 创建 InteractionController，注册到 pending_interaction_store
- emit user_input_requested 事件（前端渲染 AskUserCard）
- await controller.await_response() 挂起（最多 5 分钟）
- 用户通过 /respond 端点回答 → resolve 唤醒
- observation {answer: ...} 或 {skipped: true} 回灌 LLM，loop 继续

非流式环境（dry_run_enabled=False）fail-closed：不挂起，直接返回 unsupported。

注意：InteractionController / get_global_pending_interaction_store 采用延迟导入
（在 run() 内 import），与 apply_actions.py 一致，避免循环依赖：
streaming/__init__ → orchestrator → chat_tools/__init__ → ask_user → streaming
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# 允许的提问类型
_QUESTION_TYPES = ("free_text", "choice", "value", "confirm")
# value 类型允许的值类型
_VALUE_TYPES = ("string", "integer", "float", "boolean")


@dataclass
class AskCallbacks:
    """ask_user 工具的回调集合，由 orchestrator 注入以实现事件桥接。"""

    on_user_input_requested: Callable[[dict[str, Any]], None] | None = None
    on_user_responded: Callable[[dict[str, Any]], None] | None = None


class AskUserTool:
    """让 agent 在 loop 中途向用户提问。"""

    NAME = "ask_user"

    def __init__(
        self,
        job_id: str,
        ask_callbacks: AskCallbacks | None = None,
        dry_run_enabled: bool = False,
    ):
        """
        @methoddesc 初始化工具

        参数:
            job_id: 当前任务 ID，用于生成 ask_id（"{job_id}#ask#{seq}"）
            ask_callbacks: 事件回调集合
            dry_run_enabled: 是否启用交互（仅流式路径 True；非流式 fail-closed）
        """
        self._job_id = job_id
        self._ask_callbacks = ask_callbacks or AskCallbacks()
        self._dry_run_enabled = dry_run_enabled
        self._ask_counter = 0

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "向用户提问以获取澄清、消歧或缺失信息。仅当无法通过 read_project/read_table/read_canvas "
                    "自行获取信息、或存在多方案需要用户抉择时调用。能自己查到的不要问。"
                    "返回用户的回答或 skipped=true（用户跳过/超时/环境不支持）。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question_type": {
                            "type": "string",
                            "enum": list(_QUESTION_TYPES),
                            "description": "提问类型",
                        },
                        "prompt": {
                            "type": "string",
                            "description": "给用户看的问题文本",
                        },
                        "options": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "value": {"type": "string"},
                                    "description": {"type": "string"},
                                },
                                "required": ["label", "value"],
                            },
                            "description": "choice 类型必填：候选项列表",
                        },
                        "multiple": {
                            "type": "boolean",
                            "description": "choice 类型：是否多选（默认 false）",
                        },
                        "value_type": {
                            "type": "string",
                            "enum": list(_VALUE_TYPES),
                            "description": "value 类型必填：期望的值类型",
                        },
                        "placeholder": {
                            "type": "string",
                            "description": "输入框占位提示（可选，free_text/value 用）",
                        },
                        "optional": {
                            "type": "boolean",
                            "description": "value 类型：是否允许留空（默认 false）",
                        },
                    },
                    "required": ["question_type", "prompt"],
                },
            },
        }

    def _validate_args(self, arguments: dict[str, Any]) -> str | None:
        """校验参数完整性。返回错误描述或 None。"""
        qt = arguments.get("question_type")
        if qt not in _QUESTION_TYPES:
            return f"非法 question_type: {qt}"
        if qt == "choice":
            opts = arguments.get("options")
            if not opts or not isinstance(opts, list) or len(opts) < 1:
                return "choice 类型必须提供至少一个 options"
        if qt == "value":
            vt = arguments.get("value_type")
            if vt not in _VALUE_TYPES:
                return "value 类型必须提供合法 value_type"
        return None

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行提问

        参数:
            arguments: tool 参数，含 question_type/prompt 及类型相关字段

        返回:
            {"success": bool, "answer": {...}}
            answer 为用户回答 {answer: ...} 或跳过 {skipped: true, reason: ...}
        """
        question_type = arguments.get("question_type")
        prompt = arguments.get("prompt", "")

        # 参数校验
        err = self._validate_args(arguments)
        if err:
            logger.warning("[ask_user] 参数校验失败: %s", err)
            return {
                "success": False,
                "error": err,
                "answer": {"skipped": True, "reason": "bad_args"},
            }

        # 非流式环境 fail-closed
        if not self._dry_run_enabled:
            return {
                "success": False,
                "unsupported": True,
                "error": "此环境不支持交互问答，请基于已知信息回答",
                "answer": {"skipped": True, "reason": "unsupported_env"},
            }

        # 延迟导入避免循环依赖（streaming/__init__ → orchestrator → chat_tools → streaming）
        # 与 apply_actions.py 的 _run_two_phase 一致：在方法内 import
        from app.shared.services.ai.streaming.pending_interaction_store import (
            InteractionController,
            get_global_pending_interaction_store,
        )

        # 创建门控，生成独立 ask_id
        self._ask_counter += 1
        ask_id = f"{self._job_id}#ask#{self._ask_counter}" if self._job_id else f"ask#{self._ask_counter}"
        controller = InteractionController(request_id=ask_id, pending_payload=arguments)
        store = get_global_pending_interaction_store()
        store.put(ask_id, controller)

        try:
            # emit user_input_requested（携带 question schema 给前端）
            request_payload: dict[str, Any] = {
                "ask_id": ask_id,
                "question_type": question_type,
                "prompt": prompt,
            }
            for k in ("options", "multiple", "value_type", "placeholder", "optional"):
                if k in arguments:
                    request_payload[k] = arguments[k]

            if self._ask_callbacks.on_user_input_requested:
                self._ask_callbacks.on_user_input_requested(request_payload)

            # 挂起等待用户回答
            response = await controller.await_response()

            # emit user_responded（让前端清态）
            if self._ask_callbacks.on_user_responded:
                self._ask_callbacks.on_user_responded(
                    {
                        "ask_id": ask_id,
                        "response": response,
                    }
                )

            return {"success": True, "answer": response}
        finally:
            # 无论回答/跳过/超时/异常，都清理本次 ask 的 controller
            store.pop(ask_id)
