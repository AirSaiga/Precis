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
- 字典顺序即前端设置页下拉与 CLI 菜单的展示顺序（国际厂商在前、国内厂商随后、本地服务在末尾）
- base_url 必须是 OpenAI 兼容端点（openai SDK 会在其后拼接 /chat/completions），
  含版本路径的厂商必须带全（如 /v1、/compatible-mode/v1、/api/paas/v4、/api/v3）

维护约定:
- 各厂商 base_url / 模型 ID / 鉴权要点 / 更新 SOP 见同目录 AI_PROVIDER_PRESETS.md
- 模型列表有时效性（厂商滚动升级），更新时须对照官方模型列表并同步维护文档的核对日期
- models / default_model 仅为核对日期时点的**建议值**，不是权威清单——厂商迭代快、清单必然腐化，
  真正的权威是厂商官方文档；用户可通过自定义端点或"拉取模型列表"（POST /providers/fetch-models）
  获取实时模型清单，预设列表不再是唯一途径

输入示例:
    preset = PROVIDER_PRESETS["deepseek"]

输出示例:
    ProviderPreset(id="deepseek", name="DeepSeek", type="openai",
                   base_url="https://api.deepseek.com",
                   default_model="deepseek-flash",
                   models=["deepseek-flash"])
"""

from __future__ import annotations

from typing import Any

# 各厂商 models/default_model 仅为建议值（核对日期见 AI_PROVIDER_PRESETS.md），以厂商官方文档为准
PROVIDER_PRESETS: dict[str, dict[str, Any]] = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        # 建议值（2026-10-03 核对时点）：GPT-6.1 Sol 为时点旗舰（2026-09-30 随 Dots 智能体发布）；
        # gpt-6-astra 为上一代旗舰，gpt-5.5 为时点主力稳定版（模型 ID 以 openai-python SDK 官方 ChatModel 列表为准）
        "default_model": "gpt-6.1-sol",
        "models": ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"],
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "type": "openai",  # 走官方 OpenAI SDK 兼容端点（非 Messages API）
        "base_url": "https://api.anthropic.com/v1",
        # 建议值（2026-10-03 核对时点）：claude-opus-5-5 为时点旗舰，claude-sonnet-5-5 为速度/智能平衡主力，
        # claude-haiku-4-5 为最快档（Haiku 尚无 5 系）；family alias 滚动指向最新快照（以官方文档为准）
        "default_model": "claude-opus-5-5",
        "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    },
    "gemini": {
        "id": "gemini",
        "name": "Google Gemini",
        "type": "openai",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        # 建议值（2026-10-03 核对时点）：gemini-3.8-flash 为时点 GA 主力（2026-09-02 发布，1M 上下文）；
        # gemini-3.1-pro-preview 为时点能力最强的预览旗舰；
        # gemini-2.5-pro 2026-10-16 退役故不收录；Gemini 4 Argon 尚未开放公开 API 调用，暂不收录
        "default_model": "gemini-3.8-flash",
        "models": ["gemini-3.8-flash", "gemini-3.1-pro-preview"],
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "type": "openai",
        "base_url": "https://api.deepseek.com",
        # 建议值：2026-09-10 起官方滚动名为 deepseek-flash（2026-10-03 核对时点指向 V4.1-Flash，超越 V4-Pro）；
        # deepseek-v4-pro / deepseek-v4-flash 已下线并被路由到 V4.1-Flash，不再收录
        "default_model": "deepseek-flash",
        "models": ["deepseek-flash"],
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
