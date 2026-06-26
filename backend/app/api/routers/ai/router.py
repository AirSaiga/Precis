"""
@fileoverview AI/LLM API 路由聚合入口模块

功能概述:
- 提供前缀为 /ai 的 APIRouter 实例
- 聚合导入各 AI 子模块（chat、generate、hardware、jobs、ollama、providers、utils）
- 作为 AI 路由的统一入口，降低单文件体量与耦合度

架构设计:
- 各子模块通过导入本模块的 router 实例注册端点
- 本模块仅负责 router 实例创建和聚合导入，不含具体业务逻辑

输入示例:
    无直接端点，由子模块注册

输出示例:
    无直接端点，由子模块注册
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/latest/ai", tags=["ai"])

# 导入各子模块以注册端点
from . import chat, generate, hardware, jobs, migrate, ollama, providers, stream, utils

__all__ = ["router", "chat", "generate", "hardware", "jobs", "migrate", "ollama", "providers", "stream", "utils"]
