"""
@fileoverview 请求日志记录中间件

功能概述:
- 记录所有 API 请求的访问日志
- 计算并输出请求处理耗时
- 根据响应状态码分级输出日志（info/warning/error）

架构设计:
- 继承 Starlette BaseHTTPMiddleware
- 在请求前后记录时间戳计算耗时
- 使用 Python logging 模块分级输出

输入示例:
    正常的 HTTP 请求进入中间件处理流程

输出示例:
    日志输出: "GET /api/validation 200 15.32ms"
"""

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration_ms = (time.time() - start_time) * 1000

        log_msg = f"{request.method} {request.url.path} {response.status_code} {duration_ms:.2f}ms"
        if response.status_code >= 500:
            logger.error(log_msg)
        elif response.status_code >= 400:
            logger.warning(log_msg)
        else:
            logger.info(log_msg)

        return response
