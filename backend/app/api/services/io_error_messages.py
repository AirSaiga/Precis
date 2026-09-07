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
@fileoverview 文件读写异常的用户可读描述

视图/工作区/报告配置等 JSON 文件的读写异常原文（OSError 英文）
直接拼进 HTTP detail 会成为用户看不懂的提示。本模块把常见 OS
错误翻译为中文原因短语，未识别的异常保留原文。
"""

from __future__ import annotations


def describe_io_error(exc: BaseException) -> str:
    """把文件读写异常翻译成用户可读的原因短语。

    Args:
        exc: 读写文件时捕获的异常

    Returns:
        中文原因短语；未识别的异常返回原文
    """
    if isinstance(exc, PermissionError):
        return "文件正被其他程序占用，或没有读写权限"
    if isinstance(exc, FileNotFoundError):
        return "文件不存在，可能已被移动或删除"
    text = str(exc).strip()
    return text or "未知原因"
