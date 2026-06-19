# backend/app/api/main.py
"""
@fileoverview FastAPI 应用入口模块

功能概述:
- 创建和配置 FastAPI 应用实例
- 配置 CORS 中间件支持跨域请求
- 注册所有 API 路由
- 提供根路径的健康检查端点

架构设计:
- 单入口: 所有路由通过此模块注册
- 中间件模式: 使用 FastAPI 中间件机制处理横切关注点
- 模块化路由: 路由按功能模块分组（project, utils, reporting 等）

Electron 集成说明:
- 添加了 electron://. 和 app://. 到 CORS 白名单
- 支持 Electron 渲染进程的本地文件访问
- 127.0.0.1:8000 用于后端自检

日志配置:
- 配置 logging 以显示 HTTP 请求和响应信息
- 使用 uvicorn 的访问日志记录器
- 可通过环境变量 LOG_LEVEL 控制日志级别
"""

import os
import sys

# ============================================================================
# 路径配置（必须最先执行！）
# ============================================================================

# 添加项目根目录到 Python 导入路径
# __file__ = D:\8C39-1364\Precis-Community\backend\app\api\main.py
# main.py → api → app → backend → Precis-Community
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

# ============================================================================
# 日志与输出配置
# ============================================================================

import logging

logger = logging.getLogger(__name__)
logger.info("[INIT] Precis Backend 启动中...")
logger.info("[INIT] Python 版本: %s", sys.version)
logger.info("[INIT] 项目根目录: %s", _project_root)
logger.info("[INIT] sys.path[0]: %s", sys.path[0])

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .middleware.exception_handler import ExceptionHandlerMiddleware
from .middleware.request_logging import RequestLoggingMiddleware
from .routers import (
    ai_router,
    connection_rules_router,
    data_sources_router,
    preview_router,
    project_router,
    projects_router,
    regex_router,
    reporting_router,
    validation_router,
)

# ============================================================================
# FastAPI 应用创建
# ============================================================================

# 创建 FastAPI 应用实例
# [FastAPI 配置说明]
# - title: API 文档中显示的标题
# - description: API 功能描述
# - version: API 版本号，用于版本管理
app = FastAPI(
    title="数据校验工具 API",
    description="为数据校验工具前端提供后端服务的 API。",
    version="1.0.0",
)

# ============================================================================
# 日志配置
# ============================================================================


def configure_logging():
    """
    配置应用日志记录器

    【功能说明】
    - 配置根日志级别
    - 确保应用日志输出到控制台
    - 注意：uvicorn.access 日志由 Uvicorn 服务器在启动时自动配置，此处不应干预
    """
    log_level_str = os.environ.get("LOG_LEVEL", "info").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    # 配置根日志
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # 确保有 handler 输出到控制台
    if not root_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(log_level)
        formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)

    # 配置 FastAPI 日志（仅设置级别）
    fastapi_logger = logging.getLogger("fastapi")
    fastapi_logger.setLevel(log_level)

    print(f"[Startup] 日志配置完成，级别: {log_level_str}", flush=True)


# 应用启动时配置日志
configure_logging()

# ============================================================================
# CORS 配置
# ============================================================================

# 注册 CORS 中间件
# [FastAPI] CORSMiddleware 处理浏览器跨域请求
#
# [配置说明]
# - allow_origins: 允许的来源列表
#   支持动态端口：使用正则表达式匹配 127.0.0.1 的任意端口
#   这样 Electron 使用动态分配的端口时也能正常访问
#
# - allow_credentials: 允许携带认证信息（cookies、headers）
#   [安全性] 配合 allow_origins 使用，防止 CSRF 攻击
# - allow_methods: 允许的 HTTP 方法，["*"] 表示全部允许
# - allow_headers: 允许的 HTTP 头，["*"] 表示全部允许
import re

# 定义允许的跨域来源列表
# [设计说明]
# - 明确列出允许的来源，而非使用通配符
# - 便于追踪和审计谁可以访问 API
# - 提高安全性
# - 支持动态端口：使用正则表达式匹配 127.0.0.1 和 localhost 的任意端口
# [安全考量] 生产环境应限制为具体域名，避免开放过多来源
origins = [
    # 后端自检（动态端口范围）
    "http://127.0.0.1:8000",
    # macOS Electron 应用协议
    "app://.",
    # Electron 通用协议
    "electron://.",
]


# 自定义 CORS 中间件，支持动态端口匹配
class DynamicPortCORSMiddleware(CORSMiddleware):
    """
    支持动态端口的 CORS 中间件

    功能:
    - 允许 127.0.0.1 和 localhost 的任意端口访问（支持动态端口分配）
    - 保留原有 CORS 中间件的所有功能
    """

    def is_allowed_origin(self, origin: str) -> bool:
        """
        @methoddesc 判断请求 Origin 是否被允许

        业务用途:
        - 在 CORS 握手阶段决定是否在响应中回写 Access-Control-Allow-Origin
        - 在标准 allow_origins 之外，额外放行 127.0.0.1/localhost 的任意端口

        参数:
            origin: 浏览器请求头中的 Origin 字段（形如 ``http://127.0.0.1:5173``）

        返回:
            True 表示允许该 Origin 的跨域请求，False 表示拒绝
        """
        # 首先检查是否在明确允许列表中
        if origin in self.allow_origins:
            return True

        # 支持 127.0.0.1 和 localhost 的任意端口（动态端口分配场景）
        # 匹配 http://127.0.0.1:PORT 或 http://localhost:PORT 格式
        if re.match(r"^http://(127\.0\.0\.1|localhost):\d+$", origin):
            return True

        return False


app.add_middleware(
    DynamicPortCORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(ExceptionHandlerMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# ============================================================================
# 路由注册
# ============================================================================

# 注册各功能模块的路由
# [FastAPI] include_router 将路由添加到应用
# 路由顺序不影响匹配，FastAPI 使用最长前缀匹配
# 【路由列表】按功能模块分组，便于维护和扩展
app.include_router(project_router)  # 项目管理路由（V2 配置读写）
app.include_router(projects_router)  # 项目扫描路由（Web 模式）
app.include_router(ai_router)  # AI 辅助路由（智能提示、生成）
app.include_router(regex_router)  # 正则表达式路由（测试、验证）
app.include_router(reporting_router)  # 报告路由（校验结果导出）
app.include_router(preview_router)  # 预览路由（数据预览、Schema 预览）
app.include_router(data_sources_router)  # 数据源路由（文件上传、加载）
app.include_router(validation_router)  # 校验路由（执行校验、获取结果）
app.include_router(connection_rules_router)  # 连接规则路由（画布连线规则）

# ============================================================================
# 根路径端点
# ============================================================================


@app.get("/")
async def root():
    """
    API 根端点，提供欢迎信息和文档链接

    业务用途:
    - 健康检查：确认服务是否运行
    - 开发者友好：提供 API 文档入口

    @returns dict - 包含欢迎消息的响应对象
    """
    return {"message": "欢迎使用数据校验工具 API! 请访问 /docs 查看详情。"}


@app.get("/health")
async def health():
    """
    @methoddesc 健康检查端点

    业务用途:
    - 供 Electron 主进程和负载均衡器探测后端存活状态
    - 返回 {"status": "ok"} 即表示 FastAPI 应用已启动并能响应 HTTP 请求

    @returns dict - 包含 status 字段的响应对象
    """
    return {"status": "ok"}
