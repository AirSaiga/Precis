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
    async def dispatch(self, request, call_next):
        try:
            response = await call_next(request)
            return response
        except HTTPException:
            raise
        except Exception:
            logger.error(f"Unhandled exception: {traceback.format_exc()}")
            return JSONResponse(
                status_code=500,
                content={"error": "Internal Server Error", "detail": "An unexpected error occurred"},
            )
