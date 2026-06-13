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
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "type": "openai",
        "base_url": "https://api.deepseek.com",
        "default_model": "deepseek-v4-pro",
        "models": ["deepseek-v4-pro", "deepseek-v4-flash"],
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
