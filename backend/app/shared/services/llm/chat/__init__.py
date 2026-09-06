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
@fileoverview LLM 对话与响应解析子包

功能概述:
- build_system_prompt: 系统提示词构建
- ActionParser: LLM JSON 响应解析器

架构设计:
- 直接调用 Provider 的 async 接口（chat/chat_stream），不再有同步包装层
  （历史上的 ChatLLMService + _run_async 已移除，因为它在 async 上下文里
  会开子线程跑 asyncio.run，导致 httpx 连接池清理任务泄漏 event loop）
"""

from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt
from app.shared.services.llm.chat.response_parser import ActionParser

__all__ = [
    "ActionParser",
    "build_system_prompt",
]
