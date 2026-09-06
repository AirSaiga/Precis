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
@fileoverview 数据校验路由入口模块

功能概述:
- 创建并导出数据校验模块的 FastAPI APIRouter 实例
- 作为数据校验相关路由的注册入口，供上层应用统一挂载

架构设计:
- 使用 FastAPI 的 APIRouter 创建路由实例
- 设置 tags=["Data Validation"] 便于 Swagger/OpenAPI 文档分类展示
- prefix 由上层应用通过 include_router 时指定，本模块保持为空

输入示例:
    from app.api.routers.validation.router import router
    app.include_router(router, prefix="/validation")

输出示例:
    无直接输出，提供配置好的 APIRouter 实例
"""

from __future__ import annotations

from fastapi import APIRouter

# 创建数据校验模块的路由实例，tags 用于在 API 文档中分组展示
router = APIRouter(prefix="/api/latest", tags=["Data Validation"])

# 导入子模块以注册其路由（content_mode、inline_mode 和 path_mode 通过 from .router import router 装饰本实例）
from . import content_mode, inline_mode, path_mode  # noqa: E402, F401

# history 模块使用独立 router（含 prefix），需要 include_router 注册
from .history import router as history_router  # noqa: E402

router.include_router(history_router)

__all__ = ["router"]
