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
from app.shared.services.llm.actions.action_validator import ActionValidator
from app.shared.services.llm.actions.diff_compute import compute_action_diff
from app.shared.services.llm.actions.registry import (
    ACTION_COUNT,
    ACTION_ENUM,
    READ_ONLY_ACTION_TYPES,
)
from app.shared.services.llm.actions.validation_types import format_validation_result

# 延迟导入以避免循环依赖（streaming/__init__ → orchestrator → apply_actions → streaming）
# 在 _run_two_phase 内部 import ConfirmController / get_global_pending_interaction_store

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


# 纯读动作（无副作用），允许在无确认环境（非流式 /chat、CLI）直接执行。
# 从动作注册表派生，避免硬编码集合与注册表不同步。
_READ_ONLY_ACTION_TYPES = READ_ONLY_ACTION_TYPES


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
        job_id: str = "",
        user_message: str = "",
    ):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
            collected_instructions: runner 持有的累积列表引用，工具会把
                frontendInstructions 追加到此列表（共享可变引用）
            dry_run_enabled: 是否启用两阶段确认模式
            confirm_controller: （已废弃）旧的单 job 控制器；保留兼容但不再用于门控
            apply_callbacks: 事件回调集合（两阶段模式用）
            job_id: 当前任务 ID，用于生成 apply_id（"{job_id}#{seq}"）键控每次 apply 的独立确认
            user_message: 用户当前输入的原始消息，用于意图范围校验（防止 LLM 添加无关修改）
        """
        self.project_path = project_path
        self._collected_instructions = collected_instructions
        self._dry_run_enabled = dry_run_enabled
        self._apply_callbacks = apply_callbacks or ApplyCallbacks()
        self._job_id = job_id
        # user_message 保留注入（向后兼容 chat_agent_runner 调用），但 P2-1 后意图校验
        # 改用 LLM 自填的 intent_scope 做一致性比对，不再依赖 user_message 做关键词匹配。
        self._user_message = user_message or ""
        # 每次 _run_two_phase 自增，保证同一 job 内多次 apply 各有独立 apply_id
        self._apply_counter = 0

    def _extract_action_target(self, action: dict[str, Any]) -> tuple[str | None, str | None]:
        """从动作中提取目标表名和列名（如可提取）。"""
        action_type = action.get("actionType", "")
        spec: dict[str, Any] = {}
        table: str | None = None
        column: str | None = None

        if action_type in (
            "ADD_CONSTRAINT_NODE",
            "UPDATE_CONSTRAINT_NODE",
            "DELETE_CONSTRAINT_NODE",
        ):
            spec = action.get("constraintSpec", {}) or {}
            table = spec.get("tableName") or spec.get("targetNodeId")
            column = spec.get("targetColumn") or spec.get("targetColumnId")
        elif action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"):
            spec = action.get("schemaSpec", {}) or {}
            table = spec.get("name") or spec.get("schemaId") or spec.get("id")
        elif action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
            spec = action.get("transformSpec", {}) or {}
            table = spec.get("inputFromNode") or spec.get("inputNodeId")
            column = spec.get("inputColumn")
        elif action_type in ("ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"):
            # Regex 节点通常不直接绑定到具体表/列，不做强校验
            return None, None

        # 清洗字符串
        if table and isinstance(table, str):
            table = table.strip()
        if column and isinstance(column, str):
            column = column.strip()
        return table, column

    def _check_actions_match_intent(
        self, actions: list[dict[str, Any]], intent_scope: dict[str, Any] | None
    ) -> tuple[bool, str]:
        """意图范围校验（P2-1）：基于 LLM 自填的 intent_scope 做一致性比对。

        设计原则（替代旧的 user_message 关键词匹配）：
        - LLM 在调用 apply_actions 时显式声明 intent_scope（它理解的用户意图所涉及的表/列），
          后端只做确定性比对：每个写动作的 target 必须落在 LLM 自报的 scope 内。
        - 把"理解自然语言意图"的工作交给 LLM（它的强项），后端只做机械比对，彻底解决
          旧方案在中文场景（"邮箱"≠"email"）、通用词列名（id/name）、Regex 绕过等问题。
        - 幻觉性越界的 LLM 同样会老实填 intent_scope（它不知道自己在越界），后端比对恰好能抓出。
        - 只阻断写动作；只读动作（VALIDATE_PROJECT / ADD_TO_CANVAS）不阻断。
        - intent_scope 为空/未填时跳过校验（保持向后兼容，不破坏老调用）。
        - 校验失败时返回明确错误，帮助 LLM 自我修正（配合 P0-1 错误回灌）。

        参数:
            actions: 待执行的动作列表
            intent_scope: LLM 自报的意图范围，形如
                {"tables": ["users"], "columns": [{"table": "users", "column": "email"}]}

        返回:
            (ok, error)：ok=False 时 error 含越界详情
        """
        # intent_scope 未填或为空 → 不限制（保持向后兼容）
        if not intent_scope:
            return True, ""

        scope_tables_raw = intent_scope.get("tables") or []
        scope_columns_raw = intent_scope.get("columns") or []

        # 归一化 scope 表名集合（小写比对，消除大小写差异）
        scope_tables: set[str] = {str(t).strip().lower() for t in scope_tables_raw if str(t).strip()}
        # 归一化 scope 列集合：{(table_lower, column_lower)}
        scope_columns: set[tuple[str, str]] = set()
        for col_entry in scope_columns_raw:
            if isinstance(col_entry, dict):
                tbl = str(col_entry.get("table", "")).strip().lower()
                col = str(col_entry.get("column", "")).strip().lower()
                if tbl and col:
                    scope_columns.add((tbl, col))
            elif isinstance(col_entry, str):
                # 宽容格式："table.column"
                if "." in col_entry:
                    tbl, col = col_entry.split(".", 1)
                    scope_columns.add((tbl.strip().lower(), col.strip().lower()))

        # scope 全空（LLM 填了字段但没内容）→ 不限制，避免误拦
        if not scope_tables and not scope_columns:
            return True, ""

        # 检查每个写动作的 target 是否落在 scope 内
        for action in actions:
            action_type = action.get("actionType", "")
            if action_type in _READ_ONLY_ACTION_TYPES:
                continue

            target_table, target_column = self._extract_action_target(action)
            # 无法提取目标（如 Regex 独立节点）→ 不参与 scope 比对，放行
            if not target_table and not target_column:
                continue

            target_table_lower = (target_table or "").lower()
            target_column_lower = (target_column or "").lower()

            # 命中规则（按 scope 粒度从严到宽）：
            # 1) scope 含列级声明 + 动作有列目标 → 必须精确命中列级 (table, column)。
            #    表级放行在此场景无效，否则"用户提到 email 列"时 age 列会因同表被误放行。
            # 2) 动作只有表级目标（如 ADD_SCHEMA）→ 命中 scope_tables，或在 scope_columns 的表集合内。
            # 3) 动作有列目标但 scope 只声明了表级 → 命中 scope_tables 即放行（列级未声明不强制）。
            scope_column_tables = {tbl for tbl, _ in scope_columns}
            in_column_scope = (
                bool(target_table_lower)
                and bool(target_column_lower)
                and (target_table_lower, target_column_lower) in scope_columns
            )
            in_table_scope = bool(target_table_lower) and target_table_lower in scope_tables
            in_column_table_scope = bool(target_table_lower) and target_table_lower in scope_column_tables

            # scope 含列级声明 且 动作有列目标 → 必须命中列级（最严）
            requires_column_match = bool(scope_columns) and bool(target_column_lower)
            ok = in_column_scope if requires_column_match else (in_table_scope or in_column_table_scope)

            if not ok:
                # 构造越界错误信息，列出 LLM 自报的 scope 帮助它理解边界
                scope_desc_parts: list[str] = []
                if scope_tables:
                    scope_desc_parts.append(f"表 {sorted(scope_tables)}")
                if scope_columns:
                    cols_desc = [f"{t}.{c}" for t, c in sorted(scope_columns)]
                    scope_desc_parts.append(f"列 {cols_desc}")
                scope_desc = "、".join(scope_desc_parts)
                target_desc = target_column_lower or target_table_lower
                return (
                    False,
                    f"动作 {action_type} 针对的 '{target_desc}' 不在你声明的 intent_scope 内"
                    f"（scope: {scope_desc}）。请只修改 intent_scope 内的资源，"
                    "或更新 intent_scope 以覆盖该动作的目标。",
                )

        return True, ""

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
                    "当用户说'拖到画布'、'放到画布'、'显示在画布上'时，"
                    "必须显式使用 actionType=ADD_TO_CANVAS（不是 ADD_SCHEMA/ADD_REGEX 等）。"
                    "重要约束：actions 列表只能包含用户当前明确请求的修改，"
                    "禁止主动添加、修改或删除无关的约束、表、正则节点或转换节点。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "actions": {
                            "type": "array",
                            "description": (
                                "要执行的动作列表。每个元素必须含 actionType 和对应的 spec 字段：\n"
                                "- 约束动作（actionType=ADD/UPDATE/DELETE_CONSTRAINT_NODE）→ constraintSpec\n"
                                "- Schema 动作（actionType=ADD/UPDATE/DELETE_SCHEMA）→ schemaSpec\n"
                                "- 正则动作（actionType=ADD/UPDATE/DELETE_REGEX）→ regexSpec\n"
                                "- 转换动作（actionType=ADD/UPDATE/DELETE_TRANSFORM）→ transformSpec\n"
                                "- 设置动作（actionType=UPDATE_SETTINGS）→ settingsSpec\n"
                                "- 校验动作（actionType=VALIDATE_PROJECT）→ constraintSpec（含 tableName）\n"
                                "- 显示到画布（actionType=ADD_TO_CANVAS）→ canvasSpec（把已存在的配置显示到画布，不写盘）\n"
                                "注意字段名是 constraintSpec/schemaSpec 等（不是 spec）。"
                            ),
                            "items": {
                                "type": "object",
                                "properties": {
                                    "actionType": {
                                        "type": "string",
                                        # enum 从注册表派生，新增动作自动出现，消灭"漏条目"bug
                                        "enum": list(ACTION_ENUM),
                                        "description": f"动作类型（{ACTION_COUNT} 种）。",
                                    },
                                },
                                "required": ["actionType"],
                            },
                        },
                        "intent_scope": {
                            "type": "object",
                            "description": (
                                "本次请求的目标范围声明（强烈建议填写，用于防止越界修改）。"
                                "声明你理解的用户意图所涉及的表和列，后端会校验 actions 中的写动作"
                                "目标是否全部落在此范围内——这是防止你误加无关修改的安全门。\n"
                                "例：用户说'给 email 加格式校验'，intent_scope 应填 "
                                '{"tables":["users"],"columns":[{"table":"users","column":"email"}]}\n'
                                "注意：把自然语言理解（如中文'邮箱'='email'）的工作放在你这里完成，"
                                "后端只做表名/列名的精确比对。"
                            ),
                            "properties": {
                                "tables": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "涉及的表名（schema 的 name 或 id）",
                                },
                                "columns": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "table": {"type": "string", "description": "表名"},
                                            "column": {"type": "string", "description": "列名"},
                                        },
                                        "required": ["table", "column"],
                                    },
                                    "description": "涉及的精确列（table + column）",
                                },
                            },
                        },
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

        # 意图范围校验（P2-1）：基于 LLM 自填的 intent_scope 做一致性比对，
        # 防止 LLM 越界修改无关资源。intent_scope 为空时跳过（向后兼容）。
        intent_scope = arguments.get("intent_scope")
        intent_ok, intent_error = self._check_actions_match_intent(actions, intent_scope)
        if not intent_ok:
            logger.warning(f"[apply_actions] 意图范围校验失败：{intent_error}")
            return {
                "success": False,
                "error": f"动作超出用户请求范围：{intent_error}",
                "results": [],
            }

        # 预验证：在 dry-run / 写盘前拦截非法动作（表/列不存在、约束类型不支持、参数缺失等）。
        # 采用全有或全无语义——任一动作有 error 即整批拒绝，把含 "did you mean" 建议的错误清单
        # 回灌给 LLM 以便自我修正。warnings 不阻止执行（对齐 ValidationResult 设计）。
        validator = ActionValidator(self.project_path)
        validation = validator.validate(actions)
        if validation.has_errors:
            formatted = format_validation_result(validation)
            logger.warning(f"[apply_actions] 预验证失败，拒绝执行：\n{formatted}")
            return {
                "success": False,
                "error": f"动作预验证失败，未执行任何修改：\n{formatted}",
                "results": [],
                "validation_errors": len(validation.errors),
            }

        # 判断是否进入两阶段确认模式（dry_run_enabled 即两阶段；不再依赖单 job controller）
        two_phase = self._dry_run_enabled

        # 分流只读动作（ADD_TO_CANVAS / VALIDATE_PROJECT）：无论是否 two_phase，
        # 只读动作都不写盘、不需用户确认，直接执行。
        # 这避免"拖入画布"这类只读操作弹出不必要的确认框（且确认框内容为空 diff，令人困惑）。
        read_only_actions = [a for a in actions if a.get("actionType", "") in _READ_ONLY_ACTION_TYPES]
        write_actions = [a for a in actions if a.get("actionType", "") not in _READ_ONLY_ACTION_TYPES]

        # 先执行只读动作（如果有），结果累积到 combined
        combined_results: list[dict[str, Any]] = []
        read_only_result: dict[str, Any] | None = None
        if read_only_actions:
            read_only_result = await self._run_legacy(read_only_actions)
            if read_only_result.get("success"):
                combined_results.extend(read_only_result.get("results", []))
            else:
                # 只读动作失败则整体返回（全有或全无语义）
                return read_only_result

        # 无写盘动作：只读动作已执行完毕，直接返回合并结果
        if not write_actions:
            return {
                "success": True,
                "results": combined_results,
                "instructions_collected": len(self._collected_instructions),
            }

        if not two_phase:
            # 无确认环境（非流式 /chat、CLI ai ask）：对写操作 fail-closed
            logger.warning("[apply_actions] 无确认环境拒绝写操作（fail-closed）")
            return {
                "success": False,
                "error": "此环境不支持自动写盘（无确认门），请在对话界面操作以获得用户确认。",
                "results": combined_results,
            }

        # 写盘动作走两阶段确认；只读动作的结果已累积，最终合并返回
        write_result = await self._run_two_phase(write_actions)
        # 合并只读 + 写盘的结果
        if combined_results:
            merged_results = combined_results + write_result.get("results", [])
            write_result["results"] = merged_results
        return write_result

    async def _run_legacy(self, actions: list[dict[str, Any]]) -> dict[str, Any]:
        """legacy 直写模式：仅用于纯读动作（VALIDATE_PROJECT），直接执行。"""
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

        每次 apply_actions 调用创建独立的 ConfirmController（按 apply_id 键控），
        避免旧实现"每 job 一个 controller + Event 单次锁存"导致第 2 个 apply 免确认。

        阶段 1: shadow-copy dry-run 计算 diff（不碰真实项目）
        阶段 2: 用户 confirm 后真实写盘；reject 则不写
        """
        # 为本次 apply 生成独立 apply_id，创建全新 controller（不复用旧决策）
        self._apply_counter += 1
        # 加 #apply# 类型前缀，与 ask 的 "{job_id}#ask#{seq}" 对称，便于 store 按 job 维度批量清理
        apply_id = f"{self._job_id}#apply#{self._apply_counter}" if self._job_id else f"apply#{self._apply_counter}"
        # 延迟导入避免循环依赖（streaming 包 init 链 → apply_actions）
        from app.shared.services.ai.streaming.pending_interaction_store import (
            ConfirmController,
            get_global_pending_interaction_store,
        )

        controller = ConfirmController(request_id=apply_id)
        pending_store = get_global_pending_interaction_store()
        pending_store.put(apply_id, controller)

        try:
            # 阶段 1: dry-run 计算 diff
            try:
                diff_result = await asyncio.to_thread(compute_action_diff, actions, self.project_path)
            except Exception as e:
                logger.exception("apply_actions dry-run 失败")
                return {"success": False, "error": f"dry-run 失败: {e}", "results": []}

            if not diff_result.success:
                return {"success": False, "error": diff_result.error or "dry-run 失败", "results": []}

            # 构建 pending payload，发给前端展示（含 apply_id 供前端回传）
            pending_payload: dict[str, Any] = {
                "apply_id": apply_id,
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

            # 等待用户决策（协程挂起）——每次调用独立 controller，不受历史决策影响
            decision = await controller.await_decision()

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
            # 注意：用 .get("actionType", "validate") 容缺（validate_details 条目无 actionType，否则 KeyError）
            if self._apply_callbacks.on_apply_confirmed:
                self._apply_callbacks.on_apply_confirmed(
                    {
                        "success": all_success,
                        "actions_count": len(actions),
                        "results": [
                            {"actionType": r.get("actionType", "validate"), "success": r.get("success", False)}
                            for r in summarized_results
                        ],
                    }
                )

            return {
                "success": all_success,
                "results": summarized_results,
                "instructions_collected": len(self._collected_instructions),
            }
        finally:
            # 无论 confirm/reject/timeout/异常，都清理本次 apply 的 controller（避免 store 泄漏）
            pending_store.pop(apply_id)
