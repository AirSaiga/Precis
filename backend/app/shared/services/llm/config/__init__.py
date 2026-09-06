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
@fileoverview AI 配置模块聚合导出

功能概述:
- 聚合导出 AI 配置相关的模型、加载器
- 为上层 LLM 服务提供统一的配置入口

架构设计:
- 通过 __init__.py 聚合子模块公共接口，降低外部导入复杂度
- 遵循显式导出原则，使用 __all__ 控制公开 API

输入示例:
    from app.shared.services.llm.config import AIConfig, ConfigLoader

输出示例:
    AIConfig 实例与 ConfigLoader 实例可直接用于 provider 配置加载
"""

from .loader import ConfigLoader, loader
from .models import AIConfig, AIProvider, DeploymentType, NetworkConfig, ProviderType

__all__ = [
    "AIConfig",
    "AIProvider",
    "ProviderType",
    "DeploymentType",
    "NetworkConfig",
    "ConfigLoader",
    "loader",
]
