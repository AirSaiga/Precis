# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview apply_actions 两阶段确认单元测试

覆盖:
- legacy 分支(dry_run_enabled=False 或 无 controller)行为与改造前一致
- confirm → 写盘 + frontend_instructions
- reject → 不写 + skipped:true
- dry-run 失败透传
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyActionsTool, ApplyCallbacks
from app.shared.services.ai.streaming.pending_interaction_store import ConfirmController
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
        # 只读路径不写盘 → 不附加写盘后自检段落
        assert "post_write_check" not in result


# =============================================================================
# 写盘后自动自检测试（结构性闭环）
# =============================================================================


class TestPostWriteSelfCheck:
    """写盘成功后 observation 强制附加自检段落。

    自检分两步：load_project 装载检查 → 装载通过再 execute_validate_project
    取校验摘要。自检失败（装载错误/校验异常）不得让 apply 失败——写盘已成功，
    自检结果只是附加信息（降级为说明文本）。
    """

    def _make_tool(self, ws: str, collected: list) -> ApplyActionsTool:
        """构造两阶段 + 自动 confirm 的工具（复用 TestTwoPhaseConfirm 的装配）。"""
        callbacks = ApplyCallbacks()
        tool, resolve_tasks = TestTwoPhaseConfirm()._make_tool_with_auto_confirm(ws, collected, callbacks, "confirm")
        return tool, resolve_tasks

    @pytest.mark.asyncio
    async def test_confirm_appends_self_check_section(self, tmp_path):
        """确认写盘成功 → observation 含自检段落：装载通过 + 违规摘要。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        tool, resolve_tasks = self._make_tool(ws, collected)

        action = make_inline_not_null_action()
        write_result = {
            "success": True,
            "results": [{"action": action, "success": True, "message": "完成"}],
        }

        with (
            patch("app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff") as mock_diff,
            patch(PATCH_PROC, return_value=write_result),
            patch(PATCH_LOAD, return_value=make_loaded_stub()) as mock_load,
            patch(
                PATCH_VALIDATE_EXEC,
                return_value=make_validate_summary(
                    error_count=2,
                    errors=[
                        {"table": "users", "column": "email", "message": "值为空", "error_type": "NotNull"},
                        {"table": "orders", "column": "qty", "message": "-1 小于最小值 0", "error_type": "Range"},
                    ],
                ),
            ) as mock_validate,
        ):
            mock_diff.return_value = make_diff_result(success=True)
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        section = result["post_write_check"]
        # 段落以固定标题开头（LLM 可在下一轮自然引用）
        assert section.startswith("## 写盘后自动校验")
        # 第一步：装载通过（含 schema/约束计数）
        assert "- 配置装载: 通过" in section
        assert "schemas=1" in section
        # 第二步：校验摘要（违规数 + 前 N 条违规明细）
        assert "- 数据校验: 发现 2 个违规" in section
        assert "users.email: 值为空 (NotNull)" in section
        assert "orders.qty: -1 小于最小值 0 (Range)" in section
        # 边界调用形状：装载用 manifest 路径，校验用工作区路径
        mock_load.assert_called_once_with(f"{ws}{os.sep}project.precis.yaml")
        mock_validate.assert_called_once_with(ws)

    @pytest.mark.asyncio
    async def test_self_check_validation_pass(self, tmp_path):
        """装载通过且校验 0 违规 → 自检段落报通过（含耗时）。"""
        ws = make_test_workspace(tmp_path)
        tool, resolve_tasks = self._make_tool(ws, [])

        action = make_inline_not_null_action()
        with (
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=make_diff_result(success=True),
            ),
            patch(PATCH_PROC, return_value={"success": True, "results": []}),
            patch(PATCH_LOAD, return_value=make_loaded_stub()),
            patch(PATCH_VALIDATE_EXEC, return_value=make_validate_summary(error_count=0)),
        ):
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        assert "- 数据校验: 通过（0 个违规，耗时 5ms）" in result["post_write_check"]

    @pytest.mark.asyncio
    async def test_self_check_load_failure_skips_validation(self, tmp_path):
        """装载错误 → 自检报装载未通过，且不再执行数据校验。"""
        ws = make_test_workspace(tmp_path)
        tool, resolve_tasks = self._make_tool(ws, [])

        action = make_inline_not_null_action()
        with (
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=make_diff_result(success=True),
            ),
            patch(PATCH_PROC, return_value={"success": True, "results": []}),
            patch(
                PATCH_LOAD,
                return_value=make_loaded_stub(loading_errors=[make_loading_error()]),
            ),
            patch(PATCH_VALIDATE_EXEC) as mock_validate,
        ):
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        # 装载失败不改变 apply 成败——写盘已成功，自检只是附加信息
        assert result["success"] is True
        section = result["post_write_check"]
        assert "- 配置装载: 未通过（1 个装载错误）" in section
        assert "[SchemaFileError]" in section
        assert "已跳过（配置装载未通过" in section
        # 装载未通过 → 校验不得执行
        mock_validate.assert_not_called()

    @pytest.mark.asyncio
    async def test_self_check_exception_degrades_but_apply_succeeds(self, tmp_path):
        """自检抛异常 → apply 仍成功，observation 携带降级说明。"""
        ws = make_test_workspace(tmp_path)
        tool, resolve_tasks = self._make_tool(ws, [])

        action = make_inline_not_null_action()
        with (
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=make_diff_result(success=True),
            ),
            patch(PATCH_PROC, return_value={"success": True, "results": []}),
            patch(PATCH_LOAD, return_value=make_loaded_stub()),
            patch(PATCH_VALIDATE_EXEC, side_effect=RuntimeError("boom")),
        ):
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        section = result["post_write_check"]
        assert section.startswith("## 写盘后自动校验")
        assert "未完成" in section
        assert "boom" in section
        assert "写盘本身已成功" in section

    @pytest.mark.asyncio
    async def test_self_check_scripted_skip_not_counted_as_violation(self, tmp_path):
        """Scripted 权限跳过单列：0 违规 + 2 个跳过 → 报"通过"，跳过不计入违规数。"""
        ws = make_test_workspace(tmp_path)
        tool, resolve_tasks = self._make_tool(ws, [])

        action = make_inline_not_null_action()
        with (
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=make_diff_result(success=True),
            ),
            patch(PATCH_PROC, return_value={"success": True, "results": []}),
            patch(PATCH_LOAD, return_value=make_loaded_stub()),
            patch(PATCH_VALIDATE_EXEC, return_value=make_validate_summary(skipped_scripted_count=2)),
        ):
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        section = result["post_write_check"]
        assert "- 数据校验: 通过（0 个违规，耗时 5ms）" in section
        assert "- 脚本约束: 2 个因未启用脚本执行被跳过（不计违规）" in section
        # 权限跳过不得被写成违规
        assert "发现" not in section

    def test_self_check_real_engine_scripted_project_reports_zero_violations(self, tmp_path):
        """真实引擎回归：含 Scripted 约束的项目（默认关 eval）自检报 0 违规 + 跳过说明。

        不 mock 任何边界——装载、校验全走真实链路，守卫"权限跳过被计入
        error_count"的误报不再回归（修复前此处会显示"发现 1 个违规"）。
        """
        ws = str(make_scripted_workspace(tmp_path))
        # 直接调用模块级同步自检函数（与工具内 to_thread 调用同一实现）
        from app.shared.services.ai.agent.chat_tools.apply_actions import _post_write_self_check

        section = _post_write_self_check(ws)

        assert section.startswith("## 写盘后自动校验")
        assert "- 配置装载: 通过（schemas=1, constraints=1）" in section
        # 核心断言：权限跳过不计入违规数，且单列说明
        assert "- 数据校验: 通过（0 个违规" in section
        assert "- 脚本约束: 1 个因未启用脚本执行被跳过（不计违规）" in section
        assert "发现" not in section

    @pytest.mark.asyncio
    async def test_rollback_write_skips_self_check(self, tmp_path):
        """写盘结果 success=False（已回滚、磁盘无变化）→ 不跑自检、不附加段落。"""
        ws = make_test_workspace(tmp_path)
        tool, resolve_tasks = self._make_tool(ws, [])

        action = make_inline_not_null_action()
        with (
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=make_diff_result(success=True),
            ),
            # 写盘返回部分动作失败（success=False，process_actions 已回滚）
            patch(PATCH_PROC, return_value={"success": False, "results": []}),
            patch(PATCH_LOAD, return_value=make_loaded_stub()),
            patch(PATCH_VALIDATE_EXEC) as mock_validate,
        ):
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is False
        # 回滚路径：无自检段落、校验引擎未被调用
        assert "post_write_check" not in result
        mock_validate.assert_not_called()

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
# 写盘后自检的边界 patch target：apply_actions.py 顶层导入的装载/校验入口
PATCH_LOAD = "app.shared.services.ai.agent.chat_tools.apply_actions.load_project"
PATCH_VALIDATE_EXEC = "app.shared.services.ai.agent.chat_tools.apply_actions.execute_validate_project"


def make_loaded_stub(loading_errors: list | None = None, warnings: list | None = None):
    """构造 load_project 边界返回值（duck-typed LoadedProject，自检只读这几个属性）。"""
    from types import SimpleNamespace

    return SimpleNamespace(
        loading_errors=loading_errors or [],
        warnings=warnings or [],
        schema_files={"users": {}},
        constraint_files={"users_email_not_null": {}},
    )


def make_loading_error(error_type: str = "SchemaFileError", message: str = "schema 结构非法"):
    """构造单条 LoadingError（duck-typed，提供 to_dict）。"""
    from types import SimpleNamespace

    payload = {"error_type": error_type, "file_path": "schemas/users.schema.yaml", "message": message}
    return SimpleNamespace(to_dict=lambda: payload)


def make_validate_summary(error_count: int = 0, errors: list | None = None, skipped_scripted_count: int = 0) -> dict:
    """构造 execute_validate_project 边界返回值（校验流程跑通的摘要形状）。

    skipped_scripted_count 对应 Scripted 权限跳过分离后的单列计数（不计入 error_count）。
    """
    return {
        "success": True,
        "message": f"发现 {error_count} 个数据错误" if error_count else "数据校验通过（耗时 5ms）",
        "details": {
            "error_count": error_count,
            "duration_ms": 5,
            "errors": errors or [],
            "skipped_scripted_count": skipped_scripted_count,
            "skipped_scripted": [],
        },
    }


def make_scripted_workspace(tmp_path):
    """构造含真实 Scripted 约束的临时项目（manifest/schema/约束文件/数据齐备）。

    默认部署未开启 allow_unsafe_eval → 校验引擎对该约束产出 PermissionError
    跳过条目（非数据违规），用于真实引擎回归。
    """
    ws = tmp_path / "scripted-project"
    (ws / "schemas").mkdir(parents=True)
    (ws / "constraints").mkdir()
    (ws / "data").mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\n"
        "project:\n  id: scripted-demo\n  name: scripted-demo\n"
        "schemas:\n  - id: sc_users\n    path: schemas/users.schema.yaml\n"
        "constraints:\n  - id: c_score_script\n    path: constraints/score_script.constraint.yaml\n",
        encoding="utf-8",
    )
    (ws / "schemas" / "users.schema.yaml").write_text(
        "id: sc_users\nname: users\nsource:\n  mode: relative_file\n  path: data/users.csv\n"
        "columns:\n  - id: score\n    name: score\n    type: integer\n",
        encoding="utf-8",
    )
    (ws / "constraints" / "score_script.constraint.yaml").write_text(
        "version: 2\nid: c_score_script\ntype: Scripted\nenabled: true\ndescription: 分数范围脚本校验\n"
        "refs:\n  table_id: sc_users\n  column_id: score\n"
        "params:\n  name: score_check\n  expression: value >= 0 and value <= 100\n",
        encoding="utf-8",
    )
    (ws / "data" / "users.csv").write_text("score\n50\n80\n", encoding="utf-8")
    return ws


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

        from app.shared.services.ai.streaming.pending_interaction_store import get_global_pending_interaction_store

        original_pending = callbacks.on_apply_pending
        resolve_tasks: list = []

        def on_apply_pending(payload):
            if original_pending:
                original_pending(payload)
            apply_id = payload.get("apply_id")
            if apply_id:
                store = get_global_pending_interaction_store()
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
                # 写盘后自检（to_thread 第 3 次调用）的 observation 段落
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
            ]
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        assert result.get("skipped") is None
        assert len(collected) >= 1
        # 写盘成功 → observation 必须携带自检段落
        assert result["post_write_check"].startswith("## 写盘后自动校验")

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
                # 写盘后自检段落（第 3 次 to_thread 调用）
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
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
                # 写盘后自检段落（第 3 次 to_thread 调用）
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
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
    async def test_confirm_collects_instructions_only_from_real_write(self, tmp_path):
        """确认写盘后指令只从真实写盘结果收集一次，dry-run 指令不二次累积。

        dry-run DiffResult 携带 shadow-copy 上算出的等价指令（用于确认预览）；
        修复前它会被再追加一遍，completed 事件快照含两份等价指令，
        前端文本比对去重稍有字段差异即双应用（画布长出重复节点）。
        """
        ws = make_test_workspace(tmp_path)
        collected: list = []
        callbacks = ApplyCallbacks()
        tool, resolve_tasks = self._make_tool_with_auto_confirm(ws, collected, callbacks, "confirm")

        action = make_inline_not_null_action()
        real_fi = {"actionType": "ADD_CONSTRAINT_NODE", "source": "real_write"}

        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.side_effect = [
                # dry-run：shadow-copy 上算出的等价指令（不应流入 collected）
                make_diff_result(
                    success=True,
                    instructions=[{"actionType": "ADD_CONSTRAINT_NODE", "source": "dry_run"}],
                ),
                # 真实写盘：产出一条指令
                {
                    "success": True,
                    "results": [
                        {"action": action, "success": True, "message": "完成", "frontendInstructions": real_fi},
                    ],
                },
                # 写盘后自检段落（第 3 次 to_thread 调用）
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
            ]
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is True
        # 收集数量 == 真实写盘产出（1 条），dry-run 指令未被二次累积
        assert len(collected) == 1
        assert collected[0] is real_fi

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
                # 第1次 dry-run + 写盘 + 自检
                make_diff_result(success=True),
                {"success": True, "results": []},
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
                # 第2次 dry-run + 写盘 + 自检
                make_diff_result(success=True),
                {"success": True, "results": []},
                "## 写盘后自动校验\n- 配置装载: 通过\n- 数据校验: 通过（0 个违规）",
            ]
            await tool.run({"actions": [action]})
            await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        # 两次 apply 必须有不同 apply_id（#1 修复的核心证据）
        assert len(pending_apply_ids) == 2
        assert pending_apply_ids[0] != pending_apply_ids[1], "两次 apply 必须独立 apply_id"


# =============================================================================
# 未确认三分支文案测试（reject / timeout / disconnected）
# =============================================================================


class TestUnconfirmedOutcomeText:
    """await_outcome 三分支回灌文案：用户拒绝 / 等待超时 / 连接中断不得互相混淆。

    修复前超时与断连一律折叠为 "用户选择reject，未写入文件"——LLM 会把超时误报成
    用户主动拒绝。此处锁定三个分支各自的 reason 文案与 apply_rejected 事件 reason 码。
    """

    def _make_tool(self, ws: str, callbacks: ApplyCallbacks, job_id: str = "test-job") -> ApplyActionsTool:
        """构造两阶段工具（不带自动 resolve——本组测试要验证等待分支）。"""
        return ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            apply_callbacks=callbacks,
            job_id=job_id,
        )

    @pytest.mark.asyncio
    async def test_user_reject_message_mentions_user_choice(self, tmp_path):
        """用户显式拒绝 → 文案明确"用户选择拒绝"，不含超时/连接中断字样。"""
        ws = make_test_workspace(tmp_path)
        rejected_payloads: list = []
        callbacks = ApplyCallbacks(on_apply_rejected=lambda p: rejected_payloads.append(p))
        tool, resolve_tasks = TestTwoPhaseConfirm()._make_tool_with_auto_confirm(ws, [], callbacks, "reject")

        action = make_inline_not_null_action()
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=True)
            result = await tool.run({"actions": [action]})

        for t in resolve_tasks:
            await t

        assert result["success"] is False
        assert result.get("skipped") is True
        assert result["reason"] == "用户选择拒绝，未写入文件"
        assert "超时" not in result["reason"]
        assert "连接中断" not in result["reason"]
        # SSE 事件载荷 reason 码保持 user_rejected（前端按事件名清态，不消费 reason）
        assert rejected_payloads == [{"reason": "user_rejected", "decision": "reject"}]

    @pytest.mark.asyncio
    async def test_timeout_message_mentions_timeout_not_user_reject(self, tmp_path, monkeypatch):
        """无人决议超时 → 文案"等待用户确认超时"，不得表述成用户拒绝。"""
        import app.shared.services.ai.streaming.pending_interaction_store as store_mod

        monkeypatch.setattr(store_mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ws = make_test_workspace(tmp_path)
        rejected_payloads: list = []
        callbacks = ApplyCallbacks(on_apply_rejected=lambda p: rejected_payloads.append(p))
        tool = self._make_tool(ws, callbacks)

        action = make_inline_not_null_action()
        with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
            mock_thread.return_value = make_diff_result(success=True)
            result = await tool.run({"actions": [action]})

        assert result["success"] is False
        assert result.get("skipped") is True
        assert "等待用户确认超时" in result["reason"]
        assert "用户选择拒绝" not in result["reason"]
        assert rejected_payloads == [{"reason": "timeout", "decision": "timeout"}]

    @pytest.mark.asyncio
    async def test_disconnected_message_mentions_connection_loss(self, tmp_path, monkeypatch):
        """SSE 客户端断开后超时 → 文案"连接中断"，非用户拒绝也非单纯超时。"""
        import app.shared.services.ai.streaming.pending_interaction_store as store_mod
        from app.shared.services.ai.streaming.pending_interaction_store import (
            get_global_pending_interaction_store,
        )

        monkeypatch.setattr(store_mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ws = make_test_workspace(tmp_path)
        job_id = "test-job-grace"
        # 模拟 SSE 断开：stream 层在断开时调用 mark_job_client_gone，
        # 工具随后创建的 ConfirmController 出生即带失联标记
        get_global_pending_interaction_store().mark_job_client_gone(job_id)
        try:
            rejected_payloads: list = []
            callbacks = ApplyCallbacks(on_apply_rejected=lambda p: rejected_payloads.append(p))
            tool = self._make_tool(ws, callbacks, job_id=job_id)

            action = make_inline_not_null_action()
            with patch("app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread") as mock_thread:
                mock_thread.return_value = make_diff_result(success=True)
                result = await tool.run({"actions": [action]})
        finally:
            # 全局 store 单例：注销失联登记，避免污染其他测试
            get_global_pending_interaction_store().pop_by_job_prefix(job_id)

        assert result["success"] is False
        assert result.get("skipped") is True
        assert "连接中断" in result["reason"]
        assert "用户选择拒绝" not in result["reason"]
        assert rejected_payloads == [{"reason": "disconnected", "decision": "disconnected"}]


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


# =============================================================================
# 只读动作分流测试（流式路径下 ADD_TO_CANVAS/VALIDATE_PROJECT 绕过确认门）
# =============================================================================


class TestReadOnlyBypass:
    """流式路径（dry_run_enabled=True）下，只读动作不应走两阶段确认。

    核心场景：用户"拖入画布"调 ADD_TO_CANVAS，不该弹确认框、不该显示"修改配置"。
    只读动作直接走 legacy 执行（process_actions），写盘动作仍走确认门。
    """

    @pytest.mark.asyncio
    async def test_readonly_add_to_canvas_skips_confirmation(self, tmp_path):
        """ADD_TO_CANVAS 在流式路径下不走确认门（不触发 on_apply_pending 回调）。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        pending_called = False

        callbacks = ApplyCallbacks(
            on_apply_pending=lambda payload: None,
        )

        def track_pending(payload):
            nonlocal pending_called
            pending_called = True

        callbacks.on_apply_pending = track_pending

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=collected,
            dry_run_enabled=True,
            apply_callbacks=callbacks,
            job_id="test-job",
        )

        canvas_action = {
            "actionType": "ADD_TO_CANVAS",
            "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"},
        }
        with patch(PATCH_PROC) as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [{"action": canvas_action, "success": True, "message": "ok"}],
            }
            result = await tool.run({"actions": [canvas_action]})

        # 只读动作应成功执行
        assert result["success"] is True
        # 关键：不该触发确认门（用户"拖入画布"不应弹确认框）
        assert pending_called is False, "ADD_TO_CANVAS 不应触发 on_apply_pending 确认回调"
        # 应直接走 process_actions 执行
        mock_proc.assert_called_once()

    @pytest.mark.asyncio
    async def test_readonly_validate_skips_confirmation(self, tmp_path):
        """VALIDATE_PROJECT 在流式路径下不走确认门。"""
        ws = make_test_workspace(tmp_path)
        pending_triggered = {"value": False}
        callbacks = ApplyCallbacks()

        def track_pending(_payload):
            pending_triggered["value"] = True

        callbacks.on_apply_pending = track_pending

        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            apply_callbacks=callbacks,
            job_id="test-job",
        )

        validate_action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}
        with patch(PATCH_PROC) as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [{"action": validate_action, "success": True, "message": "ok"}],
            }
            result = await tool.run({"actions": [validate_action]})

        assert result["success"] is True
        assert pending_triggered["value"] is False, "VALIDATE_PROJECT 不应触发确认回调"
        mock_proc.assert_called_once()

    @pytest.mark.asyncio
    async def test_mixed_batch_splits_readonly_and_write(self, tmp_path):
        """混合批次（只读+写盘）：只读动作直接执行，写盘动作走确认门。"""
        ws = make_test_workspace(tmp_path)
        collected: list = []
        callbacks = ApplyCallbacks()
        tool, resolve_tasks = TestTwoPhaseConfirm()._make_tool_with_auto_confirm(ws, collected, callbacks, "confirm")

        readonly_action = {
            "actionType": "ADD_TO_CANVAS",
            "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"},
        }
        write_action = make_inline_not_null_action()

        # process_actions 被 _run_legacy（只读）和 _run_two_phase（写盘确认后）调用
        process_call_args: list = []

        def tracking_process(actions, path):
            process_call_args.append(actions)
            return {
                "success": True,
                "results": [{"action": a, "success": True, "message": "ok"} for a in actions],
            }

        from app.shared.services.llm.actions.diff_compute import DiffResult, FileDiff

        diff_result = DiffResult(
            success=True,
            files=[FileDiff(path="schemas/users.schema.yaml", status="modified", diff="d")],
            summary={"modified": 1},
            frontend_instructions=[],
            error=None,
        )

        with (
            patch(PATCH_PROC, side_effect=tracking_process),
            patch(
                "app.shared.services.ai.agent.chat_tools.apply_actions.compute_action_diff",
                return_value=diff_result,
            ),
            # 写盘后自检的边界：装载检查 + 校验摘要（保持确定性，不跑真实校验引擎）
            patch(PATCH_LOAD, return_value=make_loaded_stub()),
            patch(PATCH_VALIDATE_EXEC, return_value=make_validate_summary()),
        ):
            result = await tool.run({"actions": [readonly_action, write_action]})

        # 混合批次应成功
        assert result["success"] is True
        # process_actions 至少被调用（只读动作直接执行 + 写盘确认后执行）
        assert len(process_call_args) >= 1
        # 只读动作的结果应在 results 中（合并返回）
        assert len(result.get("results", [])) >= 1

    @pytest.mark.asyncio
    async def test_readonly_failure_aborts_batch(self, tmp_path):
        """只读动作失败时整批返回（全有或全无语义）。"""
        ws = make_test_workspace(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=True,
            apply_callbacks=ApplyCallbacks(),
            job_id="test-job",
        )

        readonly_action = {
            "actionType": "ADD_TO_CANVAS",
            "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"},
        }
        with patch(PATCH_PROC, side_effect=RuntimeError("boom")):
            result = await tool.run({"actions": [readonly_action]})

        assert result["success"] is False
        assert "boom" in result["error"]


# =============================================================================
# 意图范围校验测试（防止 LLM 越界修改）
# =============================================================================


def make_test_workspace_with_email_and_age(tmp_path) -> str:
    """创建含 users 表（email、age 两列）的临时项目目录。"""
    ws = tmp_path / "project"
    ws.mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: test\n  name: Test\nschemas: []\n", encoding="utf-8"
    )
    schemas_dir = ws / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text(
        "id: sc_users\nname: users\ncolumns:\n"
        "  - id: col_email\n    name: email\n    type: string\n"
        "  - id: col_age\n    name: age\n    type: integer\n",
        encoding="utf-8",
    )
    return str(ws)


class TestIntentScopeGuard:
    """意图范围校验（P2-1）：基于 LLM 自填的 intent_scope 做一致性比对。

    改造前用 user_message 子串匹配列/表名（中文场景失效、通用词误判）；
    P2-1 改为 LLM 在 tool 参数里自报 intent_scope，后端做确定性比对。
    """

    @pytest.mark.asyncio
    async def test_rejects_unrelated_column_action(self, tmp_path):
        """intent_scope 声明 email，却混入 age 的约束 -> 意图校验拒绝。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        email_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "users",
                "targetColumn": "email",
                "isInline": True,
                "params": {"pattern": r"^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$"},
            },
        }
        age_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Range",
                "tableName": "users",
                "targetColumn": "age",
                "isInline": True,
                "params": {"min": 0, "max": 100},
            },
        }
        # LLM 自报 scope 只含 email 列
        intent_scope = {"tables": ["users"], "columns": [{"table": "users", "column": "email"}]}

        with patch(PATCH_PROC) as mock_proc:
            result = await tool.run({"actions": [email_action, age_action], "intent_scope": intent_scope})

        assert result["success"] is False
        assert "超出用户请求范围" in result.get("error", "")
        assert "age" in result.get("error", "")
        # 关键：越界动作不得触达 process_actions
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_allows_related_column_action(self, tmp_path):
        """intent_scope 声明 email，只有 email 动作 -> 通过意图校验（继续走后续确认门）。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        email_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "users",
                "targetColumn": "email",
                "isInline": True,
                "params": {"pattern": r"^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$"},
            },
        }
        intent_scope = {"tables": ["users"], "columns": [{"table": "users", "column": "email"}]}

        with patch(PATCH_PROC) as mock_proc:
            result = await tool.run({"actions": [email_action], "intent_scope": intent_scope})

        # 意图校验通过，但无确认环境仍对写操作 fail-closed
        assert "超出用户请求范围" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_readonly_actions_not_blocked_by_intent_guard(self, tmp_path):
        """意图校验只阻断写动作；只读动作（VALIDATE_PROJECT）不因此被拦。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        validate_action = {"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}
        # 即便 intent_scope 很窄（只含 email），只读动作也不受 scope 限制
        intent_scope = {"columns": [{"table": "users", "column": "email"}]}
        with patch(PATCH_PROC) as mock_proc:
            mock_proc.return_value = {
                "success": True,
                "results": [{"action": validate_action, "success": True, "message": "ok"}],
            }
            result = await tool.run({"actions": [validate_action], "intent_scope": intent_scope})

        assert result["success"] is True
        mock_proc.assert_called_once()

    @pytest.mark.asyncio
    async def test_allows_multiple_declared_columns(self, tmp_path):
        """intent_scope 同时声明 email 和 age 时，允许对这两列的写动作。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        email_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "users",
                "targetColumn": "email",
                "isInline": True,
                "params": {"pattern": r"^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$"},
            },
        }
        age_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Range",
                "tableName": "users",
                "targetColumn": "age",
                "isInline": True,
                "params": {"min": 0, "max": 100},
            },
        }
        # LLM 同时声明了两列
        intent_scope = {
            "tables": ["users"],
            "columns": [
                {"table": "users", "column": "email"},
                {"table": "users", "column": "age"},
            ],
        }

        with patch(PATCH_PROC) as mock_proc:
            result = await tool.run({"actions": [email_action, age_action], "intent_scope": intent_scope})

        # 意图校验通过，但无确认环境仍 fail-closed
        assert "超出用户请求范围" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_rejects_unrelated_schema_action(self, tmp_path):
        """intent_scope 声明 users，却生成 ADD_SCHEMA 创建无关表 orders -> 意图校验拒绝。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        unrelated_schema_action = {
            "actionType": "ADD_SCHEMA",
            "schemaSpec": {
                "name": "orders",
                "columns": [{"name": "id", "type": "integer"}],
            },
        }
        # LLM 声明 scope 只含 users 表
        intent_scope = {"tables": ["users"]}

        with patch(PATCH_PROC) as mock_proc:
            result = await tool.run({"actions": [unrelated_schema_action], "intent_scope": intent_scope})

        assert result["success"] is False
        assert "超出用户请求范围" in result.get("error", "")
        assert "orders" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_intent_scope_skips_guard(self, tmp_path):
        """intent_scope 为空/未填时，意图校验跳过，保持向后兼容（不破坏老调用）。"""
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        age_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Range",
                "tableName": "users",
                "targetColumn": "age",
                "isInline": True,
                "params": {"min": 0, "max": 100},
            },
        }

        with patch(PATCH_PROC) as mock_proc:
            # 不传 intent_scope
            result = await tool.run({"actions": [age_action]})

        # 无 intent_scope，校验跳过；但无确认环境仍 fail-closed
        assert "超出用户请求范围" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_regex_action_not_blocked_by_column_scope(self, tmp_path):
        """Regex 独立节点无表/列目标，不参与 scope 比对 → 即使 scope 很窄也放行。

        这是 P2-1 对旧方案的改进点之一：旧方案 Regex 直接 return None, None 跳过校验
        但依赖 user_message 匹配；新方案统一为"无法提取目标 = 不参与比对 = 放行"，
        且完全基于 intent_scope，不再依赖 user_message 文本。
        """
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        regex_action = {
            "actionType": "ADD_REGEX",
            "regexSpec": {
                "name": "email_pattern",
                "pattern": r"^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$",
                "match_mode": "full",
            },
        }
        # scope 很窄（只声明 email 列），但 Regex 无目标，放行
        intent_scope = {"columns": [{"table": "users", "column": "email"}]}

        with patch(PATCH_PROC) as mock_proc:
            result = await tool.run({"actions": [regex_action], "intent_scope": intent_scope})

        # Regex 放行（不参与 scope 比对），无确认环境仍 fail-closed
        assert "超出用户请求范围" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        mock_proc.assert_not_called()

    @pytest.mark.asyncio
    async def test_chinese_intent_mapped_to_column(self, tmp_path):
        """中文意图场景：用户说'邮箱'，LLM 把它映射成 email 写进 intent_scope → 命中放行。

        这是 P2-1 对旧方案的核心修复：旧方案在 user_message 里 substring 匹配列名，
        中文'邮箱'永远匹配不到列名'email'导致校验失效；新方案由 LLM 完成中文字段映射，
        后端只做精确比对，中文场景真正可用。
        """
        ws = make_test_workspace_with_email_and_age(tmp_path)
        tool = ApplyActionsTool(
            project_path=ws,
            collected_instructions=[],
            dry_run_enabled=False,
        )

        email_action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Scripted",
                "tableName": "users",
                "targetColumn": "email",
                "isInline": True,
                "params": {"pattern": r"^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$"},
            },
        }
        # LLM 把中文'邮箱'理解成 email，正确填进 scope（后端只比对 scope，不读 user_message）
        intent_scope = {"tables": ["users"], "columns": [{"table": "users", "column": "email"}]}

        with patch(PATCH_PROC) as mock_proc:
            # 即使 user_message 是纯中文，校验也能正确放行（不依赖 user_message）
            result = await tool.run({"actions": [email_action], "intent_scope": intent_scope})

        assert "超出用户请求范围" not in result.get("error", "")
        assert result["success"] is False
        assert "不支持自动写盘" in result.get("error", "")
        mock_proc.assert_not_called()
