# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview MCP server stdio 集成测试（P2-1）

复用 scripts/mcp_smoke_test.run_smoke 驱动真实子进程：
initialize → tools/list → tools/call（validate_data / describe_constraints / 路径越界）。
mcp SDK 未安装时整体跳过（可选依赖）。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent


def _mcp_sdk_available() -> bool:
    return importlib.util.find_spec("mcp") is not None


@pytest.mark.skipif(not _mcp_sdk_available(), reason="mcp SDK 未安装（可选依赖 precis-cli[mcp]）")
@pytest.mark.skipif(not (REPO_ROOT / "demo" / "precis-project").is_dir(), reason="demo 项目不存在")
def test_mcp_stdio_smoke():
    """完整 stdio 会话：握手、工具清单、demo 校验、约束描述、路径白名单。"""
    from scripts.mcp_smoke_test import run_smoke

    result = run_smoke(REPO_ROOT)

    assert result["initialized"] is True
    assert result["server_name"] == "precis"
    assert result["tools"] == ["check_config", "describe_constraints", "infer_schema", "validate_data"]
    # demo 项目应检出全部 8 处违规（与 CLI 实测一致）
    assert result["validate_errors"] == 8
    assert result["validate_is_valid"] is False
    assert result["constraint_types"] == 10
    assert result["path_rejected"] is True


@pytest.mark.skipif(not _mcp_sdk_available(), reason="mcp SDK 未安装")
def test_mcp_tool_functions_in_process(tmp_path, monkeypatch):
    """工具函数进程内直调：契约字段齐全 + 越界路径拒绝。

    路径白名单以进程工作目录为根，切到仓库根使 demo 项目可达。
    """
    import sys

    sys.path.insert(0, str(BACKEND_ROOT))
    monkeypatch.chdir(REPO_ROOT)
    from app.mcp_server import tool_describe_constraints, tool_validate_data

    describe = tool_describe_constraints()
    assert {t["type"] for t in describe["types"]} >= {"NotNull", "Unique", "Range", "Composite"}

    manifest = REPO_ROOT / "demo" / "precis-project" / "project.precis.yaml"
    if not manifest.is_file():
        pytest.skip("demo 项目不存在")
    payload = tool_validate_data(manifest=str(manifest))
    assert payload["schema_version"] == 1
    assert isinstance(payload["errors"], list) and payload["errors"]

    with pytest.raises(ValueError, match="越界"):
        tool_validate_data(manifest="Z:/definitely/outside/project.precis.yaml")
