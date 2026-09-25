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
"""@fileoverview ReadConfigFileTool 单元测试

覆盖：
- 正常读取配置文件原文（含中文文件名/中文内容、V2 配置文件类型面）
- 路径白名单：绝对路径与 .. 穿越被拒（与 infer_schema 同款守卫）
- 文件不存在/未配置项目路径/不支持的扩展名/二进制文件的错误回灌
- 输出预算：超长文件截断标注（truncated/total_length/next_offset）、
  length 钳制、offset 分段读取、offset 越界
- tool 定义契约（OpenAI function 格式 + 必填参数）

测试策略：不 mock 文件 IO（被测工具就是对它的薄封装），用 tmp_path
造真实文件走完整链路，与 test_infer_schema_tool.py 同模式。
"""

from __future__ import annotations

import os
import pathlib

import pytest

from app.shared.services.ai.agent.chat_tools import ReadConfigFileTool
from app.shared.services.ai.agent.chat_tools import read_config_file as rcf_module

MANIFEST_YAML = """version: 2
project:
  id: demo
  name: 演示项目
schemas:
  - id: users
    path: schemas/产品库存表.schema.yaml
settings:
  validation:
    strict: true
"""

SCHEMA_YAML = """id: users
name: 产品库存表
columns:
  - id: col_sku
    name: sku
    type: string
"""


@pytest.fixture
def project(tmp_path):
    """构造临时项目目录：覆盖 V2 配置文件类型面（manifest + schema + csv + md）。"""
    ws = tmp_path / "project"
    (ws / "schemas").mkdir(parents=True)
    (ws / "data").mkdir()
    (ws / "project.precis.yaml").write_text(MANIFEST_YAML, encoding="utf-8")
    (ws / "schemas" / "产品库存表.schema.yaml").write_text(SCHEMA_YAML, encoding="utf-8")
    (ws / "data" / "orders.csv").write_text("sku,amount\nA-1,3\n", encoding="utf-8")
    (ws / "README.md").write_text("# 演示项目\n校验配置说明。\n", encoding="utf-8")
    return str(ws)


@pytest.fixture
def tool(project):
    return ReadConfigFileTool(project_path=project)


class TestReadConfigFileHappyPath:
    @pytest.mark.asyncio
    async def test_reads_manifest_verbatim(self, tool):
        """读 project.precis.yaml → 原文逐字返回，无截断标注。"""
        result = await tool.run({"file_path": "project.precis.yaml"})

        assert result["success"] is True
        assert result["file_path"] == "project.precis.yaml"
        assert result["content"] == MANIFEST_YAML
        assert result["offset"] == 0
        assert result["total_length"] == len(MANIFEST_YAML)
        assert result["truncated"] is False
        assert result["next_offset"] is None

    @pytest.mark.asyncio
    async def test_reads_chinese_schema_file(self, tool):
        """中文文件名的 schema 文件可读（V2 文件名即业务名，中文是常态）。"""
        result = await tool.run({"file_path": "schemas/产品库存表.schema.yaml"})

        assert result["success"] is True
        assert result["content"] == SCHEMA_YAML
        assert result["truncated"] is False

    @pytest.mark.asyncio
    async def test_reads_csv_and_md(self, tool):
        """白名单内的文本数据（csv）与文档（md）可读。"""
        csv_result = await tool.run({"file_path": "data/orders.csv"})
        md_result = await tool.run({"file_path": "README.md"})

        assert csv_result["success"] is True
        assert csv_result["content"] == "sku,amount\nA-1,3\n"
        assert md_result["success"] is True
        assert md_result["content"].startswith("# 演示项目")

    @pytest.mark.asyncio
    async def test_backslash_path_normalized(self, tool):
        """Windows 反斜杠相对路径被归一化（与 infer_schema 口径对齐）。"""
        result = await tool.run({"file_path": "schemas\\产品库存表.schema.yaml"})

        assert result["success"] is True
        assert result["file_path"] == "schemas/产品库存表.schema.yaml"

    @pytest.mark.asyncio
    async def test_empty_file_returns_empty_content(self, tool, project):
        """空文件是合法文本：成功返回空内容，不算错误。"""
        pathlib.Path(project, "notes.txt").write_text("", encoding="utf-8")
        result = await tool.run({"file_path": "notes.txt"})

        assert result["success"] is True
        assert result["content"] == ""
        assert result["total_length"] == 0
        assert result["truncated"] is False


class TestReadConfigFilePathGuard:
    @pytest.mark.asyncio
    async def test_rejects_parent_traversal(self, tool):
        """../ 穿越 → 拒绝，错误信息含修正指引。"""
        result = await tool.run({"file_path": "../secrets.yaml"})

        assert result["success"] is False
        assert "不合法" in result["error"]
        assert "相对项目根" in result["error"]

    @pytest.mark.asyncio
    async def test_rejects_nested_traversal(self, tool):
        """中间含 .. 分量的路径（schemas/../../x.yaml）同样被拒。"""
        result = await tool.run({"file_path": "schemas/../../secrets.yaml"})

        assert result["success"] is False
        assert "不合法" in result["error"]

    @pytest.mark.asyncio
    async def test_rejects_absolute_path(self, tool):
        """绝对路径 → 拒绝（文件必须是项目相对路径）。

        探针按运行平台构造（与 test_infer_schema_tool 同款），保证任何平台
        测的都是同一行为。
        """
        absolute_probe = os.path.join(os.path.abspath(os.sep), "precis-guard-probe", "config.yaml")
        assert os.path.isabs(absolute_probe)  # 前置自检：探针必须真的绝对

        result = await tool.run({"file_path": absolute_probe})

        assert result["success"] is False
        assert "不合法" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_file_returns_guidance(self, tool):
        """文件不存在 → 失败并提示用 read_project 查看清单。"""
        result = await tool.run({"file_path": "schemas/nope.schema.yaml"})

        assert result["success"] is False
        assert "不存在" in result["error"]
        assert "read_project" in result["error"]

    @pytest.mark.asyncio
    async def test_no_project_path(self):
        """未配置项目路径 → 明确失败。"""
        result = await ReadConfigFileTool(project_path="").run({"file_path": "project.precis.yaml"})

        assert result["success"] is False
        assert "未配置" in result["error"]


class TestReadConfigFileContentGuards:
    @pytest.mark.asyncio
    async def test_unsupported_extension_rejected(self, tool, project):
        """白名单外扩展名（如 .py）→ 明确失败并列出支持的类型。"""
        pathlib.Path(project, "scripts", "run.py").parent.mkdir(exist_ok=True)
        pathlib.Path(project, "scripts", "run.py").write_text("print(1)\n", encoding="utf-8")
        result = await tool.run({"file_path": "scripts/run.py"})

        assert result["success"] is False
        assert "不支持的文件类型" in result["error"]
        assert ".yaml" in result["error"]

    @pytest.mark.asyncio
    async def test_binary_file_rejected(self, tool, project):
        """白名单扩展名但内容含 NUL 字节 → 按二进制拒绝（防止垃圾灌进 observation）。"""
        pathlib.Path(project, "broken.json").write_bytes(b'{"a": 1}\x00\x01\x02binary-junk')
        result = await tool.run({"file_path": "broken.json"})

        assert result["success"] is False
        assert "二进制" in result["error"]

    @pytest.mark.asyncio
    async def test_non_utf8_file_rejected(self, tool, project):
        """UTF-8 解码失败的文件 → 明确失败（可能是 GBK 等其他编码）。"""
        pathlib.Path(project, "gbk.txt").write_bytes("中文内容".encode("gbk"))
        result = await tool.run({"file_path": "gbk.txt"})

        assert result["success"] is False
        assert "UTF-8" in result["error"]


class TestReadConfigFilePagination:
    @pytest.mark.asyncio
    async def test_long_file_truncated_with_annotation(self, tool, project):
        """超长文件默认截断到 4000 字符，并标注总长度与续读偏移。"""
        long_text = "x" * 10_000
        pathlib.Path(project, "big.md").write_text(long_text, encoding="utf-8")

        result = await tool.run({"file_path": "big.md"})

        assert result["success"] is True
        assert result["content_length"] == rcf_module._DEFAULT_CONTENT_CHARS
        assert result["content"] == long_text[: rcf_module._DEFAULT_CONTENT_CHARS]
        assert result["total_length"] == 10_000
        assert result["truncated"] is True
        assert result["next_offset"] == rcf_module._DEFAULT_CONTENT_CHARS

    @pytest.mark.asyncio
    async def test_length_param_clamped_to_budget(self, tool, project):
        """length 超上限被钳制，不会突破 observation 预算。"""
        pathlib.Path(project, "big.md").write_text("y" * 10_000, encoding="utf-8")

        result = await tool.run({"file_path": "big.md", "length": 999_999})

        assert result["success"] is True
        assert result["content_length"] == rcf_module._MAX_CONTENT_CHARS

    @pytest.mark.asyncio
    async def test_offset_reads_next_segment(self, tool, project):
        """offset 分段读取：按 next_offset 逐段续读，拼接结果与原文一致，末段 truncated=False。"""
        text = "".join(f"line-{i:04d}\n" for i in range(1000))  # 1000 行 × 10 字符
        pathlib.Path(project, "lines.txt").write_text(text, encoding="utf-8")

        parts: list[str] = []
        offset = 0
        for _ in range(10):  # 轮次上限防死循环（10000 字符 / 4000 每段 = 3 段）
            result = await tool.run({"file_path": "lines.txt", "offset": offset})
            assert result["success"] is True
            assert result["offset"] == offset
            assert result["total_length"] == len(text)
            parts.append(result["content"])
            if not result["truncated"]:
                assert result["next_offset"] is None
                break
            assert result["next_offset"] == offset + result["content_length"]
            offset = result["next_offset"]

        # 分段拼接与原文逐字一致（无重叠、无遗漏）
        assert "".join(parts) == text

    @pytest.mark.asyncio
    async def test_offset_beyond_end_rejected(self, tool, project):
        """offset 超出文件总长度 → 明确失败（文件已读完），不返回空内容误导 LLM。"""
        pathlib.Path(project, "small.txt").write_text("abc", encoding="utf-8")

        result = await tool.run({"file_path": "small.txt", "offset": 3})
        beyond = await tool.run({"file_path": "small.txt", "offset": 100})

        assert result["success"] is False
        assert "超出文件总长度" in result["error"]
        assert beyond["success"] is False

    @pytest.mark.asyncio
    async def test_offset_counts_characters_not_bytes(self, tool, project):
        """offset/length 按字符计数（中文多字节不偏移），next_offset 可无缝续读。"""
        text = "中" * 6000  # UTF-8 下 18000 字节，但只有 6000 字符
        pathlib.Path(project, "chinese.txt").write_text(text, encoding="utf-8")

        result = await tool.run({"file_path": "chinese.txt"})

        assert result["success"] is True
        assert result["content_length"] == rcf_module._DEFAULT_CONTENT_CHARS
        assert result["total_length"] == 6000
        assert result["next_offset"] == rcf_module._DEFAULT_CONTENT_CHARS


class TestReadConfigFileDefinition:
    def test_definition_contract(self):
        """OpenAI function 格式三件套：name/描述/参数 schema（file_path 必填，offset/length 可选）。"""
        definition = ReadConfigFileTool(project_path="/fake").get_definition()

        assert definition["type"] == "function"
        func = definition["function"]
        assert func["name"] == "read_config_file"
        assert "原文" in func["description"]
        assert "parse_errors" in func["description"]
        assert func["parameters"]["required"] == ["file_path"]
        assert set(func["parameters"]["properties"]) == {"file_path", "offset", "length"}

    def test_args_model_registered(self):
        """入参 Pydantic 模型已注册（P1-1 结构校验入口）。"""
        from app.shared.services.ai.agent.chat_tools.schemas import MODEL_FOR_TOOL, ReadConfigFileArgs

        assert MODEL_FOR_TOOL.get("read_config_file") is ReadConfigFileArgs
