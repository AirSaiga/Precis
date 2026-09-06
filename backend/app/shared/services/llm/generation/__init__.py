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
"""@fileoverview LLM 配置生成服务模块入口

功能概述:
- 导出配置生成服务（ConfigGenerationService）及选项类
- 供上层业务调用以生成 Precis 项目配置

架构设计:
- 聚合导出 service.py 中的公共类和异常
- 通过 __all__ 控制对外暴露的接口

输入示例:
    from app.shared.services.llm.generation import ConfigGenerationService, GenerationOptions

输出示例:
    service = ConfigGenerationService(provider_id="openai")
    result = await service.generate(...)
"""

from .service import CancelledError, ConfigGenerationService, GenerationOptions, GenerationParseError, ProfilingOptions

__all__ = [
    "ConfigGenerationService",
    "GenerationOptions",
    "ProfilingOptions",
    "CancelledError",
    "GenerationParseError",
]
