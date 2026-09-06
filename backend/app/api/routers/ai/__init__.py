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
@fileoverview AI 路由包入口

功能概述:
- 作为 AI 相关 API 路由的统一出口
- 从 router 模块导入主路由实例，保持与旧代码的兼容性
- 导出 models 子模块供外部使用

输入示例:
    from app.api.routers.ai import router
    app.include_router(router, prefix="/ai")

输出示例:
    router: APIRouter 实例，包含所有 AI 相关端点
    models: AI 相关数据模型子模块
"""

from . import models
from .router import router

__all__ = ["router", "models"]
