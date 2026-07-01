"""@fileoverview apply_actions 两阶段确认单元测试

覆盖:
- legacy 分支(dry_run_enabled=False 或 无 controller)行为与改造前一致
- confirm → 写盘 + frontend_instructions
- reject → 不写 + skipped:true
- dry-run 失败透传
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyActionsTool, ApplyCallbacks
from app.shared.services.ai.streaming.pending_apply_store import ConfirmController
from app.shared.services.llm.actions.diff_compute import DiffResult


def make_inline_not_null_action(table: str = "users", column: str = "email", table_id: str = "sc_users") -> dict:
    return {
        "actionType": "ADD_CONSTRAINT_NODE",
        "constraintSpec": {
            "type": "NotNull",
            "tableName": table,
            "targetNodeId": table_id,
            "targetColumn": column,
            "isInline": True,
            "constraintFile": f"schemas/{table}.schema.yaml",
        },
    }


def make_diff_result(success: bool = True, files: list | None = None, instructions: list | None = None) -> DiffResult:
    """工厂函数：构造 DiffResult。"""
    from app.shared.services.llm.actions.diff_compute import FileDiff

    return DiffResult(
        success=success,
        files=files or [FileDiff(path="schemas/users.schema.yaml", status="modified", diff="fake diff")],
        summary={"modified": 1},
        frontend_instructions=instructions or [],
        error=None if success else "dry-run failed",
    )


def make_test_workspace(tmp_path) -> str:
    """创建临时项目目录(含真实可校验的 schema 文件)。

    schema 必须含 id + columns，否则接入 ActionValidator 后合法动作会被误判为 table/column_not_found。
    """
    ws = tmp_path / "project"
    ws.mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: test\n  name: Test\nschemas: []\n", encoding="utf-8"
    )
    schemas_dir = ws / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text(
        "id: sc_users\nname: users\ncolumns:\n  - id: col_email\n    name: email\n    type: string\n",
        encoding="utf-8",
    )
    return str(ws)


# =============================================================================
# Legacy 分支测试
# =============================================================================


class TestLegacyBranch:
    """无确认环境（dry_run_enabled=False）：对写操作 fail-closed，仅放行纯读动作（VALIDATE_PROJECT）。"""

    @pytest.mark.asyncio
    async def test_legacy_rejects_write_action(self, tmp_path):
        """fail-closed：无确认环境对写操作（ADD_CONSTRAINT_NODE 等）直接拒绝，不触达 process_actions。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(project_path=ws, collected_instructions=[], dry_run_enabled=False)

        action = make_inline_not_null_action()
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            result = await tool.run({"actions": [action]})

        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        # 关键：写操作不得触达 process_actions
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_legacy_allows_readonly_validate(self, tmp_path):
        """纯读动作（VALIDATE_PROJECT）在无确认环境仍允许直接执行。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        tool = ApplyActionsTool(project_path=ws, collected_instructions=collected, dry_run_enabled=False)

        validate_action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [{"action": validate_action, "success": True, "message": "ok"}],
            }
            result = await tool.run({"actions": [validate_action]})

        assert result["success"] is True
        mock_proc.assert_called_once()

    @pytest.mark.asyncio
    async def test_legacy_error_propagates(self, tmp_path):
        """纯读动作执行异常透传。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        validate_action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}
        with patch(
            "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions", side_effect=RuntimeError("boom")
        ):
            result = await tool.run({"actions": [validate_action]})

        assert result["success"] is False
        assert "boom" in result["error"]


# =============================================================================
# 两阶段确认测试
# =============================================================================

# patch target for process_actions (legacy mode only): the import in apply_actions.py
PATCH_PROC = "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions"


class TestTwoPhaseConfirm:
    """确认路径：dry-run → 用户 confirm → 写盘

    新架构：每次 apply_actions 调用创建独立的 ConfirmController（按 apply_id 键控），
    通过 on_apply_pending 回调捕获 apply_id 后从全局 store 解析对应控制器。
    """

    def _make_tool_with_auto_confirm(
        self, ws: str, collected: list, callbacks: ApplyCallbacks, decision: str = "confirm"
    ):
        """构造工具 + on_apply_pending 回调自动解析本次 apply 的控制器。

        回调从 payload 取 apply_id，从全局 store 查到控制器后异步 resolve。
        """
        import asyncio

        from app.shared.services.ai.streaming.pending_apply_store import get_global_pending_store

        original_pending = callbacks.on_apply_pending
        resolve_tasks: list = []

        def on_apply_pending(payload):
            if original_pending:
                original_pending(payload)
            apply_id = payload.get("apply_id")
            if apply_id:
                store = get_global_pending_store()
                ctrl = store.get(apply_id)

                async def resolve_later():
                    await asyncio.sleep(0.01)
                    if ctrl is not None:
                        await ctrl.resolve(decision)

                resolve_tasks.append(asyncio.create_task(resolve_later()))

        callbacks.on_apply_pending = on_apply_pending
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=collected,
            dry_run_enabled=True,
            apply_callbacks=callbacks,
            job_id="test-job",
        )
        return tool, resolve_tasks

    @pytest.mark.asyncio
    async def test_confirm_writes_to_disk(self, tmp_path):
        """用户确认后，process_actions 被真实调用写盘。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        callbacks = ApplyCallbacks()
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, collected, callbacks, "confirm")

        action = make_inline_not_null_action()

        with (
            patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread,
        ):
            mock_thread.side_effect = [
                make_diff_result(success=True),
                {
                    "success": True,
                    "results": [
                        {
                            "action": action,
                            "success": True,
                            "message": "完成",
                            "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE"},
                        }
                    ],
                },
            ]
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        assert result.get("skipped") is None
        assert len(collected) >= 1

    @pytest.mark.asyncio
    async def test_confirm_emits_callbacks(self, tmp_path):
        """确认后应用回调 emit apply_pending 和 apply_confirmed。"""
        ws = make_test_workspace(tmp_path)
        pending_payloads: list = []
        confirmed_payloads: list = []

        callbacks = ApplyCallbacks(
            on_apply_pending=lambda p: pending_payloads.append(p),
            on_apply_confirmed=lambda p: confirmed_payloads.append(p),
        )
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "confirm")

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.side_effect = [
                make_diff_result(success=True),
                {"success": True, "results": []},
            ]
            await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert len(pending_payloads) == 1
        assert "files" in pending_payloads[0]
        # apply_id 必须随 payload 透传（供前端回传）
        assert "apply_id" in pending_payloads[0]
        assert len(confirmed_payloads) == 1
        assert confirmed_payloads[0]["success"] is True

    @pytest.mark.asyncio
    async def test_confirm_emits_frontend_instruction_per_result(self, tmp_path):
        """确认落盘后，逐条 emit frontend_instruction（每条 raw_result 的指令各发一次）。

        验证流式画布生长契约：
        - 只对成功落盘且含 frontendInstructions 的 raw_result 发事件
        - 无指令的 result（如 DELETE / VALIDATE）不发事件
        - payload 形如 {"instruction": {...}}，前端据此 processFrontendInstructions + fitView
        """
        ws = make_test_workspace(tmp_path)
        fi_payloads: list = []

        callbacks = ApplyCallbacks(
            on_frontend_instruction=lambda p: fi_payloads.append(p),
        )
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "confirm")

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.side_effect = [
                make_diff_result(success=True),
                {
                    "success": True,
                    "results": [
                        # 带指令的 result（应 emit 1 次）
                        {
                            "action": action,
                            "success": True,
                            "message": "完成",
                            "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE"},
                        },
                        # 无指令的 result（不应 emit）
                        {
                            "action": {"actionType": "DELETE_CONSTRAINT_NODE"},
                            "success": True,
                            "message": "删除完成",
                            "frontendInstructions": None,
                        },
                        # 第二条带指令的 result（应 emit 1 次）
                        {
                            "action": action,
                            "success": True,
                            "message": "完成",
                            "frontendInstructions": {"actionType": "ADD_SCHEMA"},
                        },
                    ],
                },
            ]
            await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        # 两条含指令的 result 各 emit 一次
        assert len(fi_payloads) == 2
        # payload 形状：{"instruction": {...}}，且顺序与 raw_results 一致
        assert fi_payloads[0]["instruction"] == {"actionType": "ADD_CONSTRAINT_NODE"}
        assert fi_payloads[1]["instruction"] == {"actionType": "ADD_SCHEMA"}

    @pytest.mark.asyncio
    async def test_reject_does_not_emit_frontend_instruction(self, tmp_path):
        """用户拒绝时，不写盘也不 emit 任何 frontend_instruction。"""
        ws = make_test_workspace(tmp_path)
        fi_payloads: list = []

        callbacks = ApplyCallbacks(
            on_frontend_instruction=lambda p: fi_payloads.append(p),
        )
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "reject")

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=True)
            await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert fi_payloads == []

    @pytest.mark.asyncio
    async def test_reject_skips_write(self, tmp_path):
        """用户拒绝后，第二个 to_thread 不被调用(不写盘)。"""
        ws = make_test_workspace(tmp_path)
        rejected_payloads: list = []
        callbacks = ApplyCallbacks(
            on_apply_rejected=lambda p: rejected_payloads.append(p),
        )
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "reject")

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=True)
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        # 拒绝后返回明确的非成功状态（success=False），避免 LLM 误报"已添加约束"
        assert result["success"] is False
        assert result.get("skipped") is True
        # to_thread 只调用了一次(dry-run)
        assert mock_thread.call_count == 1
        assert len(rejected_payloads) == 1

    @pytest.mark.asyncio
    async def test_dry_run_failure_propagates(self, tmp_path):
        """dry-run 本身失败时不等待确认直接返回。"""
        ws = make_test_workspace(tmp_path)
        callbacks = ApplyCallbacks()
        tool, _resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "confirm")

        bad_action = {"actionType": "UNKNOWN_TYPE", "constraintSpec": {}}

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=False)
            result = await tool.run({"actions": [bad_action]})

        assert result["success"] is False
        assert "dry-run" in result.get("error", "").lower()

    @pytest.mark.asyncio
    async def test_two_applies_get_independent_confirmations(self, tmp_path):
        """D1 核心：同一 job 内连续两次 apply，第 2 次必须独立等待新确认，
        不被第 1 次的旧决策带过（修复 #1：单次锁存 Event 复用）。"""
        ws = make_test_workspace(tmp_path)
        pending_apply_ids: list = []

        callbacks = ApplyCallbacks(
            on_apply_pending=lambda p: pending_apply_ids.append(p.get("apply_id")),
        )
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, [], callbacks, "confirm")

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.side_effect = [
                # 第1次 dry-run + 写盘
                make_diff_result(success=True),
                {"success": True, "results": []},
                # 第2次 dry-run + 写盘
                make_diff_result(success=True),
                {"success": True, "results": []},
            ]
            await tool.run({"actions": [action]})
            await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        # 两次 apply 必须有不同 apply_id（#1 修复的核心证据）
        assert len(pending_apply_ids) == 2
        assert pending_apply_ids[0] != pending_apply_ids[1], "两次 apply 必须独立 apply_id"


# =============================================================================
# 预验证（ActionValidator 接入）测试
# =============================================================================
# patch target：apply_actions.py 中导入的 ActionValidator
PATCH_VALIDATOR = "app.shared.services.ai.agent.chat_tools.apply_actions.ActionValidator"


class TestValidationGuard:
    """预验证门禁：apply_actions.run() 在执行前先验证 actions，
    有 error 时整批拒绝并把错误清单回灌给 LLM，无 error 时正常放行。
    """

    @pytest.mark.asyncio
    async def test_validation_blocks_invalid_action(self, tmp_path):
        """引用不存在的表 → 预验证拒绝，process_actions 不得被调用。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(project_path=ws, collected_instructions=[], dry_run_enabled=False)

        bad_action = make_inline_not_null_action(table="nonexistent_table", table_id="sc_nonexistent")

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            result = await tool.run({"actions": [bad_action]})

        assert result["success"] is False
        assert "预验证" in result.get("error", "")
        # 关键：错误动作不得触达 process_actions
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_validation_blocks_column_not_found_with_suggestion(self, tmp_path):
        """列名拼错（emial）→ 拒绝执行，错误文本含 suggestion 供 LLM 自我修正。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(project_path=ws, collected_instructions=[], dry_run_enabled=False)

        # 真实 email 列存在；此处故意拼错触发 column_not_found + suggestion
        typo_action = make_inline_not_null_action(column="emial")

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            result = await tool.run({"actions": [typo_action]})

        assert result["success"] is False
        # 错误信息中应包含对正确列名的提示
        assert "email" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_validation_passes_valid_action(self, tmp_path):
        """合法动作 → 预验证放行，process_actions 正常调用。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        tool = ApplyActionsTool(project_path=ws, collected_instructions=collected, dry_run_enabled=False)

        valid_action = make_inline_not_null_action()  # users.email，schema 中真实存在

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [
                    {
                        "action": valid_action,
                        "success": True,
                        "message": "完成",
                        "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE"},
                    }
                ],
            }
            result = await tool.run({"actions": [valid_action]})

        # 预验证通过（无"预验证失败"错误），但无确认环境仍对写操作 fail-closed
        assert "预验证" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        # 验证通过但写被拦，process_actions 不得被调用
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_validation_two_phase_also_gated(self, tmp_path):
        """两阶段模式下，预验证同样在 dry-run 前拦截（避免无谓的 dry-run 计算）。"""
        ws = make_test_workspace(tmp_path)
        ctrl = ConfirmController("job-test-validate-twophase")
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            confirm_controller=ctrl,
        )

        bad_action = make_inline_not_null_action(table_id="sc_missing", table="missing")

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            result = await tool.run({"actions": [bad_action]})

        assert result["success"] is False
        assert "预验证" in result.get("error", "")
        # dry-run 也不应执行
        assert mock_thread.call_count == 0

    @pytest.mark.asyncio
    async def test_validation_any_error_blocks_whole_batch(self, tmp_path):
        """混批中只要有一条 error，整批拒绝（全有或全无语义，避免语义割裂）。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(project_path=ws, collected_instructions=[], dry_run_enabled=False)

        good_action = make_inline_not_null_action()  # users.email 合法
        bad_action = make_inline_not_null_action(table="ghost", table_id="sc_ghost")  # 不存在

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            result = await tool.run({"actions": [good_action, bad_action]})

        assert result["success"] is False
        # 合法的动作也不应被执行（整批拒绝）
        mock_proc.assert_not_called()
