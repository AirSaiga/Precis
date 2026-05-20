"""
@fileoverview AI Provider 管理 API 路由模块

功能概述:
- 查询、发现和管理 AI Provider 配置
- 扫描本地 AI 服务（Ollama、OpenAI 兼容服务）
- 测试 Provider 连接并获取可用模型列表
- 设置默认活动 Provider

架构设计:
- 与 CLI 共用同一套 ai_providers.yaml 配置文件
- 使用 Provider 注册表创建对应类型的 Provider 实例
- 发现的服务可直接添加到配置文件并持久化

输入示例:
    POST /ai/providers/discover
    GET /ai/providers/openai/test
    POST /ai/providers/openai/activate

输出示例:
    {
        "id": "ollama-local",
        "name": "Ollama (本地)",
        "provider": "ollama",
        "base_url": "http://localhost:11434",
        "model": "llama3.2",
        "health": {"status": "ok"},
        "is_configured": true
    }
"""

import logging
from typing import Optional

from fastapi import HTTPException

from ....shared.services.llm.config import loader
from ....shared.services.llm.config.models import AIProvider, ProviderType
from ....shared.services.llm.discovery import scanner
from ....shared.services.llm.providers import create
from .models import (
    DiscoverResponse,
    ProviderResponse,
    TestProviderResponse,
)

# 从 router 模块导入 router 实例（与旧代码保持一致）
from .router import router


def _is_configured(p: AIProvider) -> bool:
    """判断 Provider 是否已配置（有 API Key 且非空）"""
    return bool(p.api_key and p.api_key.strip() and not p.api_key.startswith("${"))


def _get_type_str(p: AIProvider) -> str:
    """安全获取 Provider 类型字符串"""
    return p.type.value if hasattr(p.type, "value") else str(p.type)


def _get_deployment_str(p: AIProvider) -> str:
    """安全获取部署类型字符串"""
    if p.deployment is None:
        return "unknown"
    return p.deployment.value if hasattr(p.deployment, "value") else str(p.deployment)


def _provider_to_response(p: AIProvider, health: dict) -> ProviderResponse:
    """将 AIProvider 转换为 API 响应"""
    return ProviderResponse(
        id=p.id,
        name=p.name,
        provider=_get_type_str(p),
        deployment=_get_deployment_str(p),
        base_url=p.base_url,
        model=p.model,
        health=health,
        is_configured=_is_configured(p),
    )


@router.get("/providers/config-info")
async def get_config_info():
    """
    获取 AI Provider 配置文件信息

    返回配置文件路径、YAML 模板和文件是否存在。
    前端设置面板通过此接口获取配置引导信息。
    """
    config_path = loader.config_path
    template = """version: "2.0"

providers:
  # OpenAI 或兼容 API
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
    model: gpt-4o

  # 本地 Ollama（无需 API Key）
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: openai"""
    return {
        "path": str(config_path),
        "default_path": str(loader.USER_PATH),
        "template": template,
        "exists": config_path.exists(),
    }


@router.get("/providers", response_model=list[ProviderResponse])
async def list_providers():
    """
    获取所有已配置的 Provider

    只返回配置文件（ai_providers.yaml）中已定义的 Provider，不再合并系统预设。
    不执行健康检查，直接返回列表。健康检查由 test 端点按需触发。
    """
    config = loader.load()

    return [_provider_to_response(p, {}) for p in config.providers]


@router.post("/providers/discover", response_model=DiscoverResponse)
async def discover_local_services():
    """
    扫描并发现本地 AI 服务

    扫描 localhost 和 127.0.0.1 的常用端口，
    检测 Ollama (11434) 和 OpenAI 兼容服务 (1234, 8080, 8000)
    """
    services = await scanner.scan()
    return DiscoverResponse(
        services=[
            {"id": s.id, "name": s.name, "type": s.type, "base_url": s.base_url, "models": s.models, "status": s.status}
            for s in services
        ],
        count=len(services),
    )


@router.post("/providers/discover/add")
async def add_discovered_service(service_id: str):
    """
    将发现的服务添加到配置

    Args:
        service_id: 发现的服务 ID（从 discover 接口获取）
    """
    # 重新扫描获取服务详情
    services = await scanner.scan()
    # 在扫描结果中查找目标服务
    target = next((s for s in services if s.id == service_id), None)
    if not target:
        raise HTTPException(404, detail="Service not found or no longer available")

    # 加载当前配置
    config = loader.load()

    # 构建新的 Provider 配置
    provider_type = ProviderType.OLLAMA if target.type == "ollama" else ProviderType.OPENAI

    new_provider = AIProvider(
        id=target.id,
        name=target.name,
        type=provider_type,
        base_url=target.base_url,
        api_key=None,
        model=target.models[0] if target.models else "",
    )

    # 去重（相同 ID 覆盖）
    config.providers = [p for p in config.providers if p.id != target.id]
    config.providers.append(new_provider)

    # 保存配置
    loader.save(config)

    return {
        "success": True,
        "provider": {
            "id": new_provider.id,
            "name": new_provider.name,
            "type": _get_type_str(new_provider),
            "base_url": new_provider.base_url,
            "model": new_provider.model,
        },
    }


@router.post("/providers/{provider_id}/test", response_model=TestProviderResponse)
async def test_provider(provider_id: str):
    """
    测试 Provider 连接

    执行健康检查并尝试获取可用模型列表
    """
    config = loader.load()
    # 在配置中查找目标 Provider
    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    # 根据配置创建对应的 Provider 实例
    provider = create(provider_cfg)

    # 执行健康检查
    health = await provider.health()

    # 如果健康，尝试获取模型列表
    models = []
    if health.get("status") == "ok":
        try:
            models = await provider.list_models()
        except Exception:
            logging.exception("获取模型列表失败")

    return TestProviderResponse(provider_id=provider_id, health=health, available_models=models)


@router.get("/providers/active", response_model=Optional[ProviderResponse])
async def get_active_provider():
    """
    获取当前活动的 Provider

    读取 config.defaults["chat"] 并从 config.providers 中查找。
    只返回已配置文件中存在的 Provider，不再回退到系统预设。
    """
    config = loader.load()

    # 获取默认 chat provider ID
    active_id = config.defaults.get("chat")
    if not active_id:
        if config.providers:
            active_id = config.providers[0].id
        else:
            return None

    # 只从配置文件查找
    provider_cfg = next((p for p in config.providers if p.id == active_id), None)
    if not provider_cfg:
        return None

    return _provider_to_response(provider_cfg, {})


@router.post("/providers/{provider_id}/activate", response_model=ProviderResponse)
async def activate_provider(provider_id: str):
    """
    设置活动 Provider

    设置 config.defaults["chat"] = provider_id 并保存。
    只接受已存在于配置文件中的 Provider ID。
    """
    config = loader.load()

    # 只从配置文件查找
    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)

    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    # 设置为默认 chat provider
    config.defaults["chat"] = provider_id
    loader.save(config)

    return _provider_to_response(provider_cfg, {})
