"""
@fileoverview AI Provider 管理 API 路由模块

功能概述:
- 查询、发现和管理 AI Provider 配置
- 扫描本地 AI 服务（Ollama、OpenAI 兼容服务）
- 测试 Provider 连接并获取可用模型列表
- 设置默认活动 Provider
- CRUD：创建、更新、删除 Provider
- 预设：获取内置服务商预设列表

架构设计:
- 与 CLI 共用同一套 ~/.precis/ai_providers.yaml 配置文件
- 使用 Provider 注册表创建对应类型的 Provider 实例
- 发现的服务可直接添加到配置文件并持久化
- 预设模板定义在 config/presets.py，方便扩展
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException

from ....shared.services.llm.config import loader
from ....shared.services.llm.config.models import AIProvider, DeploymentType, ProviderType
from ....shared.services.llm.config.presets import get_preset_list
from ....shared.services.llm.discovery import scanner
from ....shared.services.llm.providers import create
from .models import (
    CreateProviderRequest,
    DiscoverResponse,
    ProviderPresetResponse,
    ProviderResponse,
    TestProviderResponse,
    UpdateProviderRequest,
)
from .router import router


def _is_configured(p: AIProvider) -> bool:
    """判断 Provider 是否已配置。

    loader.load() 已完成 env-var 覆盖，直接检查 api_key 即可。
    本地 Provider（Ollama）不需要 API Key。
    """
    if p.deployment == DeploymentType.LOCAL:
        return bool(p.base_url)
    return bool(p.api_key and p.api_key.strip())


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
        type=_get_type_str(p),
        deployment=_get_deployment_str(p),
        base_url=p.base_url,
        model=p.model,
        health=health,
        is_configured=_is_configured(p),
    )


@router.get(
    "/providers/config-info",
    summary="获取 AI Provider 配置文件信息",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def get_config_info():
    """
    获取 AI Provider 配置文件信息

    返回配置文件路径、YAML 模板和文件是否存在。
    前端设置面板通过此接口获取配置引导信息。
    """
    config_path = loader.config_path
    return {
        "path": str(config_path),
        "default_path": str(config_path),
        "template": _DEFAULT_CONFIG_TEMPLATE,
        "exists": config_path.exists(),
    }


_DEFAULT_CONFIG_TEMPLATE = """version: "2.0"

providers:
  # DeepSeek
  - id: deepseek
    name: DeepSeek
    type: openai
    base_url: https://api.deepseek.com
    api_key: ${DEEPSEEK_API_KEY}
    model: deepseek-v4-pro

  # 本地 Ollama（无需 API Key）
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: deepseek"""


@router.get(
    "/providers",
    response_model=list[ProviderResponse],
    summary="获取所有已配置的 Provider",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def list_providers():
    """
    获取所有已配置的 Provider

    只返回配置文件（ai_providers.yaml）中已定义的 Provider，不再合并系统预设。
    不执行健康检查，直接返回列表。健康检查由 test 端点按需触发。
    """
    config = loader.load()
    return [_provider_to_response(p, {}) for p in config.providers]


@router.get(
    "/providers/active",
    response_model=Optional[ProviderResponse],
    summary="获取当前活动的 Provider",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def get_active_provider():
    """
    获取当前活动的 Provider

    读取 config.defaults["chat"] 并从 config.providers 中查找。
    只返回已配置文件中存在的 Provider。
    """
    config = loader.load()

    active_id = config.defaults.get("chat")
    if not active_id:
        if config.providers:
            active_id = config.providers[0].id
        else:
            return None

    provider_cfg = next((p for p in config.providers if p.id == active_id), None)
    if not provider_cfg:
        return None

    return _provider_to_response(provider_cfg, {})


@router.post(
    "/providers/discover",
    response_model=DiscoverResponse,
    summary="扫描并发现本地 AI 服务",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
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


@router.post(
    "/providers/discover/add",
    summary="将发现的服务添加到配置",
    responses={
        404: {"description": "服务未找到"},
        500: {"description": "服务器内部错误"},
    },
)
async def add_discovered_service(service_id: str):
    """
    将发现的服务添加到配置

    Args:
        service_id: 发现的服务 ID（从 discover 接口获取）
    """
    services = await scanner.scan()
    target = next((s for s in services if s.id == service_id), None)
    if not target:
        raise HTTPException(404, detail="Service not found or no longer available")

    config = loader.load()

    provider_type = ProviderType.OLLAMA if target.type == "ollama" else ProviderType.OPENAI

    new_provider = AIProvider(
        id=target.id,
        name=target.name,
        type=provider_type,
        base_url=target.base_url,
        api_key=None,
        model=target.models[0] if target.models else "",
    )

    config.providers = [p for p in config.providers if p.id != target.id]
    config.providers.append(new_provider)

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


@router.post(
    "/providers/{provider_id}/test",
    response_model=TestProviderResponse,
    summary="测试 Provider 连接",
    responses={
        404: {"description": "Provider 未找到"},
        500: {"description": "服务器内部错误"},
    },
)
async def test_provider(provider_id: str):
    """
    测试 Provider 连接

    执行健康检查并尝试获取可用模型列表
    """
    config = loader.load()
    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    provider = create(provider_cfg)

    health = await provider.health()

    models = []
    if health.get("status") == "ok":
        try:
            models = await provider.list_models()
        except Exception:
            logging.exception("获取模型列表失败")

    return TestProviderResponse(provider_id=provider_id, health=health, available_models=models)


@router.post(
    "/providers/{provider_id}/activate",
    response_model=ProviderResponse,
    summary="设置活动 Provider",
    responses={
        404: {"description": "Provider 未找到"},
        500: {"description": "服务器内部错误"},
    },
)
async def activate_provider(provider_id: str):
    """
    设置活动 Provider

    设置 config.defaults["chat"] = provider_id 并保存。
    只接受已存在于配置文件中的 Provider ID。
    """
    config = loader.load()

    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    config.defaults["chat"] = provider_id
    loader.save(config)

    return _provider_to_response(provider_cfg, {})


@router.get(
    "/providers/presets",
    response_model=list[ProviderPresetResponse],
    summary="获取内置服务商预设列表",
)
async def list_presets():
    """
    获取内置服务商预设列表

    返回后端预定义的服务商模板，包含 base_url、默认模型、可用模型列表。
    前端可据此构建「选择服务商 → 填 API Key」的交互流程。
    """
    return get_preset_list()


@router.post(
    "/providers",
    response_model=ProviderResponse,
    summary="创建 Provider",
    responses={
        409: {"description": "Provider ID 已存在"},
        500: {"description": "服务器内部错误"},
    },
)
async def create_provider(req: CreateProviderRequest):
    """
    创建一个新的 Provider 并写入配置文件。

    自动生成唯一 ID（基于预设 ID + 短随机后缀），或使用请求中的 name 生成。
    """
    config = loader.load()

    base_id = req.name.lower().replace(" ", "-").replace("_", "-")
    new_id = base_id
    counter = 1
    while any(p.id == new_id for p in config.providers):
        new_id = f"{base_id}-{counter}"
        counter += 1

    try:
        provider_type = ProviderType(req.type)
    except ValueError:
        raise HTTPException(400, detail=f"Unsupported provider type: {req.type}. Supported: openai, ollama")

    new_provider = AIProvider(
        id=new_id,
        name=req.name,
        type=provider_type,
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
    )

    config.providers.append(new_provider)
    loader.save(config)

    return _provider_to_response(new_provider, {})


@router.put(
    "/providers/{provider_id}",
    response_model=ProviderResponse,
    summary="更新 Provider",
    responses={
        404: {"description": "Provider 未找到"},
        500: {"description": "服务器内部错误"},
    },
)
async def update_provider(provider_id: str, req: UpdateProviderRequest):
    """
    更新已有 Provider 的配置。

    仅更新请求中传递的非 None 字段。
    """
    config = loader.load()

    idx = next((i for i, p in enumerate(config.providers) if p.id == provider_id), None)
    if idx is None:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    existing = config.providers[idx]

    update_data = req.model_dump(exclude_none=True)
    if "type" in update_data:
        try:
            update_data["type"] = ProviderType(update_data["type"])
        except ValueError:
            raise HTTPException(400, detail=f"Unsupported provider type: {update_data['type']}")

    updated_provider = existing.model_copy(update=update_data)
    config.providers[idx] = updated_provider
    loader.save(config)

    return _provider_to_response(updated_provider, {})


@router.delete(
    "/providers/{provider_id}",
    summary="删除 Provider",
    responses={
        404: {"description": "Provider 未找到"},
        500: {"description": "服务器内部错误"},
    },
)
async def delete_provider(provider_id: str):
    """
    删除指定的 Provider。

    如果删除的是当前活跃 Provider，自动清除 defaults.chat。
    """
    config = loader.load()

    idx = next((i for i, p in enumerate(config.providers) if p.id == provider_id), None)
    if idx is None:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    config.providers.pop(idx)

    if config.defaults.get("chat") == provider_id:
        config.defaults["chat"] = ""

    loader.save(config)

    return {"success": True, "deleted": provider_id}
