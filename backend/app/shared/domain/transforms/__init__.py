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
@fileoverview Transform 运行器包

导出:
- TransformRunner: 抽象基类
- create_runner: 工厂函数
- TRANSFORM_REGISTRY: 注册表
"""

from .base import TransformRunner
from .registry import TRANSFORM_REGISTRY, create_runner

__all__ = ["TransformRunner", "TRANSFORM_REGISTRY", "create_runner"]
