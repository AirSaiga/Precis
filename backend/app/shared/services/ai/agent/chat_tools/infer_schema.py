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
from pathlib import Path
from typing import Any

from app.shared.services.ai.agent.chat_tools.path_guard import resolve_project_relative_path
from app.shared.services.schema_inference import infer_schema

logger = logging.getLogger(__name__)

# Excel 扩展名集合：推断失败时的工作表名自愈判定口径（与 read_table 同集合）
_EXCEL_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}


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
                    "file_path 用 list_data_files 返回的相对项目根路径；"
                    "多 sheet Excel 必须传 sheet 指定工作表（不传读第一张表，可能推错列）。"
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
                        "sheet": {
                            "type": "string",
                            "description": (
                                "Excel 工作表名（可选）。多 sheet 文件必须指定，"
                                "否则读第一张表可能推错列；可用 list_data_files 返回的 sheets 字段查看可用工作表"
                            ),
                        },
                        "header_row": {
                            "type": "integer",
                            "description": "表头行索引（可选，默认 0 即首行为表头）；有标题行的报表设为标题行之后的行号",
                        },
                    },
                    "required": ["file_path"],
                },
            },
        }

    def _resolve_data_file(self, file_path: str) -> Path | None:
        """路径白名单校验（委托 path_guard 单一实现，与 read_config_file 同口径）。

        返回:
            解析后的绝对路径；路径非法（空/绝对/穿越/越出项目根）返回 None
        """
        return resolve_project_relative_path(self.project_path, file_path)

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行 schema 推断

        参数:
            arguments: tool 参数，含 file_path（必填）与 table_name / sheet /
                header_row（可选；sheet 多 sheet Excel 必填，header_row 报表
                标题行场景用于跳过标题取真实表头）

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
        # sheet/header_row 透传给底层推断：多 sheet 指向 Sheet2 却读第一张表、
        # 标题行被当表头，都会让草稿列与真实数据错位（G1 数据误判）。
        # 防御口径与 schema_handlers._infer_columns_from_source 一致
        sheet = arguments.get("sheet")
        sheet_name = sheet.strip() if isinstance(sheet, str) and sheet.strip() else None
        raw_header_row = arguments.get("header_row", 0)
        header_row = raw_header_row if isinstance(raw_header_row, int) and raw_header_row >= 0 else 0

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
                sheet_name=sheet_name,
                header_row=header_row,
            )
        except Exception as e:
            logger.warning(f"[infer_schema] 推断失败（{rel}）: {e}")
            return {"success": False, "error": self._build_infer_error(data_file, e), "file_path": file_path}

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

    def _build_infer_error(self, data_file: Path, exc: Exception) -> str:
        """
        @methoddesc 构造推断失败的 error 文案（含 Excel 工作表名自愈）

        与 read_table._build_load_error 同口径：Excel 遇到工作表名错误
        （pandas 的 Worksheet not found）时附带可用工作表清单，LLM 可据此
        直接修正 sheet 参数重试，无需追问用户；读取清单本身失败
        （文件损坏/被占用）则只返回根因。
        """
        message = f"schema 推断失败: {exc}"
        if data_file.suffix.lower() not in _EXCEL_EXTENSIONS or "Worksheet" not in str(exc):
            return message
        try:
            from app.shared.core.data_source.loaders.excel_loader import get_excel_sheet_names

            sheets = get_excel_sheet_names(str(data_file))
        except Exception as e:
            logger.debug(f"读取可用工作表列表失败 {data_file}: {e}")
            return message
        return f"{message}；可用工作表: {sheets}"
