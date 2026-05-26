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

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


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

    async def dispatch(self, request, call_next):
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
                content={"error": "Internal Server Error", "detail": "An unexpected error occurred"},
            )
