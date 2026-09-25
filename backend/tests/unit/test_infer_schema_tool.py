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

测试策略：不 mock infer_schema（被测工具就是对它的薄封装，推断本身已有
独立测试），用 tmp_path 造真实 CSV 走完整链路。
"""

from __future__ import annotations

import os

import pytest

from app.shared.services.ai.agent.chat_tools import InferSchemaTool


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
        assert func["parameters"]["required"] == ["file_path"]
        assert set(func["parameters"]["properties"]) == {"file_path", "table_name"}
