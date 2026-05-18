"""
@fileoverview API 模块包入口

功能概述:
- 标记 backend/app/api 目录为 Python 包
- 作为 API 层的统一入口，供外部导入使用

架构设计:
- 该包包含 FastAPI 应用、依赖注入、中间件、数据模型和路由等子模块
- 通过 __init__.py 暴露公共接口，简化外部导入路径

输入示例:
    from app.api import main

输出示例:
    无直接输出，仅作为包标记
"""
