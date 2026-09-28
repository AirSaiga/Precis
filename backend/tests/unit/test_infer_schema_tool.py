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
"""@fileoverview InferSchemaTool 单元测试

覆盖：
- 真实 CSV 的列类型推断（integer/string/date/boolean/float 全类型面）
- 路径白名单：绝对路径与 .. 穿越被拒（与 ADD_SCHEMA source.path 口径一致）
- 文件不存在/未配置项目路径的错误回灌（含 list_data_files 修正指引）
- tool 定义契约（OpenAI function 格式 + 必填参数）
- sheet/header_row 透传与防御回退（G1：多 sheet / 表头偏移的列错位）
- sheet 名错误的可用工作表清单自愈（与 read_table._build_load_error 同口径）

测试策略：不 mock infer_schema 的正常链路（被测工具就是对它的薄封装，
推断本身已有独立测试），用 tmp_path 造真实 CSV/Excel 走完整链路；
透传与防御分支用 mock 边界（替换工具模块内引用的 infer_schema /
excel_loader.get_excel_sheet_names），不 mock 工具内部。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.shared.services.ai.agent.chat_tools import InferSchemaTool


def _make_multi_sheet_xlsx(project: str) -> None:
    """造两张 sheet 的 xlsx：Sheet1/Sheet2 列名完全不同。"""
    pytest.importorskip("openpyxl")
    import pandas as pd

    xlsx = Path(project) / "data" / "book.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as writer:
        pd.DataFrame({"first_a": ["1"], "first_b": ["x"]}).to_excel(writer, sheet_name="Sheet1", index=False)
        pd.DataFrame({"second_a": ["2"], "备注": ["y"]}).to_excel(writer, sheet_name="Sheet2", index=False)


@pytest.fixture
def project(tmp_path):
    """构造临时项目目录：data/ 下放真实 CSV（覆盖 5 种推断类型）。"""
    ws = tmp_path / "project"
    data_dir = ws / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "users.csv").write_text(
        "id,name,birth,active,score\n"
        "1,Alice,1990-01-01,true,19.99\n"
        "2,Bob,1991-02-02,false,3.5\n"
        "3,Carol,1992-03-03,true,0\n",
        encoding="utf-8",
    )
    return str(ws)


@pytest.fixture
def tool(project):
    return InferSchemaTool(project_path=project)


class TestInferSchemaHappyPath:
    @pytest.mark.asyncio
    async def test_infers_column_types_from_real_csv(self, tool):
        """真实 CSV → 每列返回名称 + 主导类型推断结果。"""
        result = await tool.run({"file_path": "data/users.csv"})

        assert result["success"] is True
        assert result["file_path"] == "data/users.csv"
        assert result["table_name"] == "users"
        assert result["column_count"] == 5
        types = {c["name"]: c["type"] for c in result["columns"]}
        assert types == {
            "id": "integer",
            "name": "string",
            "birth": "date",
            "active": "boolean",
            "score": "float",
        }

    @pytest.mark.asyncio
    async def test_table_name_override(self, tool):
        """传 table_name → 草稿表名用传入值（语义化命名入口）。"""
        result = await tool.run({"file_path": "data/users.csv", "table_name": "用户表"})

        assert result["success"] is True
        assert result["table_name"] == "用户表"

    @pytest.mark.asyncio
    async def test_backslash_path_normalized(self, tool):
        """Windows 反斜杠相对路径被归一化（与 list_data_files 的 posix 口径对齐）。"""
        result = await tool.run({"file_path": "data\\users.csv"})

        assert result["success"] is True
        assert result["file_path"] == "data/users.csv"


class TestInferSchemaPathGuard:
    @pytest.mark.asyncio
    async def test_rejects_parent_traversal(self, tool):
        """../ 穿越 → 拒绝，错误信息含修正指引。"""
        result = await tool.run({"file_path": "../secrets.csv"})

        assert result["success"] is False
        assert "不合法" in result["error"]
        assert "list_data_files" in result["error"]

    @pytest.mark.asyncio
    async def test_rejects_nested_traversal(self, tool):
        """中间含 .. 分量的路径（data/../../x.csv）同样被拒。"""
        result = await tool.run({"file_path": "data/../../secrets.csv"})

        assert result["success"] is False
        assert "不合法" in result["error"]

    @pytest.mark.asyncio
    async def test_rejects_absolute_path(self, tool):
        """绝对路径 → 拒绝（数据文件必须是项目相对路径）。

        探针按运行平台构造：Linux 上 "C:/..." 经 os.path.isabs 判 False，
        会落入"文件不存在"分支而非守卫拒绝（CI 实证）——必须用当前平台
        必然为绝对路径的构造，保证任何平台测的都是同一行为。
        """
        absolute_probe = os.path.join(os.path.abspath(os.sep), "precis-guard-probe", "config.csv")
        # 前置自检：探针在当前平台必须真的构造出绝对路径，否则测试失效
        assert os.path.isabs(absolute_probe)

        result = await tool.run({"file_path": absolute_probe})

        assert result["success"] is False
        assert "不合法" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_file_returns_guidance(self, tool):
        """文件不存在 → 失败并提示用 list_data_files 确认清单。"""
        result = await tool.run({"file_path": "data/nope.csv"})

        assert result["success"] is False
        assert "不存在" in result["error"]
        assert "list_data_files" in result["error"]

    @pytest.mark.asyncio
    async def test_unsupported_extension_fails(self, tool, project):
        """不支持的扩展名 → infer_schema 的 ValueError 转为失败回灌。"""
        import pathlib

        pathlib.Path(project, "data", "notes.txt").write_text("hello", encoding="utf-8")
        result = await tool.run({"file_path": "data/notes.txt"})

        assert result["success"] is False
        assert "推断失败" in result["error"]

    @pytest.mark.asyncio
    async def test_no_project_path(self):
        """未配置项目路径 → 明确失败。"""
        result = await InferSchemaTool(project_path="").run({"file_path": "data/users.csv"})

        assert result["success"] is False
        assert "未配置" in result["error"]


class TestInferSchemaDefinition:
    def test_definition_contract(self):
        """OpenAI function 格式三件套：name/描述/参数 schema（file_path 必填）。"""
        definition = InferSchemaTool(project_path="/fake").get_definition()

        assert definition["type"] == "function"
        func = definition["function"]
        assert func["name"] == "infer_schema"
        assert "推断" in func["description"]
        assert "多 sheet" in func["description"]
        assert func["parameters"]["required"] == ["file_path"]
        assert set(func["parameters"]["properties"]) == {"file_path", "table_name", "sheet", "header_row"}
        assert func["parameters"]["properties"]["sheet"]["type"] == "string"
        assert func["parameters"]["properties"]["header_row"]["type"] == "integer"


class TestInferSchemaSheetAndHeaderRow:
    """sheet/header_row 参数：透传、防御回退与真实文件端到端"""

    @pytest.mark.asyncio
    async def test_sheet_and_header_row_passed_through(self, tool, monkeypatch):
        """sheet/header_row 原样透传给底层 infer_schema（参数名映射 sheet→sheet_name）。"""
        captured: dict = {}

        def fake_infer_schema(data_file, **kwargs):
            captured["data_file"] = data_file
            captured.update(kwargs)
            return {"name": "t", "columns": [{"name": "c1", "type": "string"}]}

        monkeypatch.setattr("app.shared.services.ai.agent.chat_tools.infer_schema.infer_schema", fake_infer_schema)

        result = await tool.run({"file_path": "data/users.csv", "sheet": "Sheet2", "header_row": 2})

        assert result["success"] is True
        assert captured["sheet_name"] == "Sheet2"
        assert captured["header_row"] == 2

    @pytest.mark.asyncio
    async def test_new_params_default_to_none_and_zero(self, tool, monkeypatch):
        """不传新参数 → 透传 None/0（与历史行为完全一致）。"""
        captured: dict = {}

        def fake_infer_schema(data_file, **kwargs):
            captured.update(kwargs)
            return {"name": "t", "columns": [{"name": "c1", "type": "string"}]}

        monkeypatch.setattr("app.shared.services.ai.agent.chat_tools.infer_schema.infer_schema", fake_infer_schema)

        result = await tool.run({"file_path": "data/users.csv"})

        assert result["success"] is True
        assert captured["sheet_name"] is None
        assert captured["header_row"] == 0

    @pytest.mark.asyncio
    async def test_invalid_header_row_falls_back_to_zero(self, tool, monkeypatch):
        """header_row 非 int（字符串/浮点）或负数 → 回退 0（与 schema_handlers 防御口径一致）。"""
        captured: dict = {}

        def fake_infer_schema(data_file, **kwargs):
            captured.update(kwargs)
            return {"name": "t", "columns": [{"name": "c1", "type": "string"}]}

        monkeypatch.setattr("app.shared.services.ai.agent.chat_tools.infer_schema.infer_schema", fake_infer_schema)

        for bad_value in ("2", 1.5, -1, None):
            captured.clear()
            result = await tool.run({"file_path": "data/users.csv", "header_row": bad_value})
            assert result["success"] is True, f"header_row={bad_value!r} 不应导致失败"
            assert captured["header_row"] == 0, f"header_row={bad_value!r} 应回退 0"

    @pytest.mark.asyncio
    async def test_non_string_sheet_treated_as_absent(self, tool, monkeypatch):
        """sheet 非 str（LLM 偶发传数字）→ 按 None 处理，不传给 pandas。"""
        captured: dict = {}

        def fake_infer_schema(data_file, **kwargs):
            captured.update(kwargs)
            return {"name": "t", "columns": [{"name": "c1", "type": "string"}]}

        monkeypatch.setattr("app.shared.services.ai.agent.chat_tools.infer_schema.infer_schema", fake_infer_schema)

        result = await tool.run({"file_path": "data/users.csv", "sheet": 2})

        assert result["success"] is True
        assert captured["sheet_name"] is None

    @pytest.mark.asyncio
    async def test_multi_sheet_xlsx_sheet_selects_second_sheet(self, tool, project):
        """端到端：多 sheet xlsx 传 sheet → 推断出指定表的列（而非第一张表）。"""
        _make_multi_sheet_xlsx(project)

        result = await tool.run({"file_path": "data/book.xlsx", "sheet": "Sheet2"})

        assert result["success"] is True
        assert [c["name"] for c in result["columns"]] == ["second_a", "备注"]

    @pytest.mark.asyncio
    async def test_multi_sheet_xlsx_default_reads_first_sheet(self, tool, project):
        """端到端：不传 sheet → 读第一张表（与历史行为兼容）。"""
        _make_multi_sheet_xlsx(project)

        result = await tool.run({"file_path": "data/book.xlsx"})

        assert result["success"] is True
        assert [c["name"] for c in result["columns"]] == ["first_a", "first_b"]

    @pytest.mark.asyncio
    async def test_header_row_skips_title_row(self, tool, project):
        """端到端：header_row=1 → 跳过标题行取真实表头。"""
        pytest.importorskip("openpyxl")
        import pandas as pd

        xlsx = Path(project) / "data" / "report.xlsx"
        rows = [["订单明细表", "", ""], ["编号", "数量", "品名"], ["A1", "10", "键盘"]]
        pd.DataFrame(rows).to_excel(xlsx, header=False, index=False)

        result = await tool.run({"file_path": "data/report.xlsx", "header_row": 1})

        assert result["success"] is True
        assert [c["name"] for c in result["columns"]] == ["编号", "数量", "品名"]
        types = {c["name"]: c["type"] for c in result["columns"]}
        assert types["数量"] == "integer"

    @pytest.mark.asyncio
    async def test_invalid_header_row_real_file_reads_row_zero(self, tool, project):
        """端到端：非法 header_row（字符串）→ 回退 0，标题行被当表头（防御行为可见）。"""
        pytest.importorskip("openpyxl")
        import pandas as pd

        xlsx = Path(project) / "data" / "report.xlsx"
        rows = [["订单明细表", "", ""], ["编号", "数量", "品名"], ["A1", "10", "键盘"]]
        pd.DataFrame(rows).to_excel(xlsx, header=False, index=False)

        result = await tool.run({"file_path": "data/report.xlsx", "header_row": "1"})

        # 回退 0：标题行成了列名（正是调用方必须传合法 header_row 的原因）
        assert result["success"] is True
        assert result["columns"][0]["name"] == "订单明细表"


class TestInferSchemaSheetErrorSelfHeal:
    """sheet 名错误的自愈：error 附可用工作表清单（LLM 可直接修正重试）"""

    @pytest.mark.asyncio
    async def test_wrong_sheet_error_lists_available_sheets(self, tool, project):
        """sheet 名错误（pandas Worksheet not found）→ error 附可用工作表清单。"""
        _make_multi_sheet_xlsx(project)

        result = await tool.run({"file_path": "data/book.xlsx", "sheet": "不存在的表"})

        assert result["success"] is False
        assert "Worksheet" in result["error"]
        assert "可用工作表" in result["error"]
        assert "Sheet1" in result["error"]
        assert "Sheet2" in result["error"]

    @pytest.mark.asyncio
    async def test_sheet_list_read_failure_returns_root_cause_only(self, tool, project, monkeypatch):
        """工作表清单读取失败（文件损坏/被占用）→ 只返回根因，不追加自愈信息。"""
        _make_multi_sheet_xlsx(project)

        def broken_get_sheet_names(file_path):
            raise OSError("file locked by another process")

        monkeypatch.setattr(
            "app.shared.core.data_source.loaders.excel_loader.get_excel_sheet_names", broken_get_sheet_names
        )

        result = await tool.run({"file_path": "data/book.xlsx", "sheet": "不存在的表"})

        assert result["success"] is False
        assert "Worksheet" in result["error"]
        assert "可用工作表" not in result["error"]

    @pytest.mark.asyncio
    async def test_non_worksheet_error_has_no_sheet_list(self, tool, project):
        """非工作表类错误（如不支持的扩展名）→ 不触发自愈清单（口径与 read_table 一致）。"""
        Path(project, "data", "notes.txt").write_text("hello", encoding="utf-8")

        result = await tool.run({"file_path": "data/notes.txt"})

        assert result["success"] is False
        assert "推断失败" in result["error"]
        assert "可用工作表" not in result["error"]
