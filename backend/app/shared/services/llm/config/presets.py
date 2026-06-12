"""
@fileoverview AI Provider 预设定义

功能概述:
- 定义内置的服务商预设配置（base_url、默认模型、可用模型列表）
- 所有 OpenAI 兼容服务商统一为 type=openai
- 后端扩展新服务商时只需在此文件添加预设条目

架构设计:
- PROVIDER_PRESETS 为字典，key 为预设 ID，value 为预设配置
- 预设配置包含服务商元信息和可用模型列表
- API 端点 GET /providers/presets 返回预设列表供前端和 CLI 使用
- 这是 Provider 元数据的唯一来源，前端和 CLI 共用

输入示例:
    preset = PROVIDER_PRESETS["deepseek"]

输出示例:
    ProviderPreset(id="deepseek", name="DeepSeek", type="openai",
                   base_url="https://api.deepseek.com",
                   default_model="deepseek-v4-flash",
                   models=["deepseek-v4-flash", "deepseek-v4-pro"])
"""

from __future__ import annotations

from typing import Any

PROVIDER_PRESETS: dict[str, dict[str, Any]] = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "type": "openai",
        "base_url": "https://api.deepseek.com",
        "default_model": "deepseek-v4-flash",
        "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
    },
    "glm": {
        "id": "glm",
        "name": "智谱 GLM",
        "type": "openai",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4-flash",
        "models": ["glm-4-flash", "glm-4-plus", "glm-4"],
    },
    "minimax": {
        "id": "minimax",
        "name": "MiniMax",
        "type": "openai",
        "base_url": "https://api.minimax.chat/v1",
        "default_model": "abab6.5s-chat",
        "models": ["abab6.5s-chat"],
    },
    "kimi": {
        "id": "kimi",
        "name": "Kimi",
        "type": "openai",
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "kimi-chat",
        "models": ["kimi-chat", "moonshot-v1-8k", "moonshot-v1-32k"],
    },
    "qwen": {
        "id": "qwen",
        "name": "通义千问",
        "type": "openai",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-turbo",
        "models": ["qwen-turbo", "qwen-plus", "qwen-max"],
    },
    "ollama": {
        "id": "ollama-local",
        "name": "Ollama Local",
        "type": "ollama",
        "base_url": "http://localhost:11434",
        "default_model": "llama3.2",
        "models": [],
    },
}


def get_preset_list() -> list[dict[str, Any]]:
    """返回所有预设的列表（不含内部字段）"""
    return [
        {
            "id": v["id"],
            "name": v["name"],
            "type": v["type"],
            "base_url": v["base_url"],
            "default_model": v["default_model"],
            "models": list(v["models"]),
        }
        for v in PROVIDER_PRESETS.values()
    ]


def get_preset(preset_id: str) -> dict[str, Any] | None:
    """按 ID 获取预设，不存在返回 None"""
    return PROVIDER_PRESETS.get(preset_id)
