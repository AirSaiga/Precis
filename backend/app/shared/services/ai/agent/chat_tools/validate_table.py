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
"""@fileoverview validate_table 工具

Chat mini-agent 可调用的工具：执行项目数据校验。

复用 execute_validate_project，支持校验全部表或单个表。
让 LLM 在执行配置修改后，能自主验证改动效果，
若发现问题可进一步调整 actions，实现"改-验-修"自我纠错循环。

加载错误引导：校验因配置文件损坏（SchemaParseError 等解析失败）中止时，
返回值附带 repair_hint（message 同步拼接）——明确指出"读哪个文件原文、
用哪个 UPDATE_* 动作修复"，避免 LLM 面对加载错误误判为环境问题而止步。
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from app.shared.services.llm.validate_executor import execute_validate_project

logger = logging.getLogger(__name__)

# 返回给 LLM 的错误条目上限，避免 observation 过长
_MAX_ERRORS_IN_OBSERVATION = 15

# 修复指引覆盖的加载错误类型 → 对应 UPDATE 动作。加载错误（*ParseError）意味着
# 配置文件本身损坏、校验被中止——不指路的话 LLM 只会复述错误或误判为环境问题
_PARSE_ERROR_REPAIR_ACTIONS = {
    "SchemaParseError": "UPDATE_SCHEMA",
    "ConstraintParseError": "UPDATE_CONSTRAINT_NODE",
    "RegexParseError": "UPDATE_REGEX",
    "TransformParseError": "UPDATE_TRANSFORM",
}

# 修复指引最多列出的文件数：与错误列表截断同思路，更多坏文件由 parse_errors 概览兜底
_MAX_REPAIR_HINT_FILES = 3


def _build_parse_error_repair_hint(
    loading_errors: list[dict[str, Any]],
    project_path: str,
) -> str:
    """从加载错误中提取"文件损坏类"条目，生成给 LLM 的下一步修复指引。

    只处理 *ParseError 家族（YAML 语法错/字段缺失等文件内容问题）；
    NotFound/引用完整性等非损坏类错误不在此列（修复路径不同，指 UPDATE 动作
    反而误导）。文件路径转为相对项目根，直接可喂给 read_config_file。

    参数:
        loading_errors: execute_validate_project 透传的加载错误列表（dict 形式）
        project_path: 当前项目根路径（用于绝对路径→相对路径换算）

    返回:
        指引文本；无损坏类错误时返回空串
    """
    seen_files: set[str] = set()
    parts: list[str] = []
    # 先收集全部损坏类错误的文件集合（去重），用于折叠"另有 N 个"计数
    broken_files = {
        str(le.get("file_path") or "")
        for le in loading_errors
        if str(le.get("error_type") or "") in _PARSE_ERROR_REPAIR_ACTIONS
    }
    for le in loading_errors:
        error_type = str(le.get("error_type") or "")
        action = _PARSE_ERROR_REPAIR_ACTIONS.get(error_type)
        if not action:
            continue
        rel = _relpath_from_project(str(le.get("file_path") or ""), project_path)
        if rel in seen_files:
            continue
        seen_files.add(rel)
        parts.append(f"{rel}（{error_type}）→ 用 read_config_file 查看原文，用 {action} 传回完整配置修复")
        if len(seen_files) >= _MAX_REPAIR_HINT_FILES:
            break

    if not parts:
        return ""
    more = len(broken_files) - len(seen_files)
    tail = f"；另有 {more} 个损坏文件见 read_project 的 parse_errors" if more > 0 else ""
    return "配置文件损坏导致校验中止，修复后重新校验：" + "；".join(parts) + tail


def _relpath_from_project(file_path: str, project_path: str) -> str:
    """把加载错误里的绝对文件路径转为相对项目根的正斜杠路径（喂 read_config_file）。"""
    if not file_path:
        return "未知文件"
    try:
        rel = os.path.relpath(file_path, project_path or ".")
    except ValueError:
        # Windows 跨盘符等场景 relpath 会失败，退化为文件名（仍可辨识）
        return os.path.basename(file_path)
    return rel.replace("\\", "/")


class ValidateTableTool:
    """
    @classdesc 数据校验工具

    封装 execute_validate_project，支持全表或单表校验。
    """

    NAME = "validate_table"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
        """
        self.project_path = project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "执行项目数据校验，检查当前约束规则是否通过。"
                    "可校验全部表（不传 table_name）或指定单表（传 table_name）。"
                    "建议在 apply_actions 修改约束后调用此工具验证效果；"
                    "用户明确要求'校验项目'或'校验某表'时也应调用。"
                    "返回错误数量和具体错误列表；"
                    "配置文件损坏导致校验中止时，结果会附 repair_hint 修复指引"
                    "（用 read_config_file 查原文 + 对应 UPDATE_* 动作修复）。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "要校验的表名（schema 的 name 或 id）。不传则校验所有表。",
                        }
                    },
                    "required": [],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行数据校验

        参数:
            arguments: tool 参数，包含可选的 table_name

        返回:
            {"success": bool, "error_count": int, "errors": [...], "message": str, "repair_hint": str}
            校验因文件损坏类加载错误中止时 repair_hint 非空（message 同步拼接该指引），
            告诉 LLM 读哪个文件原文、用哪个 UPDATE_* 动作修复
        """
        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "error_count": 0, "errors": [], "repair_hint": ""}

        table_name = arguments.get("table_name")
        # 空字符串视为不指定表
        table_filter = table_name if table_name else None

        try:
            # execute_validate_project 是同步函数（内部跑校验引擎），放到线程池
            result = await asyncio.to_thread(
                execute_validate_project,
                self.project_path,
                table_filter,
            )
        except Exception as e:
            logger.exception("validate_table 工具执行失败")
            return {"success": False, "error": f"校验执行失败: {e}", "error_count": 0, "errors": [], "repair_hint": ""}

        # execute_validate_project 返回 {success, message, details}
        # success=True 表示校验流程跑通（不代表数据无错），details 含 error_count
        # （仅真实违规——Scripted 权限跳过已分离到 skipped_scripted_count，不计入）
        details = result.get("details") or {}
        error_count = details.get("error_count", 0)
        raw_errors = details.get("errors", []) or []
        skipped_scripted_count = details.get("skipped_scripted_count", 0)
        loading_errors = details.get("loading_errors", []) or []

        # 文件损坏类加载错误（SchemaParseError 等）→ 给 LLM 明确的修复指引，
        # 而不是只甩错误让它误判为"环境问题"
        repair_hint = _build_parse_error_repair_hint(loading_errors, self.project_path)
        message = result.get("message", "")
        if repair_hint:
            message = f"{message}\n{repair_hint}" if message else repair_hint

        # 截断错误列表，避免 observation 过长
        truncated_errors = raw_errors[:_MAX_ERRORS_IN_OBSERVATION]
        if len(raw_errors) > _MAX_ERRORS_IN_OBSERVATION:
            truncated_count = len(raw_errors) - _MAX_ERRORS_IN_OBSERVATION
        else:
            truncated_count = 0

        return {
            "success": result.get("success", False),
            "error_count": error_count,
            "errors": truncated_errors,
            "truncated_error_count": truncated_count,
            "skipped_scripted_count": skipped_scripted_count,
            "table_filter": table_filter,
            "message": message,
            "repair_hint": repair_hint,
        }
