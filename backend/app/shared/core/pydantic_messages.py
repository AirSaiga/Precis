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
"""
@fileoverview Pydantic 校验消息的中文本地化（单一事实源）

Pydantic 的校验消息默认是英文（"Input should be a valid integer" 等），
直接透给用户属于黑话。本模块提供常见消息的中文映射（子串替换，保留
位置与字段等上下文），供 422 全局 handler 与 LLM 动作 spec 校验共用。
未命中的消息保留原文，不会显示空白。
"""

from __future__ import annotations

# 英文片段 → 中文（按出现顺序做子串替换）
_PATTERNS: list[tuple[str, str]] = [
    ("Input should be a valid integer", "应为整数"),
    ("Input should be a valid number", "应为数字"),
    ("Input should be a valid string", "应为文本"),
    ("Input should be a valid boolean", "应为 true/false"),
    ("Input should be a valid dictionary", "应为对象"),
    ("Input should be a valid list", "应为列表"),
    ("Input should be a valid date", "应为日期"),
    ("Input should be a valid email address", "应为有效的邮箱地址"),
    ("Input should be a valid URL", "应为有效的 URL"),
    ("Field required", "缺少必填字段"),
    ("Extra inputs are not permitted", "存在不允许的多余字段"),
    ("Input should be greater than or equal to", "不能小于"),
    ("Input should be less than or equal to", "不能大于"),
    ("String should have at least 1 character", "内容不能为空"),
    ("Input should be a valid enumeration value", "取值不在允许范围内"),
    ("Unable to extract tag using discriminator", "数据结构与预期的不一致"),
]


def localize_pydantic_msg(msg: str) -> str:
    """将一条 Pydantic 校验消息中的常见英文片段替换为中文。

    Args:
        msg: Pydantic 的 msg 字段原文

    Returns:
        本地化后的消息（未命中的片段保持原文）
    """
    for en, zh in _PATTERNS:
        msg = msg.replace(en, zh)
    return msg
