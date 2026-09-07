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
@fileoverview 全局异常处理中间件

功能概述:
- 捕获 API 请求处理过程中的未处理异常
- 将异常转换为统一的 JSON 错误响应
- 避免异常信息泄露，返回安全的内部服务器错误提示

架构设计:
- 继承 Starlette BaseHTTPMiddleware
- 通过 dispatch 方法包装请求处理流程
- 对 HTTPException 直接抛出，其他异常统一捕获并记录日志

输入示例:
    正常的 HTTP 请求进入中间件处理流程

输出示例:
    当发生未处理异常时返回:
    {"error": "Internal Server Error", "detail": "An unexpected error occurred"}
"""

import logging
import traceback
from collections.abc import Awaitable, Callable

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.shared.core.pydantic_messages import localize_pydantic_msg

logger = logging.getLogger(__name__)


async def request_validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 请求校验错误的全局 handler。

    保持 FastAPI 默认的响应结构（detail 为 loc/msg/type 数组，前端按此解析），
    仅把每条 msg 本地化为中文——否则 Pydantic 的英文校验消息
    （"Input should be a valid integer" 等）会经前端原样展示给用户。

    签名收窄说明：Starlette 的 add_exception_handler 要求
    Callable[[Request, Exception], ...]（参数逆变），用具体异常类型作
    参数注解会挂 mypy 全量检查，故收宽为 Exception 后 isinstance 收窄。

    Args:
        request: 当前请求
        exc: FastAPI 请求体/参数校验错误

    Returns:
        422 JSONResponse，结构与 FastAPI 默认一致

    Raises:
        exc: 非 RequestValidationError 时原样上抛（注册绑定保证了不会走到）
    """
    if not isinstance(exc, RequestValidationError):
        raise exc
    errors = []
    for err in exc.errors():
        item = dict(err)
        item["msg"] = localize_pydantic_msg(str(item.get("msg", "")))
        errors.append(item)
    return JSONResponse(status_code=422, content={"detail": errors})


class ExceptionHandlerMiddleware(BaseHTTPMiddleware):
    """
    全局异常处理中间件

    继承自 Starlette 的 BaseHTTPMiddleware，通过包装请求处理流程，
    捕获所有未处理的异常并转换为统一的 JSON 错误响应。

    处理策略:
        - HTTPException: 直接向上抛出，由 FastAPI 的默认异常处理器处理
        - 其他 Exception: 记录完整堆栈日志，返回安全的 500 错误响应（避免泄露敏感信息）

    Attributes:
        无额外属性，依赖父类 BaseHTTPMiddleware 的基础设施
    """

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        """
        分发并包装请求处理流程，捕获未处理异常

        Args:
            request: 当前 HTTP 请求对象，包含方法、路径、头信息等
            call_next: 下一个中间件或路由处理器的可调用对象

        Returns:
            Response: 正常响应或异常时的 JSONResponse（500 状态码）

        Raises:
            HTTPException: FastAPI 的 HTTP 异常直接向上抛出，不做拦截
        """
        try:
            # 调用下游中间件或路由处理器，获取正常响应
            response = await call_next(request)
            return response
        except HTTPException:
            # FastAPI 的 HTTPException 直接抛出，由上层默认处理器生成标准 HTTP 错误响应
            raise
        except Exception:
            # 捕获所有未预料的异常，记录完整堆栈以便排查问题
            logger.error(f"Unhandled exception: {traceback.format_exc()}")
            # 返回安全的通用错误响应，避免将内部异常详情暴露给客户端
            return JSONResponse(
                status_code=500,
                content={"error": "Internal Server Error", "detail": "服务器内部错误，请稍后重试"},
            )
