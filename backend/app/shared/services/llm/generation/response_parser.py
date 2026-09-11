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
"""@fileoverview LLM 响应 JSON 提取与解析

从 LLM 返回的自由文本中可靠地提取 JSON 配置对象。核心是字符串感知的
大括号配平扫描：JSON 字符串值内的 '{' / '}' 不参与配平，避免字符串值
包含 '}' 时把合法 JSON 截断（如 {"a":"x}y"} 被截成 {"a":"x}）。
"""

from __future__ import annotations

import json
import re

from .errors import GenerationParseError


def find_json_object_end(text: str, start: int) -> int | None:
    """从 start（应指向 '{'）开始做字符串感知的大括号配平扫描。

    跟踪扫描位置是否处于双引号字符串内部（处理反斜杠转义）：
    字符串内的 '{' / '}' 不参与配平，避免 JSON 字符串值包含 '}' 时
    把合法 JSON 截断（如 {"a":"x}y"} 被截成 {"a":"x}）。

    参数:
        text: 待扫描文本
        start: 起始索引（text[start] 应为 '{'）

    返回:
        匹配闭括号的索引（含）；扫描不到配平闭括号时返回 None
    """
    balance = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        char = text[i]
        if in_string:
            if escaped:
                # 转义序列的第二个字符被消耗，不参与边界判断
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            balance += 1
        elif char == "}":
            balance -= 1
            if balance == 0:
                return i
    return None


def parse_llm_response(content: str) -> dict:
    """解析 LLM 返回的文本，提取其中的 JSON 配置。

    处理步骤：
    1. 尝试提取 Markdown 代码块（```json ... ```）中的内容
    2. 通过大括号平衡计数找到最外层的 JSON 对象
    3. 使用 json.loads 解析

    参数:
        content: LLM 返回的原始文本

    返回:
        解析出的 JSON 对象字典

    异常:
        GenerationParseError: 内容无法解析为 JSON 对象（携带原始内容前 2000 字符）
    """
    original = content

    # 尝试找到 Markdown JSON 代码块
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
    if match:
        content = match.group(1).strip()

    # 通过大括号平衡计数找到最外层的 JSON 对象（字符串感知，字符串内的 '}' 不参与配平）
    start = content.find("{")
    if start != -1:
        end = find_json_object_end(content, start)
        if end is not None:
            content = content[start : end + 1]

    try:
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise GenerationParseError(
                f"LLM 响应解析结果不是 JSON 对象，实际类型: {type(parsed).__name__}",
                raw_content=original[:2000],
            )
        return parsed
    except json.JSONDecodeError as e:
        raise GenerationParseError(
            f"AI 返回的内容无法解析为有效配置，请重试或调整描述后重试（{e}）",
            raw_content=original[:2000],
        )


def try_extract_json_object(content: str | None) -> dict | None:
    """尽力从文本中提取一个 JSON 对象，失败返回 None（不抛异常）。

    与 parse_llm_response 的差别：本函数用于"兜底解析"场景
    （如 Agent 最后一轮 content），解析失败不视为错误。

    参数:
        content: 待提取的文本，可为 None

    返回:
        提取到的 JSON 对象字典；无法提取时返回 None
    """
    if not content:
        return None
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
    text = match.group(1).strip() if match else content
    start = text.find("{")
    if start == -1:
        return None
    end = find_json_object_end(text, start)
    if end is None:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        return None
    return None
