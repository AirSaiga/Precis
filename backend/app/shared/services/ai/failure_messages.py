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
@fileoverview AI 服务调用失败的用户可读消息构造

把 openai SDK / httpx 的底层异常翻译成用户可读的中文摘要：
- 按异常类名（而非 import）判定类别，兼容 openai 包缺失的环境
- 常见类别给出明确的中文指引（连不上/超时/鉴权/限流/服务错误）
- 原始异常文本保留在消息尾部，便于高级用户与支持人员排查；
  完整堆栈由调用方的日志负责记录
"""

from __future__ import annotations

# 异常类名 → 中文摘要。openai SDK 异常按类名匹配（包可能未安装，不做 import），
# httpx 网络异常同名覆盖（APIConnectionError 内层多为 httpx.ConnectError）。
_SUMMARY_BY_NAME: dict[str, str] = {
    "APIConnectionError": "无法连接到 AI 服务，请检查网络连接、服务地址是否正确，或本地服务是否已启动",
    "ConnectError": "无法连接到 AI 服务，请检查网络连接与服务地址",
    "APITimeoutError": "AI 服务响应超时，请稍后重试",
    "ReadTimeout": "AI 服务响应超时，请稍后重试",
    "TimeoutException": "AI 服务响应超时，请稍后重试",
    "AuthenticationError": "AI 服务鉴权失败，请检查 API Key 是否正确",
    "PermissionDeniedError": "AI 服务拒绝了本次请求，请检查 API Key 的权限与可用额度",
    "NotFoundError": "AI 服务返回 404，请检查服务地址（base_url）与模型名称是否正确",
    "RateLimitError": "AI 服务限流中，请稍后重试",
    "BadRequestError": "AI 服务拒绝了本次请求，请检查模型名称与参数是否正确",
    "UnprocessableEntityError": "AI 服务无法处理本次请求，请检查输入内容",
}


def describe_ai_failure(exc: BaseException) -> str:
    """把 AI 服务底层异常翻译成用户可读的一句话。

    规则：已知类别给中文指引；带 HTTP 状态码的异常补充状态码；
    原始异常文本以"原始错误"形式保留在尾部（外层日志记录完整堆栈）。

    Args:
        exc: chat/stream 调用链捕获到的任意异常

    Returns:
        可直接放进 HTTP detail / 聊天错误字段的中文消息
    """
    summary = _SUMMARY_BY_NAME.get(type(exc).__name__)
    if summary is None:
        status_code = getattr(exc, "status_code", None)
        summary = f"AI 服务返回错误（HTTP {status_code}）" if isinstance(status_code, int) else "AI 服务调用失败"

    detail = str(exc).strip()
    if detail and detail not in summary:
        return f"{summary}（原始错误：{detail}）"
    return summary
