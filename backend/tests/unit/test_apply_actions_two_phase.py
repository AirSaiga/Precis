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


def make_inline_not_null_action(table: str = "users", column: str = "email") -> dict:
    return {
        "actionType": "ADD_CONSTRAINT_NODE",
        "constraintSpec": {
            "type": "NotNull",
            "tableName": table,
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
    """创建临时项目目录(含 schema 文件)。"""
    ws = tmp_path / "project"
    ws.mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: test\n  name: Test\nschemas: []\n", encoding="utf-8"
    )
    schemas_dir = ws / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text("name: users\ncolumns: []\n", encoding="utf-8")
    return str(ws)


# =============================================================================
# Legacy 分支测试
# =============================================================================


class TestLegacyBranch:
    """legacy 直写模式：行为与改造前一致"""

    @pytest.mark.asyncio
    async def test_legacy_passes_process_actions(self, tmp_path):
        """dry_run_enabled=False 时直接 process_actions 写盘。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=collected,
            dry_run_enabled=False,
        )

        action = make_inline_not_null_action()
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [
                    {
                        "action": action,
                        "success": True,
                        "message": "完成",
                        "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE"},
                    }
                ],
            }
            result = await tool.run({"actions": [action]})

        assert result["success"] is True
        assert len(collected) == 1
        mock_proc.assert_called_once()
        assert mock_proc.call_args[0][0] == [action]
        assert mock_proc.call_args[0][1] == ws

    @pytest.mark.asyncio
    async def test_legacy_without_controller(self, tmp_path):
        """dry_run_enabled=True 但无 controller → legacy 直写。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=collected,
            dry_run_enabled=True,
            confirm_controller=None,  # 无 controller
        )

        action = make_inline_not_null_action()
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.process_actions") as mock_proc:
            mock_proc.return_value = {"success": True, "results": []}
            await tool.run({"actions": [action]})

        mock_proc.assert_called_once()

    @pytest.mark.asyncio
    async def test_legacy_error_propagates(self, tmp_path):
        """legacy 模式下 process_actions 异常透传。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        with patch(
            "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions", side_effect=RuntimeError("boom")
        ):
            result = await tool.run({"actions": [make_inline_not_null_action()]})

        assert result["success"] is False
        assert "boom" in result["error"]


# =============================================================================
# 两阶段确认测试
# =============================================================================

# patch target for process_actions (legacy mode only): the import in apply_actions.py
PATCH_PROC = "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions"


class TestTwoPhaseConfirm:
    """确认路径：dry-run → 用户 confirm → 写盘"""

    @pytest.mark.asyncio
    async def test_confirm_writes_to_disk(self, tmp_path):
        """用户确认后，process_actions 被真实调用写盘。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        ctrl = ConfirmController("job-test-confirm")
        callbacks = ApplyCallbacks()

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=collected,
            dry_run_enabled=True,
            confirm_controller=ctrl,
            apply_callbacks=callbacks,
        )

        action = make_inline_not_null_action()

        import asyncio

        async def resolve_later():
            await asyncio.sleep(0.01)
            ctrl.resolve("confirm")

        task = asyncio.create_task(resolve_later())

        # mock asyncio.to_thread 避免线程池问题；mock apply_actions.py 的 process_actions 引用
        with (
            patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread,
        ):
            # 第一次 to_thread 是 dry-run (compute_action_diff)
            # 第二次 to_thread 是真实 process_actions (确认后)
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

        await task

        assert result["success"] is True
        assert result.get("skipped") is None
        assert len(collected) >= 1

    @pytest.mark.asyncio
    async def test_confirm_emits_callbacks(self, tmp_path):
        """确认后应用回调 emit apply_pending 和 apply_confirmed。"""
        ws = make_test_workspace(tmp_path)
        ctrl = ConfirmController("job-test-cb")
        pending_payloads: list = []
        confirmed_payloads: list = []

        callbacks = ApplyCallbacks(
            on_apply_pending=lambda p: pending_payloads.append(p),
            on_apply_confirmed=lambda p: confirmed_payloads.append(p),
        )

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            confirm_controller=ctrl,
            apply_callbacks=callbacks,
        )

        action = make_inline_not_null_action()

        import asyncio

        async def resolve_later():
            await asyncio.sleep(0.01)
            ctrl.resolve("confirm")

        task = asyncio.create_task(resolve_later())

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.side_effect = [
                make_diff_result(success=True),
                {"success": True, "results": []},
            ]
            await tool.run({"actions": [action]})

        await task

        assert len(pending_payloads) == 1
        assert "files" in pending_payloads[0]
        assert len(confirmed_payloads) == 1
        assert confirmed_payloads[0]["success"] is True

    @pytest.mark.asyncio
    async def test_reject_skips_write(self, tmp_path):
        """用户拒绝后，第二个 to_thread 不被调用(不写盘)。"""
        ws = make_test_workspace(tmp_path)
        ctrl = ConfirmController("job-test-reject")
        ctrl.resolve("reject")

        rejected_payloads: list = []
        callbacks = ApplyCallbacks(
            on_apply_rejected=lambda p: rejected_payloads.append(p),
        )

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            confirm_controller=ctrl,
            apply_callbacks=callbacks,
        )

        action = make_inline_not_null_action()

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=True)
            result = await tool.run({"actions": [action]})

        assert result["success"] is True
        assert result.get("skipped") is True
        # to_thread 只调用了一次(dry-run)
        assert mock_thread.call_count == 1
        assert len(rejected_payloads) == 1

    @pytest.mark.asyncio
    async def test_dry_run_failure_propagates(self, tmp_path):
        """dry-run 本身失败时不等待确认直接返回。"""
        ws = make_test_workspace(tmp_path)
        ctrl = ConfirmController("job-test-dryfail")

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            confirm_controller=ctrl,
        )

        bad_action = {"actionType": "UNKNOWN_TYPE", "constraintSpec": {}}

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=False)
            result = await tool.run({"actions": [bad_action]})

        assert result["success"] is False
        assert "dry-run" in result.get("error", "").lower()
