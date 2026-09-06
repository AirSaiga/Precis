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
@fileoverview 核心路由模块包入口

功能概述:
- 标记 backend/app/api/routers/core 目录为 Python 包
- 聚合正则工具、报告通知、白名单管理、工作区配置等核心路由

架构设计:
- 各子模块独立定义 APIRouter 实例
- 通过 api/routers/__init__.py 统一导入并注册到主应用
- 核心路由提供不依赖具体项目配置的基础服务能力

输入示例:
    from app.api.routers.core.regex import router as regex_router
    from app.api.routers.core.reporting import router as reporting_router

输出示例:
    无直接输出，仅作为包标记
"""
