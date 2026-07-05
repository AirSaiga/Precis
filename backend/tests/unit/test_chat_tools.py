"""@fileoverview Chat mini-agent 工具单元测试

覆盖 5 个 chat 工具的边界行为：
- ReadProjectTool: 项目概览读取
- ReadTableTool: 表数据采样
- ApplyActionsTool: 动作执行 + frontend_instructions 旁路累积
- ValidateTableTool: 数据校验
- ReadCanvasTool: 画布节点快照读取（区别于 read_project 读磁盘）

测试策略：mock 后端公共入口（get_project_overview / load_file_data /
process_actions / execute_validate_project），验证工具的输入→输出映射。
遵循项目规范：factory 函数 + mock 边界 + 验证结果不验证过程。
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pandas as pd
import pytest

from app.shared.services.ai.agent.chat_tools import (
    ApplyActionsTool,
    ReadCanvasTool,
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


@pytest.mark.asyncio
async def test_read_project_truncates_large_overview():
    """大项目概览被语义截断：列表前 N 项 + truncated_*_count，避免 observation 被 memory 硬切。"""
    from app.shared.services.ai.agent.chat_tools import read_project as rp_module

    # 构造大项目：schemas 数量、columns 数量都超过阈值
    big_schemas = [
        {
            "id": f"t{i}",
            "name": f"table_{i}",
            "columns": [{"id": f"c{j}", "name": f"col_{j}", "type": "string"} for j in range(100)],
        }
        for i in range(50)
    ]
    big_constraints = [{"id": f"ct{k}", "type": "NotNull", "table_name": "t0"} for k in range(60)]
    overview = make_overview(schemas=big_schemas, constraints=big_constraints)
    tool = ReadProjectTool(project_path="/fake/project")

    with patch(
        "app.shared.services.ai.agent.chat_tools.read_project.get_project_overview",
        return_value=overview,
    ):
        result = await tool.run({})

    assert result["success"] is True
    ov = result["overview"]
    # schemas 截断到阈值
    assert len(ov["schemas"]) == rp_module._MAX_SCHEMAS_IN_OBSERVATION
    # 每个 schema 的 columns 也被截断
    assert all(len(s["columns"]) == rp_module._MAX_COLUMNS_PER_SCHEMA for s in ov["schemas"])
    # constraints 截断
    assert len(ov["constraints"]) == rp_module._MAX_CONSTRAINTS_IN_OBSERVATION
    # truncated_*_count 反映真实超出量
    assert ov["truncated_schema_count"] == 50 - rp_module._MAX_SCHEMAS_IN_OBSERVATION
    assert ov["truncated_constraint_count"] == 60 - rp_module._MAX_CONSTRAINTS_IN_OBSERVATION
    # 每张表都被截掉了 (100 - 阈值) 列，共 threshold 张表
    expected_col_truncated = rp_module._MAX_SCHEMAS_IN_OBSERVATION * (100 - rp_module._MAX_COLUMNS_PER_SCHEMA)
    assert ov["truncated_column_count"] == expected_col_truncated
    # summary 反映真实规模（截断前的数量）
    assert result["summary"]["schema_count"] == 50
    assert result["summary"]["constraint_count"] == 60
    # 截断后仍是可 json.dumps 的合法结构
    import json

    json.dumps(ov)  # 不抛异常即可


@pytest.mark.asyncio
async def test_read_project_small_project_not_truncated():
    """小项目（各项均未超阈值）原样返回，truncated_*_count 全为 0。"""
    overview = make_overview()  # 1 schema / 1 column / 0 constraints
    tool = ReadProjectTool(project_path="/fake/project")

    with patch(
        "app.shared.services.ai.agent.chat_tools.read_project.get_project_overview",
        return_value=overview,
    ):
        result = await tool.run({})

    ov = result["overview"]
    # 内容不变（小项目不触发截断）
    assert ov["schemas"] == overview["schemas"]
    assert ov["constraints"] == overview["constraints"]
    # truncated 计数全 0
    assert ov["truncated_schema_count"] == 0
    assert ov["truncated_constraint_count"] == 0
    assert ov["truncated_column_count"] == 0


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
    from app.shared.services.ai.streaming.pending_interaction_store import get_global_pending_interaction_store

    collected: list = []

    # auto-confirm：on_apply_pending 捕获 apply_id 后异步 resolve
    resolve_tasks: list = []

    def on_apply_pending(payload):
        apply_id = payload.get("apply_id")
        if apply_id:
            ctrl = get_global_pending_interaction_store().get(apply_id)

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
    # 必须包含全部 15 种动作类型
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
        "ADD_TO_CANVAS",
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


# =============================================================================
# ReadCanvasTool 测试
# =============================================================================


def make_canvas_nodes() -> list[dict]:
    """构造画布节点快照 mock 数据（schema + constraint + regex 混合）。"""
    return [
        {
            "id": "sc_users",
            "type": "schema",
            "data": {"tableName": "users", "configName": "Schema_users", "columns": []},
            "label": "users",
        },
        {
            "id": "node-uuid-1",
            "type": "notNullConstraint",
            "data": {"tableName": "users", "column": "email", "configName": "nn_users_email"},
            "label": "nn_users_email",
        },
        {
            "id": "regex-1",
            "type": "regex",
            "data": {"configName": "邮箱格式", "pattern": r"^\w+@\w+\.\w+$"},
            "label": "邮箱格式",
        },
    ]


@pytest.mark.asyncio
async def test_read_canvas_returns_nodes_and_summary():
    """read_canvas 正常返回画布节点快照与摘要。"""
    tool = ReadCanvasTool(canvas_nodes=make_canvas_nodes())
    result = await tool.run({})

    assert result["success"] is True
    assert len(result["canvas_nodes"]) == 3
    assert result["summary"]["total"] == 3
    assert result["summary"]["schema_count"] == 1
    assert result["summary"]["constraint_count"] == 1
    assert result["summary"]["regex_count"] == 1


@pytest.mark.asyncio
async def test_read_canvas_empty_snapshot():
    """空画布快照返回空列表（非错误）。"""
    tool = ReadCanvasTool(canvas_nodes=[])
    result = await tool.run({})

    assert result["success"] is True
    assert result["canvas_nodes"] == []
    assert result["summary"]["total"] == 0


@pytest.mark.asyncio
async def test_read_canvas_defaults_to_empty():
    """未传 canvas_nodes 时默认空画布。"""
    tool = ReadCanvasTool()
    result = await tool.run({})

    assert result["success"] is True
    assert result["canvas_nodes"] == []
    assert result["summary"]["total"] == 0


@pytest.mark.asyncio
async def test_read_canvas_handles_internal_error():
    """内部异常时返回失败（兜底，正常路径不会触发）。"""
    tool = ReadCanvasTool(canvas_nodes=make_canvas_nodes())

    # _summarize_canvas 对普通输入不会抛异常，这里强制模拟内部故障
    with patch(
        "app.shared.services.ai.agent.chat_tools.read_canvas._summarize_canvas",
        side_effect=RuntimeError("boom"),
    ):
        result = await tool.run({})

    assert result["success"] is False
    assert "boom" in result["error"]
    assert result["canvas_nodes"] == []


def test_read_canvas_definition_distinguishes_from_read_project():
    """工具描述必须点明与 read_project 的区别（画布快照 vs 项目配置文件）。"""
    tool = ReadCanvasTool(canvas_nodes=[])
    description = tool.get_definition()["function"]["description"]
    # 关键：明确区别，引导 LLM 在判断画布状态时用本工具而非 read_project
    assert "画布" in description
    assert "read_project" in description


# =============================================================================
# ADD_TO_CANVAS 动作测试（apply_actions 全链路）
# =============================================================================


def _make_canvas_workspace(tmp_path) -> str:
    """创建临时项目目录（含真实 schema + regex 文件），供 ADD_TO_CANVAS 测试。

    复用 test_apply_actions_two_phase 的 make_test_workspace 模式，但额外加 regex 文件。
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
    regex_dir = ws / "regex"
    regex_dir.mkdir()
    (regex_dir / "email_regex.regex.yaml").write_text(
        "id: rx_email\nname: 邮箱格式\npattern: ^\\w+@\\w+\\.\\w+$\nmatchMode: full\n",
        encoding="utf-8",
    )
    return str(ws)


@pytest.mark.asyncio
async def test_add_to_canvas_generates_instruction_for_existing_schema(tmp_path):
    """ADD_TO_CANVAS 对已存在的 schema 资源：不写盘，只发含重读真实 columns 的 frontendInstructions。"""
    from app.shared.services.llm.actions.action_processor import process_actions

    ws = _make_canvas_workspace(tmp_path)
    action = {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_users"},
    }
    process_result = await asyncio.to_thread(process_actions, [action], ws)

    assert process_result["success"] is True
    results = process_result["results"]
    assert len(results) == 1
    r = results[0]
    assert r["success"] is True
    fi = r["frontendInstructions"]
    assert fi is not None
    assert fi["actionType"] == "ADD_TO_CANVAS"
    assert fi["canvasSpec"]["resourceKind"] == "schema"
    assert fi["canvasSpec"]["resourceId"] == "sc_users"
    # 重读磁盘拿到真实 columns（不是回声空数组）
    config = fi["canvasSpec"]["config"]
    assert config["name"] == "users"
    assert config["columns"][0]["name"] == "email"


@pytest.mark.asyncio
async def test_add_to_canvas_by_name_resolves_id(tmp_path):
    """ADD_TO_CANVAS 只给 resourceName 时，后端重读时补全 resourceId。"""
    from app.shared.services.llm.actions.action_processor import process_actions

    ws = _make_canvas_workspace(tmp_path)
    action = {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "schema", "resourceName": "users"},
    }
    process_result = await asyncio.to_thread(process_actions, [action], ws)

    fi = process_result["results"][0]["frontendInstructions"]
    # name 匹配到文件后，resourceId 被补全为磁盘真实 id
    assert fi["canvasSpec"]["resourceId"] == "sc_users"


@pytest.mark.asyncio
async def test_add_to_canvas_validator_rejects_nonexistent_resource(tmp_path):
    """ADD_TO_CANVAS 目标资源不存在时，预验证拦截（resource_not_found error）。"""
    from app.shared.services.llm.actions.action_validator import ActionValidator

    ws = _make_canvas_workspace(tmp_path)
    validator = ActionValidator(ws)
    action = {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "schema", "resourceId": "sc_nonexistent"},
    }
    result = validator.validate([action])

    assert result.has_errors
    assert any(e.error_type == "resource_not_found" for e in result.errors)


@pytest.mark.asyncio
async def test_add_to_canvas_validator_rejects_invalid_kind(tmp_path):
    """ADD_TO_CANVAS 的 resourceKind 非法时被拒。"""
    from app.shared.services.llm.actions.action_validator import ActionValidator

    ws = _make_canvas_workspace(tmp_path)
    validator = ActionValidator(ws)
    action = {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "datasource", "resourceId": "x"},
    }
    result = validator.validate([action])

    assert result.has_errors
    # resourceKind 非法：可能由 Pydantic 结构前置校验（spec_structure_invalid）或
    # _canvas_validator（invalid_resource_kind）拦截，两者都属合法拒绝。
    assert any(e.error_type in ("invalid_resource_kind", "spec_structure_invalid") for e in result.errors)


@pytest.mark.asyncio
async def test_add_to_canvas_supports_regex(tmp_path):
    """ADD_TO_CANVAS 支持 regex 资源类型。"""
    from app.shared.services.llm.actions.action_processor import process_actions

    ws = _make_canvas_workspace(tmp_path)
    action = {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {"resourceKind": "regex", "resourceId": "rx_email"},
    }
    process_result = await asyncio.to_thread(process_actions, [action], ws)

    fi = process_result["results"][0]["frontendInstructions"]
    assert fi["canvasSpec"]["resourceKind"] == "regex"
    assert fi["canvasSpec"]["config"]["pattern"].startswith("^\\w")


def test_add_to_canvas_definition_mentions_canvas_spec():
    """工具 schema 描述必须说明 ADD_TO_CANVAS 用 canvasSpec 字段。"""
    tool = ApplyActionsTool(project_path="/fake", collected_instructions=[])
    description = tool.get_definition()["function"]["parameters"]["properties"]["actions"]["description"]
    assert "ADD_TO_CANVAS" in description
    assert "canvasSpec" in description
