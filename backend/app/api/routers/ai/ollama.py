"""
@fileoverview Ollama 服务管理 API 路由模块

功能概述:
- 获取 Ollama 本地服务的可用模型列表
- 检查 Ollama 服务的健康状态
- 从配置的 Ollama Provider 自动发现服务

架构设计:
- 扫描配置文件中的 ollama 类型 Provider
- 通过 Provider 抽象层调用 list_models 和 health 方法
- 失败时优雅降级，返回空列表或错误信息

输入示例:
    GET /ai/ollama/models

输出示例:
    ["llama3.2", "qwen2.5", "deepseek-coder"]
"""

import logging
from typing import Any

from app.shared.services.llm.config import loader
from app.shared.services.llm.providers import create

from .router import router


@router.get(
    "/ollama/models",
    response_model=list[str],
    summary="获取 Ollama 可用模型列表",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def list_ollama_models() -> list[str]:
    """
    获取 Ollama 可用模型列表

    从配置的 Ollama Provider 获取模型列表
    """
    config = loader.load()

    # 查找 Ollama Provider
    ollama_provider = None
    for p in config.providers:
        if p.type.value == "ollama":
            ollama_provider = p
            break

    if not ollama_provider:
        return []

    try:
        provider = create(ollama_provider)
        models = await provider.list_models()
        return models
    except Exception as exc:
        logging.getLogger(__name__).warning("Failed to list Ollama models: %s", exc)
        return []


@router.get(
    "/ollama/health",
    summary="检查 Ollama 服务健康状态",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def ollama_health() -> dict[str, Any]:
    """
    检查 Ollama 服务健康状态
    """
    config = loader.load()

    # 查找 Ollama Provider
    ollama_provider = None
    for p in config.providers:
        if p.type.value == "ollama":
            ollama_provider = p
            break

    if not ollama_provider:
        return {"success": False, "error": "No Ollama provider configured"}

    try:
        provider = create(ollama_provider)
        health = await provider.health()
        return {"success": health.get("status") == "ok", "data": health}
    except Exception as e:
        return {"success": False, "error": str(e)}
