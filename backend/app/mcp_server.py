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
"""@fileoverview Precis MCP server（stdio）

功能概述:
- 以 Model Context Protocol (MCP) stdio 方式对外提供数据校验能力
- 薄协议层：复用 ValidationExecutor / schema_inference / json_payload，
  不分叉第二套输出格式（validate_data 返回值即 CLI --format json 契约）
- 入口：`precis-mcp` 命令（pyproject [project.scripts]）或 `python -m app.mcp_server`

Tools:
- validate_data: 执行校验，返回契约 payload（docs/contracts/validate-json-v1.md）
- check_config: 检查项目配置加载情况（loading_errors/warnings + 装载计数）
- describe_constraints: 列出约束类型与参数说明（类型清单从 registry 派生）
- infer_schema: 从数据文件推断 schema 草稿

安全（P3-3）:
- manifest/数据路径做白名单校验：只允许访问 server 工作目录（及
  PRECIS_MCP_ALLOWED_ROOTS 环境变量追加的根，os.pathsep 分隔）内的文件，
  防 agent 被诱导读取任意路径
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

# 约束类型的参数说明（类型清单从 core registry 派生，此表只补人话描述；
# 新增约束类型时 registry 派生会自动带上，缺描述时用通用文案兜底）
_CONSTRAINT_PARAM_DOCS: dict[str, dict[str, str]] = {
    "NotNull": {"refs": "table_id + column_id", "params": "无"},
    "Unique": {"refs": "table_id + column_ids（列表）", "params": "无"},
    "AllowedValues": {"refs": "table_id + column_id", "params": "allowed_values: 允许值列表"},
    "Range": {"refs": "table_id + column_id", "params": "min/max/boundary_mode(inclusive|exclusive)"},
    "ForeignKey": {"refs": "from_table_id + from_column_id + to_table_id + to_column_id", "params": "无"},
    "Conditional": {
        "refs": "table_id + then_column_id + if_conditions[{if_column_id, operator, value}] + if_logic",
        "params": "then_condition: {operator: not_null}",
    },
    "Scripted": {"refs": "table_id + column_id", "params": "name + expression（需 allow_eval）"},
    "Charset": {"refs": "table_id + column_id", "params": "charset_mode: ascii|chinese|chinese_mixed"},
    "DateLogic": {"refs": "table_id + column_id", "params": "logic_mode: compare + compare_op + reference_date"},
    "Composite": {"refs": "table_id", "params": "logic(all|any) + sub_constraints（内嵌子约束列表）"},
}


def _allowed_roots() -> list[Path]:
    """路径白名单根：server 工作目录 + 环境变量追加根。"""
    roots = [Path.cwd().resolve()]
    extra = os.environ.get("PRECIS_MCP_ALLOWED_ROOTS", "")
    for part in extra.split(os.pathsep):
        if part.strip():
            roots.append(Path(part.strip()).resolve())
    return roots


def _safe_resolve_path(raw: str, kind: str) -> str:
    """校验路径在白名单根内，返回绝对路径。

    Args:
        raw: 调用方（agent）传入的路径
        kind: 路径用途描述（用于错误消息）

    Returns:
        解析后的绝对路径

    Raises:
        ValueError: 路径不在任何白名单根内
    """
    resolved = Path(raw).resolve()
    for root in _allowed_roots():
        if resolved == root or root in resolved.parents:
            return str(resolved)
    raise ValueError(
        f"{kind}路径越界: {raw}（仅允许访问工作目录内的文件；如需扩展范围请设置 PRECIS_MCP_ALLOWED_ROOTS 环境变量）"
    )


def tool_validate_data(manifest: str, data_directory: str | None = None, table: str | None = None) -> dict[str, Any]:
    """执行数据校验（复用 ValidationExecutor，返回契约 payload）。

    Raises:
        ValueError: 路径越界或 manifest 不存在
    """
    from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions
    from app.shared.services.validation.json_payload import build_json_payload

    manifest_path = _safe_resolve_path(manifest, "manifest")
    if not Path(manifest_path).exists():
        raise ValueError(f"清单文件不存在: {manifest_path}")

    data_dir = _safe_resolve_path(data_directory, "数据目录") if data_directory else str(Path(manifest_path).parent)

    # 白名单透传 executor→resolver：manifest/schema 内容声明的 absolute 数据源
    # 同样受根校验约束（防 manifest 内容越界读任意文件）
    executor = ValidationExecutor(manifest_path, allowed_roots=[str(r) for r in _allowed_roots()])
    result = executor.execute(data_dir, ValidationOptions(table_filter=table))
    return build_json_payload(result)


def tool_check_config(manifest: str) -> dict[str, Any]:
    """检查项目配置加载情况（不执行数据校验）。"""
    from app.shared.core.project.loader import load_project

    manifest_path = _safe_resolve_path(manifest, "manifest")
    if not Path(manifest_path).exists():
        raise ValueError(f"清单文件不存在: {manifest_path}")

    loaded = load_project(manifest_path)
    loading_errors = [err.to_dict() for err in loaded.loading_errors or []]
    return {
        "manifest_path": manifest_path,
        "version_ok": not any(e.get("error_type") == "ManifestVersionError" for e in loading_errors),
        "schemas_loaded": len(loaded.schema_files),
        "constraints_loaded": len(loaded.constraint_files),
        "loading_errors": loading_errors,
        "warnings": list(loaded.warnings or []),
    }


def tool_describe_constraints() -> dict[str, Any]:
    """列出全部约束类型与参数说明（类型清单从 core registry 派生）。"""
    from app.shared.core.project.constraint.registry import CONSTRAINT_TYPE_ALIASES

    # registry 的别名值集合即受支持的标准类型名集合
    canonical_types = sorted(set(CONSTRAINT_TYPE_ALIASES.values()) | set(_CONSTRAINT_PARAM_DOCS.keys()))
    types = [
        {
            "type": type_name,
            "refs": _CONSTRAINT_PARAM_DOCS.get(type_name, {}).get("refs", "见 v2-format 文档"),
            "params": _CONSTRAINT_PARAM_DOCS.get(type_name, {}).get("params", "见 v2-format 文档"),
        }
        for type_name in canonical_types
    ]
    return {"types": types, "note": "refs 指向 schema 的表/列 ID；配置格式详见插件 v2-format.md"}


def tool_infer_schema(
    data_file: str,
    sample_rows: int = 1000,
    table_id: str | None = None,
    table_name: str | None = None,
    source_path: str | None = None,
) -> dict[str, Any]:
    """从数据文件推断 schema 草稿（复用 services 层推断逻辑）。"""
    from app.shared.services.schema_inference import infer_schema

    if sample_rows < 1:
        # schema 层已声明 minimum:1；直调路径（协议校验被绕过）在此兜底
        raise ValueError(f"sample_rows 须为正整数，收到: {sample_rows}")
    file_path = _safe_resolve_path(data_file, "数据文件")
    return infer_schema(
        file_path,
        sample_rows=sample_rows,
        table_id=table_id,
        table_name=table_name,
        source_path=source_path,
    )


# ---------------------------------------------------------------------------
# MCP 协议层（官方 SDK，薄封装）
# ---------------------------------------------------------------------------

# tools/list 的输入 schema（JSON Schema 格式）
_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "validate_data": {
        "type": "object",
        "properties": {
            "manifest": {"type": "string", "description": "project.precis.yaml 路径（须在工作目录内）"},
            "data_directory": {"type": "string", "description": "数据目录（缺省为 manifest 所在目录）"},
            "table": {"type": "string", "description": "只校验指定表（缺省校验全部）"},
        },
        "required": ["manifest"],
    },
    "check_config": {
        "type": "object",
        "properties": {"manifest": {"type": "string", "description": "project.precis.yaml 路径"}},
        "required": ["manifest"],
    },
    "describe_constraints": {"type": "object", "properties": {}},
    "infer_schema": {
        "type": "object",
        "properties": {
            "data_file": {"type": "string", "description": "CSV/Excel/JSON 数据文件路径"},
            "sample_rows": {"type": "integer", "minimum": 1, "description": "采样行数（默认 1000）"},
            "table_id": {"type": "string", "description": "表 ID（替换既有 schema 时传原 id）"},
            "table_name": {"type": "string", "description": "表显示名"},
            "source_path": {"type": "string", "description": "写入 schema 的 source.path"},
        },
        "required": ["data_file"],
    },
}

_TOOL_DESCRIPTIONS: dict[str, str] = {
    "validate_data": "执行 Precis 数据校验，返回契约 JSON（is_valid/errors/summary 等，见 docs/contracts/validate-json-v1.md）",
    "check_config": "检查项目配置加载情况（loading_errors/装载计数），不执行校验",
    "describe_constraints": "列出全部约束类型与 refs/params 说明",
    "infer_schema": "从数据文件头部推断列类型，返回 schema YAML 结构草稿",
}


def _dispatch_tool_sync(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """同步工具分派（在工作线程执行，避免阻塞事件循环）。"""
    if name == "validate_data":
        return tool_validate_data(
            manifest=str(arguments["manifest"]),
            data_directory=arguments.get("data_directory"),
            table=arguments.get("table"),
        )
    if name == "check_config":
        return tool_check_config(manifest=str(arguments["manifest"]))
    if name == "describe_constraints":
        return tool_describe_constraints()
    if name == "infer_schema":
        return tool_infer_schema(
            data_file=str(arguments["data_file"]),
            sample_rows=int(arguments.get("sample_rows", 1000)),
            table_id=arguments.get("table_id"),
            table_name=arguments.get("table_name"),
            source_path=arguments.get("source_path"),
        )
    raise ValueError(f"未知工具: {name}")


def _build_server() -> Any:
    """构建 MCP Server 实例（官方 SDK 低级 API）。"""
    import anyio
    from mcp.server import Server
    from mcp.types import TextContent, Tool

    server = Server("precis")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(name=name, description=_TOOL_DESCRIPTIONS[name], inputSchema=schema)
            for name, schema in _TOOL_SCHEMAS.items()
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        # 校验/推断是重同步计算（pandas 加载 + 全表校验），放工作线程执行：
        # 直接在事件循环里阻塞会导致 stdio 读写与工具计算互相等待（Windows 实测死锁）
        # 工具级失败（ValueError：路径越界/非法参数）不在此捕获——H9：SDK 的 call_tool
        # 装饰器统一把 handler 异常包装为 isError=true 的 CallToolResult（server 不崩），
        # 本地包装成正常返回会把协议层失败伪装成成功
        result = await anyio.to_thread.run_sync(_dispatch_tool_sync, name, arguments)
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

    return server


def _warm_up_imports() -> None:
    """启动期（主线程）预热重依赖导入。

    Windows 实测：首次 tools/call 在 anyio 工作线程内触发 executor→pandas 的
    重量级 import 会死锁（import 锁与运行中的事件循环互等）。启动期一次性
    导入后，工具线程内不再发生模块级 import，死锁消除且首调用更快。

    不变量：工具线程内出现的所有 app 内延迟导入都必须在此登记——2026-09-21
    审计实证 json_payload（tool_validate_data 内）与 project_loader
    （executor.build_dataset_schema 惰性导入）破坏该不变量，已补齐。
    """
    from app.shared.services.project_loader import build_dataset_schema  # noqa: F401
    from app.shared.services.schema_inference import infer_schema  # noqa: F401
    from app.shared.services.validation import (
        executor,  # noqa: F401
        json_payload,  # noqa: F401
    )


def main() -> int:
    """precis-mcp 入口：stdio 模式运行 MCP server。"""
    # Windows GBK 控制台下保证协议帧为 UTF-8
    for stream in (sys.stdout, sys.stderr):
        if stream and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError):
                pass

    try:
        from mcp.server import NotificationOptions
        from mcp.server.stdio import stdio_server
    except ImportError:
        # H15：裸装（无 [mcp] extra）给安装指引，不裸 ModuleNotFoundError traceback
        # （对齐 ai 门控先例 6fa1aed4 的 extras 形态指引）
        print(
            "错误：缺少 MCP 依赖（mcp SDK）。precis-mcp 需要 [mcp] extra，请执行:\n  pip install 'precis-cli[mcp]'",
            file=sys.stderr,
        )
        return 1

    _warm_up_imports()

    async def _run() -> None:
        server = _build_server()
        init_options = server.create_initialization_options(
            notification_options=NotificationOptions(
                prompts_changed=False, resources_changed=False, tools_changed=False
            )
        )
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, init_options)

    asyncio.run(_run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
