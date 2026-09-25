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
"""@fileoverview read_config_file 工具

Chat mini-agent 可调用的工具：读取项目内文本文件的原文。

补"诊断配置文件问题"的能力缺口：此前 agent 想看 schemas/*.schema.yaml
的序列化问题只能让用户手工粘贴文件内容。read_project 返回的是解析后的
结构化概览（解析失败的文件只出现在 parse_errors 里），本工具直接读原文，
让 agent 能对照"磁盘上到底写了什么"定位 YAML 语法错误、字段拼写、
序列化漂移等问题。

安全与体积约束：
- 路径校验复用 path_guard（与 infer_schema 同款白名单：拒绝绝对路径/
  .. 穿越，resolve 后必须落在项目根内）
- 扩展名白名单只放行文本配置/数据文件（覆盖全部 V2 配置文件类型）
- AgentMemory 单条消息 8000 字符硬切，默认返回 4000 字符并明确标注
  truncated/total_length/next_offset，超长文件用 offset 分段读取
- 头部嗅探 NUL 字节拒绝二进制文件，防止把二进制垃圾灌进 observation
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.shared.services.ai.agent.chat_tools.path_guard import resolve_project_relative_path

logger = logging.getLogger(__name__)

# 允许读取的文本文件扩展名白名单：覆盖全部 V2 配置文件类型
# （project.precis.yaml、schemas/ constraints/ regex_nodes|regex/ transforms/
# templates/ 下的 yaml）+ 常见文本数据与文档格式
_TEXT_EXTENSIONS = {".yaml", ".yml", ".json", ".jsonl", ".ndjson", ".md", ".txt", ".csv", ".tsv"}

# 默认返回字符数：AgentMemory 单条消息 8000 字符硬切（JSON 序列化还会转义
# 膨胀），4000 字符原文 + 元数据留出安全余量；更长文件用 offset 分段读
_DEFAULT_CONTENT_CHARS = 4000
# length 参数上限（钳制）：防止单次请求挤爆 observation 预算
_MAX_CONTENT_CHARS = 5000
# 二进制嗅探字节数：文件头部该范围内含 NUL 字节视为二进制，拒绝读取
_BINARY_SNIFF_BYTES = 8192
# 超过该字节数的文件不再全文解码统计精确字符数（代价大），total_length 返回 None
_MAX_TOTAL_SCAN_BYTES = 2_000_000
# 超大文件流式跳过 offset 时的块大小（字符），避免一次性物化超大字符串
_SKIP_BLOCK_CHARS = 1_000_000


class ReadConfigFileTool:
    """
    @classdesc 项目内文本文件原文读取工具（只读，不写盘）

    返回文件指定字符窗口的原文与截断标注，供 LLM 诊断配置解析失败、
    核对文件真实内容。
    """

    NAME = "read_config_file"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径（文件路径的解析根）
        """
        self.project_path = project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "读取项目内文本文件（yaml/yml/json/jsonl/ndjson/md/txt/csv/tsv）的原文。"
                    "read_project 的 parse_errors 报某配置文件解析失败时，用本工具查看该文件原文定位问题"
                    "（YAML 语法错误、字段拼写、序列化异常）；也可用于核对配置文件的真实字段与格式细节。"
                    "file_path 用相对项目根的路径（如 schemas/产品库存表.schema.yaml、project.precis.yaml）。"
                    "返回内容超过长度上限时会标注 truncated/total_length/next_offset，"
                    "用 next_offset 作为下次调用的 offset 继续分段读取。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "文件相对项目根的路径（如 schemas/xxx.schema.yaml、project.precis.yaml）",
                        },
                        "offset": {
                            "type": "integer",
                            "description": "起始字符偏移（默认 0；分段续读用上次返回的 next_offset）",
                        },
                        "length": {
                            "type": "integer",
                            "description": f"本次最多返回的字符数（默认 {_DEFAULT_CONTENT_CHARS}，上限 {_MAX_CONTENT_CHARS}）",
                        },
                    },
                    "required": ["file_path"],
                },
            },
        }

    def _resolve_config_file(self, file_path: str) -> Path | None:
        """路径白名单校验（委托 path_guard 单一实现，与 infer_schema 同口径）。"""
        return resolve_project_relative_path(self.project_path, file_path)

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行文件原文读取

        参数:
            arguments: tool 参数，含 file_path（必填）与 offset/length（可选，分段读取）

        返回:
            成功: {"success": True, "file_path": str, "offset": int, "content": str,
                  "content_length": int, "total_length": int|None, "truncated": bool,
                  "next_offset": int|None}
            - truncated=True 表示文件还有未读部分，next_offset 给出续读偏移
            - total_length 为文件总字符数；超大文件（>2MB）不统计时为 None
            失败: {"success": False, "error": str, "file_path": str}
            （路径不合法/文件不存在/扩展名不支持/二进制文件/offset 越界）
        """
        file_path = str(arguments.get("file_path") or "")
        # 归一化为 posix 相对路径（与 list_data_files / infer_schema 口径一致）
        rel = file_path.strip().replace("\\", "/")

        # offset/length 归一化：负值钳到合法下界，length 钳到预算上限
        try:
            offset = max(0, int(arguments.get("offset") or 0))
        except (TypeError, ValueError):
            return {
                "success": False,
                "error": f"offset 必须是整数: {arguments.get('offset')!r}",
                "file_path": file_path,
            }
        raw_length = arguments.get("length")
        try:
            length = _DEFAULT_CONTENT_CHARS if raw_length is None else max(1, min(int(raw_length), _MAX_CONTENT_CHARS))
        except (TypeError, ValueError):
            return {"success": False, "error": f"length 必须是整数: {raw_length!r}", "file_path": file_path}

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "file_path": file_path}

        config_file = self._resolve_config_file(file_path)
        if config_file is None:
            return {
                "success": False,
                "error": (
                    f"文件路径不合法: {file_path}"
                    "（须为相对项目根的路径，禁止绝对路径或 .. 穿越；"
                    "合法路径可参考 read_project 返回的 path 字段或 parse_errors 中的文件路径）"
                ),
                "file_path": file_path,
            }
        if not config_file.is_file():
            return {
                "success": False,
                "error": f"文件不存在: {rel}（可用 read_project 查看项目配置清单）",
                "file_path": file_path,
            }

        suffix = config_file.suffix.lower()
        if suffix not in _TEXT_EXTENSIONS:
            allowed = ", ".join(sorted(_TEXT_EXTENSIONS))
            return {
                "success": False,
                "error": f"不支持的文件类型: {suffix or '(无扩展名)'}（本工具只读文本文件: {allowed}）",
                "file_path": file_path,
            }

        try:
            # 文件读取是同步 IO，放到线程池避免阻塞事件循环（与 read_project 同模式）
            return await asyncio.to_thread(self._read_text_window, config_file, rel, offset, length)
        except OSError as e:
            logger.warning(f"[read_config_file] 读取失败（{rel}）: {e}")
            return {"success": False, "error": f"读取文件失败: {e}", "file_path": file_path}

    def _read_text_window(self, path: Path, rel: str, offset: int, length: int) -> dict[str, Any]:
        """
        @methoddesc 读取 [offset, offset+length) 字符窗口（在线程池中执行）

        体积策略：小文件（<=2MB）全文解码精确统计总长度；大文件只流式读
        目标窗口（跳过块有界，不物化整个文件），总长度未知时 total_length
        返回 None，但读不满请求长度即可断定已到末尾。

        参数:
            path: 已通过白名单校验的绝对路径
            rel: 归一化后的项目相对路径（返回给 LLM 的 file_path）
            offset: 起始字符偏移（>=0）
            length: 读取字符数（已钳制到 [1, _MAX_CONTENT_CHARS]）
        """
        size = path.stat().st_size

        # 二进制嗅探：头部含 NUL 字节一律拒绝（NUL 是合法 UTF-8 码位，
        # 解码不会报错，必须显式检测，防止二进制内容灌进 observation）
        with open(path, "rb") as bf:
            head = bf.read(_BINARY_SNIFF_BYTES)
        if b"\x00" in head:
            return {
                "success": False,
                "error": f"文件不是文本文件（疑似二进制内容）: {rel}",
                "file_path": rel,
            }

        if size <= _MAX_TOTAL_SCAN_BYTES:
            # 常态路径：配置文件是小文件，一次性全文解码精确统计
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError as e:
                return {
                    "success": False,
                    "error": f"文件不是 UTF-8 文本（解码失败，可能为二进制或其他编码）: {rel}（{e}）",
                    "file_path": rel,
                }
            total = len(text)
            if total > 0 and offset >= total:
                return {
                    "success": False,
                    "error": f"offset {offset} 已超出文件总长度 {total}（文件已读完，无需继续读取）",
                    "file_path": rel,
                }
            chunk = text[offset : offset + length]
            truncated = offset + len(chunk) < total
            return self._window_result(rel, offset, chunk, total, truncated)

        # 超大文件：只流式读取目标窗口，不全文解码
        try:
            with open(path, encoding="utf-8") as f:
                # 按块跳过 offset 个字符（丢弃已读内容，内存有界）
                remaining = offset
                while remaining > 0:
                    block = f.read(min(remaining, _SKIP_BLOCK_CHARS))
                    if not block:
                        break
                    remaining -= len(block)
                chunk = f.read(length)
        except UnicodeDecodeError as e:
            return {
                "success": False,
                "error": f"文件不是 UTF-8 文本（解码失败，可能为二进制或其他编码）: {rel}（{e}）",
                "file_path": rel,
            }
        if offset > 0 and not chunk and remaining > 0:
            # 跳过阶段就撞到 EOF：offset 超出文件实际长度
            actual = offset - remaining
            return {
                "success": False,
                "error": f"offset {offset} 已超出文件总长度 {actual}（文件已读完，无需继续读取）",
                "file_path": rel,
            }
        if len(chunk) < length:
            # 读不满请求长度 → 已到文件末尾，总长度即可知
            return self._window_result(rel, offset, chunk, (offset - remaining) + len(chunk), truncated=False)
        # 读满请求长度但不知道后面还有多少：total 未知，标记 truncated 让 LLM 续读
        return self._window_result(rel, offset, chunk, None, truncated=True)

    @staticmethod
    def _window_result(rel: str, offset: int, chunk: str, total: int | None, truncated: bool) -> dict[str, Any]:
        """组装窗口读取结果（含截断标注，让 LLM 知道如何续读）。"""
        return {
            "success": True,
            "file_path": rel,
            "offset": offset,
            "content": chunk,
            "content_length": len(chunk),
            "total_length": total,
            "truncated": truncated,
            "next_offset": (offset + len(chunk)) if truncated else None,
        }
