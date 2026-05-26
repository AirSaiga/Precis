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
    """
    请求日志记录中间件

    继承自 Starlette 的 BaseHTTPMiddleware，在请求处理前后记录时间戳，
    计算请求处理耗时，并根据响应状态码分级输出日志（info/warning/error）。

    日志分级策略:
        - 2xx/3xx: info 级别（正常请求）
        - 4xx: warning 级别（客户端错误，如参数校验失败）
        - 5xx: error 级别（服务器内部错误）

    Attributes:
        无额外属性，依赖父类 BaseHTTPMiddleware 的基础设施
    """

    async def dispatch(self, request, call_next):
        """
        分发并包装请求处理流程，记录访问日志和耗时

        Args:
            request: 当前 HTTP 请求对象，包含 method、url、headers 等信息
            call_next: 下一个中间件或路由处理器的可调用对象

        Returns:
            Response: 下游处理返回的响应对象（原样返回，不做修改）
        """
        # 记录请求开始时间戳（秒级浮点数）
        start_time = time.time()

        # 调用下游中间件或路由处理器，获取响应
        response = await call_next(request)

        # 计算请求处理耗时，转换为毫秒（保留两位小数）
        duration_ms = (time.time() - start_time) * 1000

        # 拼接日志消息：方法 路径 状态码 耗时
        log_msg = f"{request.method} {request.url.path} {response.status_code} {duration_ms:.2f}ms"

        # 根据 HTTP 状态码分级输出日志：
        # 5xx 表示服务器内部错误，使用 error 级别
        if response.status_code >= 500:
            logger.error(log_msg)
        # 4xx 表示客户端错误（如 400 Bad Request, 422 Validation Error），使用 warning 级别
        elif response.status_code >= 400:
            logger.warning(log_msg)
        # 2xx/3xx 表示正常响应，使用 info 级别
        else:
            logger.info(log_msg)

        return response
