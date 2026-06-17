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
    """apply_actions 把 process_actions 产出的 frontendInstructions 旁路累积到共享列表。"""
    collected: list = []
    tool = ApplyActionsTool(project_path="/fake/project", collected_instructions=collected)

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

    with patch(
        "app.shared.services.ai.agent.chat_tools.apply_actions.process_actions",
        return_value=process_result,
    ):
        result = await tool.run({"actions": [{"actionType": "ADD_CONSTRAINT_NODE"}]})

    # 返回给 LLM 的 observation 只含摘要
    assert result["success"] is True
    assert "frontendInstructions" not in str(result["results"])
    assert result["results"][0]["actionType"] == "ADD_CONSTRAINT_NODE"

    # frontendInstructions 已旁路累积到共享列表
    assert len(collected) == 1
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
