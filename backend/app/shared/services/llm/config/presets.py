# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
- 字典顺序即前端设置页下拉与 CLI 菜单的展示顺序（国内主流在前、本地服务在后）
- base_url 必须是 OpenAI 兼容端点（openai SDK 会在其后拼接 /chat/completions），
  含版本路径的厂商必须带全（如 /v1、/compatible-mode/v1、/api/paas/v4、/api/v3）

维护约定:
- 各厂商 base_url / 模型 ID / 鉴权要点 / 更新 SOP 见同目录 AI_PROVIDER_PRESETS.md
- 模型列表有时效性（厂商滚动升级），更新时须对照官方模型列表并同步维护文档的核对日期

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
    "qwen": {
        "id": "qwen",
        "name": "通义千问 Qwen",
        "type": "openai",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen3.8-max",
        "models": ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    },
    "glm": {
        "id": "glm",
        "name": "智谱 GLM",
        "type": "openai",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-5.3",
        "models": ["glm-5.3", "glm-5.3-flash", "glm-5.2"],
    },
    "kimi": {
        "id": "kimi",
        "name": "月之暗面 Kimi",
        "type": "openai",
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "kimi-k3",
        "models": ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-latest"],
    },
    "minimax": {
        "id": "minimax",
        "name": "MiniMax",
        "type": "openai",
        "base_url": "https://api.minimaxi.com/v1",
        "default_model": "MiniMax-M3",
        "models": ["MiniMax-M3", "MiniMax-M2.5", "MiniMax-M2.7-highspeed"],
    },
    "mimo": {
        "id": "mimo",
        "name": "Xiaomi MiMo",
        "type": "openai",
        "base_url": "https://api.xiaomimimo.com/v1",
        "default_model": "mimo-v2.5",
        "models": ["mimo-v2.5", "mimo-v2.5-pro"],
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
