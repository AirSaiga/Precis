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
@fileoverview 数据校验路由模块包入口

功能概述:
- 导出数据校验相关的 FastAPI 路由实例，供上层应用注册
- 统一暴露 validation_router 别名，便于其他模块导入使用

架构设计:
- 从 router.py 导入 APIRouter 实例
- 通过 __all__ 控制对外公开的接口

输入示例:
    from app.api.routers.validation import validation_router
    app.include_router(validation_router)

输出示例:
    无直接输出，提供路由实例引用
"""

from .router import router

validation_router = router

__all__ = ["router", "validation_router"]
