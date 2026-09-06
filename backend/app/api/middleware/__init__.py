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
@fileoverview API 中间件模块包入口

功能概述:
- 标记 backend/app/api/middleware 目录为 Python 包
- 聚合全局异常处理和请求日志记录等中间件组件

架构设计:
- 各中间件继承 Starlette BaseHTTPMiddleware
- 通过主应用 main.py 统一注册，按顺序执行
- 异常处理中间件应在最外层，请求日志在最内层

输入示例:
    from app.api.middleware.exception_handler import ExceptionHandlerMiddleware
    from app.api.middleware.request_logging import RequestLoggingMiddleware

输出示例:
    无直接输出，仅作为包标记
"""
