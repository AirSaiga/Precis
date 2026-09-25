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
"""@fileoverview infer_schema 工具

Chat mini-agent 可调用的工具：对项目内数据文件确定性推断 schema 草稿。

把 schema_inference.infer_schema（主导类型推断）提升为聊天 agent 的
一等工具，压缩 LLM 凭记忆手写列类型的幻觉空间——建表工作流从
"直接 ADD_SCHEMA 写列定义"改为"先 infer_schema 出草稿 → 按业务语义
微调 → 再 ADD_SCHEMA 落盘"。

输入路径限定项目相对路径：拒绝绝对路径与 .. 穿越（与 ADD_SCHEMA
source.path 的安全口径一致），解析后必须落在项目根内。
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from app.shared.services.schema_inference import infer_schema

logger = logging.getLogger(__name__)


class InferSchemaTool:
    """
    @classdesc 数据文件 schema 推断工具（只读，不写盘）

    封装 schema_inference.infer_schema，返回列名 + 推断类型清单，
    供 LLM 在 ADD_SCHEMA 前获得确定性的列定义草稿。
    """

    NAME = "infer_schema"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径（数据文件路径的解析根）
        """
        self.project_path = project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "对项目内的数据文件（CSV/Excel/JSON）确定性推断 schema 草稿，"
                    "返回每列的名称和推断类型（string/integer/float/boolean/date）。"
                    "为数据文件建表（ADD_SCHEMA）前应先调用本工具获得列定义草稿，"
                    "再按业务语义微调（如金额列把 float 改 decimal、主键列补 primary_key）"
                    "后作为 schemaSpec.columns 提交，不要凭记忆手写列类型。"
                    "file_path 用 list_data_files 返回的相对项目根路径。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "数据文件相对项目根的路径（list_data_files 返回的 path 值）",
                        },
                        "table_name": {
                            "type": "string",
                            "description": "表显示名（可选；不传则取文件名去扩展名）",
                        },
                    },
                    "required": ["file_path"],
                },
            },
        }

    def _resolve_data_file(self, file_path: str) -> Path | None:
        """路径白名单校验：拒绝绝对路径/.. 穿越，解析结果必须落在项目根内。

        返回:
            解析后的绝对路径；路径非法（空/绝对/穿越/越出项目根）返回 None
        """
        rel = (file_path or "").strip().replace("\\", "/")
        if not rel:
            return None
        # 与 ADD_SCHEMA source.path 安全口径一致：绝对路径与 .. 分量一律拒绝
        if os.path.isabs(rel) or ".." in rel.split("/"):
            return None
        try:
            root = Path(self.project_path).resolve()
            resolved = (root / rel).resolve()
        except OSError:
            return None
        # 兜底符号链接绕过：resolve 后仍必须在项目根内
        if resolved != root and root not in resolved.parents:
            return None
        return resolved

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行 schema 推断

        参数:
            arguments: tool 参数，含 file_path（必填）与 table_name（可选）

        返回:
            {"success": bool, "file_path": str, "table_name": str,
             "column_count": int, "columns": [{"name","type"}], "error": str}
            columns 为列名+推断类型清单（完整 schema dict 不全量返回，
            摘要已足够 LLM 微调后构造 schemaSpec.columns）
        """
        file_path = str(arguments.get("file_path") or "")
        # 归一化为 posix 相对路径（与 list_data_files / source.path 口径一致）
        rel = file_path.strip().replace("\\", "/")
        table_name = str(arguments.get("table_name") or "").strip() or None

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "file_path": file_path}

        data_file = self._resolve_data_file(file_path)
        if data_file is None:
            return {
                "success": False,
                "error": (
                    f"数据文件路径不合法: {file_path}"
                    "（须为相对项目根的路径，禁止绝对路径或 .. 穿越；"
                    "可用 list_data_files 获取合法路径）"
                ),
                "file_path": file_path,
            }
        if not data_file.is_file():
            return {
                "success": False,
                "error": f"数据文件不存在: {rel}（可用 list_data_files 确认项目内的数据文件清单）",
                "file_path": file_path,
            }

        try:
            # infer_schema 是同步重计算（pandas 头部采样 + 逐列类型推断），放线程池避免阻塞事件循环
            schema = await asyncio.to_thread(
                infer_schema,
                data_file,
                table_name=table_name,
                source_path=rel,
            )
        except Exception as e:
            logger.warning(f"[infer_schema] 推断失败（{rel}）: {e}")
            return {"success": False, "error": f"schema 推断失败: {e}", "file_path": file_path}

        columns = [
            {"name": str(c.get("name") or c.get("id") or ""), "type": str(c.get("type") or "string")}
            for c in schema.get("columns") or []
        ]
        return {
            "success": True,
            "file_path": rel,
            "table_name": str(schema.get("name") or ""),
            "column_count": len(columns),
            "columns": columns,
        }
