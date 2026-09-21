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
"""@fileoverview MCP server stdio 冒烟测试

模拟 MCP stdio 客户端驱动 `python -m app.mcp_server`：
initialize → notifications/initialized → tools/list → tools/call
（validate_data / describe_constraints / 路径越界拒绝）。

用法：
    cd backend && python -m scripts.mcp_smoke_test          # 用仓库 demo 项目
    或作为模块被 pytest 复用（tests/integration/test_mcp_server.py）
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

# 协议版本（与 app.mcp_server 一致）
_PROTOCOL_VERSION = "2024-11-05"

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


class McpStdioClient:
    """极简 MCP stdio 客户端：发一行 JSON-RPC 请求、收一行响应。"""

    def __init__(self, server_cwd: Path) -> None:
        self._proc = subprocess.Popen(
            [sys.executable, "-B", "-m", "app.mcp_server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(server_cwd),
            text=True,
            encoding="utf-8",
            env={
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                # 子进程须跑仓库源码而非 site-packages 里可能陈旧的安装副本
                # （CI 装 -e 无此问题；本地裸装旧版会让冒烟测到旧代码，
                # CI run 35575157626 实证本地绿/CI 红的分歧）
                "PYTHONPATH": str(BACKEND_ROOT),
            },
        )

    def request(self, request_id: int, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """发送请求并阻塞等待同 id 响应。"""
        frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps(frame, ensure_ascii=False) + "\n")
        self._proc.stdin.flush()
        while True:
            line = self._proc.stdout.readline()  # type: ignore[union-attr]
            if not line:
                stderr = self._proc.stderr.read() if self._proc.stderr else ""
                raise RuntimeError(f"MCP server 提前退出: {stderr[:500]}")
            message = json.loads(line)
            if message.get("id") == request_id:
                return message

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        """发送通知（无响应）。"""
        frame = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps(frame) + "\n")
        self._proc.stdin.flush()

    def close(self) -> None:
        if self._proc.stdin:
            self._proc.stdin.close()
        self._proc.terminate()
        try:
            self._proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._proc.kill()

    def tool_result_payload(self, request_id: int, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """调用 tools/call 并解包 TextContent 的 JSON 文本。"""
        response = self.request(request_id, "tools/call", {"name": name, "arguments": arguments})
        result = response.get("result", {})
        if result.get("isError"):
            raise RuntimeError(f"tool {name} 返回 isError: {result}")
        contents = result.get("content", [])
        assert contents, f"tool {name} 无 content"
        return json.loads(contents[0]["text"])


def run_smoke(server_cwd: Path, manifest_rel: str | None = None) -> dict[str, Any]:
    """执行完整冒烟流程，返回逐项结果（供脚本输出与 pytest 断言复用）。

    Args:
        server_cwd: server 进程工作目录（路径白名单根；demo 项目须在其内）
        manifest_rel: 相对 server_cwd 的 manifest 路径；None 用仓库 demo 项目

    Returns:
        {"initialized": bool, "tools": [...], "validate": {...}, "describe": {...}, "path_rejected": bool}
    """
    client = McpStdioClient(server_cwd)
    try:
        # 1. initialize 握手
        init = client.request(
            1,
            "initialize",
            {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "smoke-test", "version": "0.0.1"},
            },
        )
        server_info = init.get("result", {}).get("serverInfo", {})
        assert server_info.get("name") == "precis", f"serverInfo 异常: {server_info}"

        # 2. initialized 通知
        client.notify("notifications/initialized")

        # 3. tools/list
        tools_response = client.request(2, "tools/list")
        tool_names = sorted(t["name"] for t in tools_response.get("result", {}).get("tools", []))
        assert tool_names == ["check_config", "describe_constraints", "infer_schema", "validate_data"], tool_names

        # 4. tools/call validate_data（demo 项目应返回含 errors 的契约 payload）
        manifest = manifest_rel or "demo/precis-project/project.precis.yaml"
        validate_payload = client.tool_result_payload(
            3, "validate_data", {"manifest": str((server_cwd / manifest).resolve())}
        )
        assert isinstance(validate_payload.get("errors"), list), "validate_data 返回缺 errors 数组"
        assert validate_payload.get("schema_version") == 1

        # 5. tools/call describe_constraints（应覆盖 10 种约束类型）
        describe = client.tool_result_payload(4, "describe_constraints", {})
        type_names = {t["type"] for t in describe.get("types", [])}
        expected = {
            "NotNull",
            "Unique",
            "AllowedValues",
            "Range",
            "ForeignKey",
            "Conditional",
            "Scripted",
            "Charset",
            "DateLogic",
            "Composite",
        }
        assert expected <= type_names, f"约束类型缺失: {expected - type_names}"

        # 6. 路径越界拒绝（manifest 指向白名单外）
        # 越界路径须跨平台：写死 Windows 盘符（Z:/…）在 Linux 非绝对路径、被锚到
        # 根下报"清单不存在"而非"越界"（CI run 35507767842 实证）；系统临时目录
        # 必在 server_cwd（白名单根）之外。
        # H9 修复后工具级失败由 SDK 包装为 isError=true（TextContent 为纯文本
        # 错误消息，不再是 JSON error 体）——此步骤断言 isError 与"越界"文案
        outside = Path(tempfile.gettempdir()) / "precis_mcp_outside" / "project.precis.yaml"
        escaped_resp = client.request(
            5, "tools/call", {"name": "validate_data", "arguments": {"manifest": str(outside)}}
        )
        escaped_result = escaped_resp.get("result", {})
        assert escaped_result.get("isError") is True, f"越界 manifest 应包装为 isError=true: {escaped_result}"
        error_text = "".join(c.get("text", "") for c in escaped_result.get("content", []))
        assert "越界" in error_text, error_text

        return {
            "initialized": True,
            "server_name": server_info.get("name"),
            "tools": tool_names,
            "validate_errors": len(validate_payload["errors"]),
            "validate_is_valid": validate_payload["is_valid"],
            "constraint_types": len(type_names),
            "path_rejected": True,
        }
    finally:
        client.close()


def main() -> int:
    """脚本入口：仓库根为 server 工作目录跑冒烟并打印结果。"""
    result = run_smoke(REPO_ROOT)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("MCP smoke: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
