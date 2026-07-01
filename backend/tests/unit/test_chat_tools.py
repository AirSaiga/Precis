"""@fileoverview Chat mini-agent 工具单元测试

覆盖 4 个 chat 工具的边界行为：
- ReadProjectTool: 项目概览读取
- ReadTableTool: 表数据采样
- ApplyActionsTool: 动作执行 + frontend_instructions 旁路累积
- ValidateTableTool: 数据校验

测试策略：mock 后端公共入口（get_project_overview / load_file_data /
process_actions / execute_validate_project），验证工具的输入→输出映射。
遵循项目规范：factory 函数 + mock 边界 + 验证结果不验证过程。
"""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest

from app.shared.services.ai.agent.chat_tools import (
    ApplyActionsTool,
    ReadProjectTool,
    ReadTableTool,
    ValidateTableTool,
)
from app.shared.services.llm.actions.validation_types import ValidationResult

# =============================================================================
# Factory 函数
# =============================================================================


def make_overview(**overrides) -> dict:
    """构造项目概览 mock 数据。"""
    base = {
        "schemas": [{"id": "users", "name": "Users", "columns": [{"id": "email", "name": "email", "type": "string"}]}],
        "constraints": [],
        "transforms": [],
        "regex_nodes": [],
        "settings": {},
    }
    base.update(overrides)
    return base


def make_sample_df() -> pd.DataFrame:
    """构造采样 DataFrame mock 数据。"""
    return pd.DataFrame({"email": ["a@b.com", "c@d.com"], "age": [20, 30]})


# =============================================================================
# ReadProjectTool 测试
# =============================================================================


@pytest.mark.asyncio
async def test_read_project_returns_overview():
    """read_project 正常返回项目概览和摘要。"""
    tool = ReadProjectTool(project_path="/fake/project")

    with patch(
        "app.shared.services.ai.agent.chat_tools.read_project.get_project_overview",
        return_value=make_overview(),
    ):
        result = await tool.run({})

    assert result["success"] is True
    assert result["overview"]["schemas"][0]["id"] == "users"
    assert result["summary"]["schema_count"] == 1


@pytest.mark.asyncio
async def test_read_project_no_project_path():
    """无项目路径时返回失败。"""
    tool = ReadProjectTool(project_path="")
    result = await tool.run({})

    assert result["success"] is False
    assert "未配置" in result["error"]


@pytest.mark.asyncio
async def test_read_project_handles_backend_error():
    """后端抛异常时工具捕获并返回失败。"""
    tool = ReadProjectTool(project_path="/fake/project")

    with patch(
        "app.shared.services.ai.agent.chat_tools.read_project.get_project_overview",
        side_effect=RuntimeError("boom"),
    ):
        result = await tool.run({})

    assert result["success"] is False
    assert "boom" in result["error"]


# =============================================================================
# ReadTableTool 测试
# =============================================================================


@pytest.mark.asyncio
async def test_read_table_missing_table_name():
    """未指定 table_name 时返回失败。"""
    tool = ReadTableTool(project_path="/fake/project")
    result = await tool.run({})

    assert result["success"] is False
    assert "table_name" in result["error"]


@pytest.mark.asyncio
async def test_read_table_no_project_path():
    """无项目路径时返回失败。"""
    tool = ReadTableTool(project_path="")
    result = await tool.run({"table_name": "users"})

    assert result["success"] is False


@pytest.mark.asyncio
async def test_read_table_clamps_sample_rows():
    """sample_rows 超出上限时被钳制到最大值，不会因越界崩溃。"""
    tool = ReadTableTool(project_path="/fake/project")
    df = make_sample_df()

    # mock _get_schema_entry 直接返回 (path, source_config)，跳过文件扫描
    fake_entry = ("/fake/project/schemas/users.schema.yaml", {"path": "data/users.csv"})
    with (
        patch.object(tool, "_get_schema_entry", return_value=fake_entry),
        patch(
            "app.shared.services.validation.loader.load_file_data",
            return_value=df,
        ),
        patch("os.path.isfile", return_value=True),
    ):
        result = await tool.run({"table_name": "users", "sample_rows": 9999})

    # 即使请求 9999 行，也不会因越界崩溃
    assert result["success"] is True


# =============================================================================
# ApplyActionsTool 测试
# =============================================================================


@pytest.mark.asyncio
async def test_apply_actions_collects_frontend_instructions():
    """apply_actions 把 process_actions 产出的 frontendInstructions 旁路累积到共享列表。

    本测试聚焦"指令收集"机制。写操作须走两阶段确认（fail-closed），
    预验证 stub 为放行，apply_pending 回调自动确认。
    """
    import asyncio

    from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
    from app.shared.services.ai.streaming.pending_apply_store import get_global_pending_store

    collected: list = []

    # auto-confirm：on_apply_pending 捕获 apply_id 后异步 resolve
    resolve_tasks: list = []

    def on_apply_pending(payload):
        apply_id = payload.get("apply_id")
        if apply_id:
            ctrl = get_global_pending_store().get(apply_id)

            async def resolve_later():
                await asyncio.sleep(0.01)
                if ctrl is not None:
                    await ctrl.resolve("confirm")

            resolve_tasks.append(asyncio.create_task(resolve_later()))

    callbacks = ApplyCallbacks(on_apply_pending=on_apply_pending)
    tool = ApplyActionsTool(
        project_path="/fake/project",
        collected_instructions=collected,
        dry_run_enabled=True,
        apply_callbacks=callbacks,
        job_id="test-collect",
    )

    process_result = {
        "success": True,
        "results": [
            {
                "action": {"actionType": "ADD_CONSTRAINT_NODE"},
                "success": True,
                "message": "ok",
                "frontendInstructions": {"actionType": "ADD_CONSTRAINT_NODE", "data": "instr1"},
            }
        ],
    }

    # stub 预验证为放行；to_thread 依次返回 dry-run DiffResult（第一次）和写盘结果（第二次）
    from app.shared.services.llm.actions.diff_compute import DiffResult, FileDiff

    dry_run_diff = DiffResult(
        success=True,
        files=[FileDiff(path="schemas/users.schema.yaml", status="modified", diff="fake")],
        frontend_instructions=[{"actionType": "ADD_CONSTRAINT_NODE", "data": "instr1"}],
    )
    ok_validation = ValidationResult()
    with (
        patch("app.shared.services.ai.agent.chat_tools.apply_actions.ActionValidator") as mock_validator,
        patch(
            "app.shared.services.ai.agent.chat_tools.apply_actions.asyncio.to_thread",
            side_effect=[dry_run_diff, process_result],
        ),
    ):
        mock_validator.return_value.validate.return_value = ok_validation
        result = await tool.run({"actions": [{"actionType": "ADD_CONSTRAINT_NODE"}]})

    for t in resolve_tasks:
        await t

    # 返回给 LLM 的 observation 只含摘要
    assert result["success"] is True
    assert "frontendInstructions" not in str(result["results"])
    assert result["results"][0]["actionType"] == "ADD_CONSTRAINT_NODE"

    # frontendInstructions 已旁路累积到共享列表（dry-run + 写盘各累积一次，≥1）
    assert len(collected) >= 1
    assert any(c.get("data") == "instr1" for c in collected)
    assert collected[0]["data"] == "instr1"


@pytest.mark.asyncio
async def test_apply_actions_empty_actions_rejected():
    """空 actions 数组被拒绝。"""
    collected: list = []
    tool = ApplyActionsTool(project_path="/fake/project", collected_instructions=collected)

    result = await tool.run({"actions": []})
    assert result["success"] is False
    assert len(collected) == 0  # 未累积任何指令


@pytest.mark.asyncio
async def test_apply_actions_no_project_path():
    """无项目路径时返回失败。"""
    collected: list = []
    tool = ApplyActionsTool(project_path="", collected_instructions=collected)

    result = await tool.run({"actions": [{"actionType": "VALIDATE_PROJECT"}]})
    assert result["success"] is False


# =============================================================================
# ValidateTableTool 测试
# =============================================================================


@pytest.mark.asyncio
async def test_validate_table_all_tables():
    """不传 table_name 时校验所有表（table_filter=None）。"""
    tool = ValidateTableTool(project_path="/fake/project")
    validate_result = {
        "success": True,
        "message": "完成",
        "details": {"error_count": 2, "errors": [{"rule": "r1"}, {"rule": "r2"}]},
    }

    with patch(
        "app.shared.services.ai.agent.chat_tools.validate_table.execute_validate_project",
        return_value=validate_result,
    ) as mock_exec:
        result = await tool.run({})

    assert result["success"] is True
    assert result["error_count"] == 2
    assert len(result["errors"]) == 2
    # table_filter 应为 None（to_thread 位置参数：project_path, table_filter）
    mock_exec.assert_called_once()
    assert mock_exec.call_args[0][1] is None  # 第2个位置参数 table_filter


@pytest.mark.asyncio
async def test_validate_table_single_table():
    """传 table_name 时只校验指定表。"""
    tool = ValidateTableTool(project_path="/fake/project")
    validate_result = {
        "success": True,
        "message": "完成",
        "details": {"error_count": 0, "errors": []},
    }

    with patch(
        "app.shared.services.ai.agent.chat_tools.validate_table.execute_validate_project",
        return_value=validate_result,
    ) as mock_exec:
        result = await tool.run({"table_name": "users"})

    assert result["error_count"] == 0
    assert mock_exec.call_args[0][1] == "users"


@pytest.mark.asyncio
async def test_validate_table_truncates_long_error_list():
    """错误列表过长时被截断，并报告截断数量。"""
    tool = ValidateTableTool(project_path="/fake/project")
    big_errors = [{"rule": f"r{i}"} for i in range(30)]
    validate_result = {
        "success": True,
        "message": "完成",
        "details": {"error_count": 30, "errors": big_errors},
    }

    with patch(
        "app.shared.services.ai.agent.chat_tools.validate_table.execute_validate_project",
        return_value=validate_result,
    ):
        result = await tool.run({})

    # 上限是 _MAX_ERRORS_IN_OBSERVATION = 15
    assert len(result["errors"]) == 15
    assert result["truncated_error_count"] == 15


@pytest.mark.asyncio
async def test_validate_table_no_project_path():
    """无项目路径时返回失败。"""
    tool = ValidateTableTool(project_path="")
    result = await tool.run({})

    assert result["success"] is False


# =============================================================================
# P2: apply_actions tool schema 验证
# =============================================================================


def test_apply_actions_schema_has_action_type_enum():
    """H-LLM2: apply_actions 的 actionType 必须有 enum，否则 LLM 要猜枚举值。"""
    tool = ApplyActionsTool(project_path="/fake", collected_instructions=[])
    definition = tool.get_definition()
    items = definition["function"]["parameters"]["properties"]["actions"]["items"]
    assert "actionType" in items["properties"]
    enum_values = items["properties"]["actionType"]["enum"]
    # 必须包含全部 14 种动作类型
    expected = {
        "ADD_CONSTRAINT_NODE",
        "UPDATE_CONSTRAINT_NODE",
        "DELETE_CONSTRAINT_NODE",
        "ADD_SCHEMA",
        "UPDATE_SCHEMA",
        "DELETE_SCHEMA",
        "ADD_REGEX",
        "UPDATE_REGEX",
        "DELETE_REGEX",
        "ADD_TRANSFORM",
        "UPDATE_TRANSFORM",
        "DELETE_TRANSFORM",
        "UPDATE_SETTINGS",
        "VALIDATE_PROJECT",
    }
    assert set(enum_values) == expected, f"enum 不完整: 缺少 {expected - set(enum_values)}"


def test_apply_actions_schema_documents_spec_field_names():
    """H-LLM2: schema 描述必须明确字段名是 constraintSpec/schemaSpec（而非 spec）。"""
    tool = ApplyActionsTool(project_path="/fake", collected_instructions=[])
    description = tool.get_definition()["function"]["parameters"]["properties"]["actions"]["description"]
    # 关键：明确各 spec 字段名，修正 "spec" 歧义
    assert "constraintSpec" in description
    assert "schemaSpec" in description
    assert "regexSpec" in description
