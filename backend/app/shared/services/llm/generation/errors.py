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
"""@fileoverview 配置生成异常定义

生成链路各子模块（响应解析/数据剖析/Agent 装配）共享的异常类型，
独立成模块以避免 service ↔ 子模块循环导入；service.py 对外重导出保持既有导入路径不变。
"""

from __future__ import annotations


class GenerationParseError(Exception):
    """LLM 响应解析失败"""

    def __init__(self, message: str, raw_content: str = ""):
        super().__init__(message)
        self.raw_content = raw_content


class CancelledError(Exception):
    """生成被取消"""

    pass
