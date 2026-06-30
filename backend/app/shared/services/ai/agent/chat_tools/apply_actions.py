"""@fileoverview apply_actions 工具

Chat mini-agent 可调用的工具：执行配置修改动作。

支持两种模式:
1. 两阶段确认（dry_run_enabled=True + confirm_controller 注入）:
   dry-run shadow-copy → diff → await 用户确认 → 落盘
2. legacy 直写（dry_run_enabled=False 或无 controller）:
   直接 process_actions 写盘，行为与改造前一致。

关键机制：工具内部把 process_actions 产出的 frontendInstructions
旁路累积到 runner.collected_instructions，供 orchestrator 最终
注入 ChatExecutionResult.frontend_instructions，实现前端画布双写。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.shared.services.llm.actions.action_processor import process_actions
from app.shared.services.llm.actions.diff_compute import compute_action_diff

logger = logging.getLogger(__name__)

# 默认以 legacy 模式运行（dry_run_enabled=False），确保未注入时不改变行为
_DRY_RUN_ENABLED_DEFAULT = False


@dataclass
class ApplyCallbacks:
    """apply_actions 工具的回调集合，由 orchestrator 注入以实现事件桥接。"""

    on_apply_pending: Callable[[dict[str, Any]], None] | None = None
    on_apply_confirmed: Callable[[dict[str, Any]], None] | None = None
    on_apply_rejected: Callable[[dict[str, Any]], None] | None = None
    # 流式画布生长：确认落盘后逐条 emit 单条 frontend_instruction，
    # payload 形如 {"instruction": {...单条指令对象...}}，前端收到即执行 + fitView。
    on_frontend_instruction: Callable[[dict[str, Any]], None] | None = None


def _summarize_results(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """从 process_actions 原始结果提取 LLM 摘要(不含 frontendInstructions)。"""
    summarized = []
    for r in raw_results:
        action = r.get("action", {})
        summarized.append(
            {
                "actionType": action.get("actionType", "unknown"),
                "success": r.get("success", False),
                "message": r.get("message", ""),
            }
        )
    for r in raw_results:
        if r.get("validate_details"):
            summarized.append({"validate_details": r["validate_details"]})
    return summarized


def _collect_instructions(raw_results: list[dict[str, Any]], target_list: list[Any]) -> None:
    """从 raw_results 中提取 frontendInstructions 并追加到 target_list。"""
    for r in raw_results:
        fi = r.get("frontendInstructions")
        if fi:
            target_list.append(fi)


class ApplyActionsTool:
    """
    @classdesc 执行配置修改动作工具

    封装 process_actions，同时旁路收集 frontendInstructions。
    支持两阶段确认模式。
    """

    NAME = "apply_actions"

    def __init__(
        self,
        project_path: str,
        collected_instructions: list[Any],
        dry_run_enabled: bool = _DRY_RUN_ENABLED_DEFAULT,
        confirm_controller: Any | None = None,
        apply_callbacks: ApplyCallbacks | None = None,
    ):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
            collected_instructions: runner 持有的累积列表引用，工具会把
                frontendInstructions 追加到此列表（共享可变引用）
            dry_run_enabled: 是否启用两阶段确认模式
            confirm_controller: 确认门控制器（两阶段模式必需）
            apply_callbacks: 事件回调集合（两阶段模式用）
        """
        self.project_path = project_path
        self._collected_instructions = collected_instructions
        self._dry_run_enabled = dry_run_enabled
        self._confirm_controller = confirm_controller
        self._apply_callbacks = apply_callbacks or ApplyCallbacks()

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "执行配置修改动作。当用户明确要求添加/修改/删除约束、表结构、"
                    "正则节点、转换节点、把已有资源放到画布上或修改项目设置时调用此工具。"
                    "actions 数组中的每个元素必须包含 actionType 和对应的 spec 字段。"
                    "执行成功后，改动会立即写入项目文件并同步到画布。"
                    "如果是纯查询类问题（如'有哪些表'），不要调用此工具，改用 read_project。"
                    "注意：项目配置文件里存在的表/约束/正则，不一定已经在画布上显示；"
                    "当用户说'拖到画布'、'放到画布'、'显示在画布上'时，应使用本工具的 ADD 动作。"
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

        # 判断是否进入两阶段确认模式
        two_phase = self._dry_run_enabled and self._confirm_controller is not None

        if not two_phase:
            return await self._run_legacy(actions)

        return await self._run_two_phase(actions)

    async def _run_legacy(self, actions: list[dict[str, Any]]) -> dict[str, Any]:
        """legacy 直写模式：直接 process_actions 落盘（行为与改造前一致）。"""
        try:
            process_result = await asyncio.to_thread(process_actions, actions, self.project_path)
        except Exception as e:
            logger.exception("apply_actions 工具执行失败")
            return {"success": False, "error": f"执行动作失败: {e}", "results": []}

        all_success = process_result.get("success", False)
        raw_results = process_result.get("results", [])

        _collect_instructions(raw_results, self._collected_instructions)
        summarized_results = _summarize_results(raw_results)

        return {
            "success": all_success,
            "results": summarized_results,
            "instructions_collected": len(self._collected_instructions),
        }

    async def _run_two_phase(self, actions: list[dict[str, Any]]) -> dict[str, Any]:
        """两阶段确认模式：dry-run → await 用户决策 → 落盘/跳过。

        阶段 1: shadow-copy dry-run 计算 diff（不碰真实项目）
        阶段 2: 用户 confirm 后真实写盘；reject 则不写
        """
        # 阶段 1: dry-run 计算 diff
        try:
            diff_result = await asyncio.to_thread(compute_action_diff, actions, self.project_path)
        except Exception as e:
            logger.exception("apply_actions dry-run 失败")
            return {"success": False, "error": f"dry-run 失败: {e}", "results": []}

        if not diff_result.success:
            return {"success": False, "error": diff_result.error or "dry-run 失败", "results": []}

        # 构建 pending payload，发给前端展示
        pending_payload: dict[str, Any] = {
            "files": [
                {
                    "path": f.path,
                    "status": f.status,
                    "diff": f.diff,
                    "before_preview": f.before_preview,
                    "after_preview": f.after_preview,
                }
                for f in diff_result.files
            ],
            "summary": diff_result.summary,
            "success": diff_result.success,
            "error": diff_result.error,
        }

        # 通过回调 emit apply_pending 事件（非阻塞）
        if self._apply_callbacks.on_apply_pending:
            self._apply_callbacks.on_apply_pending(pending_payload)

        # 等待用户决策（协程挂起）
        assert self._confirm_controller is not None
        decision = await self._confirm_controller.await_decision()

        if decision != "confirm":
            # 拒绝/超时：不写盘，返回明确的非成功状态（success=False）
            # 避免 LLM 看到 success=True 误报"已为您添加约束"
            if self._apply_callbacks.on_apply_rejected:
                self._apply_callbacks.on_apply_rejected({"reason": "user_rejected", "decision": decision})
            return {
                "success": False,
                "skipped": True,
                "reason": f"用户选择{decision}，未写入文件",
                "results": [],
            }

        # 确认：真实写盘
        try:
            process_result = await asyncio.to_thread(process_actions, actions, self.project_path)
        except Exception as e:
            logger.exception("apply_actions 确认后写盘失败")
            return {"success": False, "error": f"写盘失败: {e}", "results": []}

        all_success = process_result.get("success", False)
        raw_results = process_result.get("results", [])

        _collect_instructions(raw_results, self._collected_instructions)
        summarized_results = _summarize_results(raw_results)

        # 收集 dry-run 阶段的 frontend_instructions（写盘后可能已变化，但仍保留）
        for fi in diff_result.frontend_instructions:
            self._collected_instructions.append(fi)

        # 流式画布生长：逐条 emit 写盘产出的 frontend_instruction。
        # 仅取 raw_results 中实际落盘的单条指令（已 disk-committed），
        # 每条 payload 形如 {"instruction": {...}}，前端收到即 processFrontendInstructions + fitView。
        # 注意：completed 事件仍携带全量 instructions 作为兜底，前端负责去重避免重复应用。
        if self._apply_callbacks.on_frontend_instruction:
            for r in raw_results:
                fi = r.get("frontendInstructions")
                if fi:
                    self._apply_callbacks.on_frontend_instruction({"instruction": fi})

        # 通过回调 emit apply_confirmed 事件
        if self._apply_callbacks.on_apply_confirmed:
            self._apply_callbacks.on_apply_confirmed(
                {
                    "success": all_success,
                    "actions_count": len(actions),
                    "results": [{"actionType": r["actionType"], "success": r["success"]} for r in summarized_results],
                }
            )

        return {
            "success": all_success,
            "results": summarized_results,
            "instructions_collected": len(self._collected_instructions),
        }
