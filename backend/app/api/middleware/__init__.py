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
