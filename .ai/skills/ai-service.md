---
name: "ai-service"
description: "Precis AI 服务开发规范。适用于 AI Provider 管理、LLM 配置生成、Chat 接口、本地服务发现等模块。"
scope: ["backend/app/shared/services/llm/**/*.py", "backend/app/api/routers/ai/**/*.py"]
---

# Precis AI 服务开发规范

## 适用范围

- AI Provider 管理与注册
- LLM 配置生成服务
- Chat 聊天接口（流式/非流式）
- 本地 AI 服务发现（Ollama、OpenAI 兼容服务）
- AI Provider 配置文件（ai_providers.yaml）

## Provider 架构

系统采用统一的 Provider 架构，支持多种部署方式：

| 部署类型 | 说明 | 示例 |
|---------|------|------|
| **本地** | 本地运行的 AI 服务 | Ollama, LM Studio, LocalAI |
| **内网** | 企业内部部署的私有模型 | 公司私有 LLM |
| **云端** | 公有云 AI 服务 | OpenAI, 阿里云, Google Gemini |

## Provider 基类

所有 Provider 必须继承 `BaseProvider`：

```python
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Optional

from app.shared.services.llm.models import ChatMessage, ChatResponse

class BaseProvider(ABC):
    """AI Provider 抽象基类
    
    功能概述:
    - 定义 Provider 的标准接口
    - 支持聊天、流式聊天、模型列表查询
    
    子类必须实现:
    - chat(): 非流式聊天
    - chat_stream(): 流式聊天
    - list_models(): 获取可用模型列表
    """
    
    def __init__(self, config: ProviderConfig):
        self.config = config
        self.base_url = config.base_url
        self.api_key = config.api_key
        self.model = config.model
    
    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        model: Optional[str] = None,
        temperature: Optional[float] = None
    ) -> ChatResponse:
        """非流式聊天
        
        Args:
            messages: 聊天消息列表
            model: 模型名称（可选，覆盖默认配置）
            temperature: 温度参数（可选）
            
        Returns:
            ChatResponse: 聊天响应
        """
        pass
    
    @abstractmethod
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        model: Optional[str] = None,
        temperature: Optional[float] = None
    ) -> AsyncGenerator[str, None]:
        """流式聊天
        
        Yields:
            str: 响应文本片段
        """
        pass
    
    @abstractmethod
    async def list_models(self) -> list[str]:
        """获取可用模型列表
        
        Returns:
            list[str]: 模型名称列表
        """
        pass
    
    async def health_check(self) -> bool:
        """健康检查（可选实现）
        
        Returns:
            bool: 服务是否可用
        """
        return True
```

## OpenAI 兼容 Provider

```python
import httpx
from app.shared.services.llm.providers.base import BaseProvider
from app.shared.services.llm.models import ChatMessage, ChatResponse

class OpenAICompatibleProvider(BaseProvider):
    """OpenAI 兼容 Provider
    
    支持:
    - OpenAI 官方 API
    - 任何 OpenAI 兼容的本地/远程服务
    """
    
    async def chat(
        self,
        messages: list[ChatMessage],
        model: Optional[str] = None,
        temperature: Optional[float] = None
    ) -> ChatResponse:
        """调用 OpenAI 兼容接口"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model or self.model,
                    "messages": [m.dict() for m in messages],
                    "temperature": temperature or 0.7,
                    "stream": False
                },
                timeout=60.0
            )
            response.raise_for_status()
            data = response.json()
            
            return ChatResponse(
                message=ChatMessage(
                    role="assistant",
                    content=data["choices"][0]["message"]["content"]
                ),
                provider=self.config.id,
                model=model or self.model,
                usage=data.get("usage")
            )
    
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        model: Optional[str] = None,
        temperature: Optional[float] = None
    ) -> AsyncGenerator[str, None]:
        """流式调用 OpenAI 兼容接口"""
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model or self.model,
                    "messages": [m.dict() for m in messages],
                    "temperature": temperature or 0.7,
                    "stream": True
                },
                timeout=60.0
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        # 解析 JSON 并 yield 内容
                        # ...
                        yield chunk
    
    async def list_models(self) -> list[str]:
        """获取模型列表"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"}
            )
            response.raise_for_status()
            data = response.json()
            return [m["id"] for m in data.get("data", [])]
```

## Ollama 原生 Provider

```python
import httpx
from app.shared.services.llm.providers.base import BaseProvider

class OllamaProvider(BaseProvider):
    """Ollama 原生 Provider
    
    特点:
    - 本地运行，无需 API Key
    - 支持模型拉取和管理
    """
    
    async def chat(
        self,
        messages: list[ChatMessage],
        model: Optional[str] = None,
        temperature: Optional[float] = None
    ) -> ChatResponse:
        """调用 Ollama /api/chat"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": model or self.model,
                    "messages": [m.dict() for m in messages],
                    "stream": False,
                    "options": {
                        "temperature": temperature or 0.7
                    }
                },
                timeout=120.0
            )
            response.raise_for_status()
            data = response.json()
            
            return ChatResponse(
                message=ChatMessage(
                    role="assistant",
                    content=data["message"]["content"]
                ),
                provider=self.config.id,
                model=model or self.model
            )
    
    async def list_models(self) -> list[str]:
        """获取本地模型列表"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            return [m["name"] for m in data.get("models", [])]
```

## Provider 注册表

```python
from app.shared.services.llm.providers.base import BaseProvider
from app.shared.services.llm.providers.openai import OpenAICompatibleProvider
from app.shared.services.llm.providers.ollama import OllamaProvider

class ProviderRegistry:
    """Provider 注册表
    
    功能概述:
    - 管理所有 Provider 类型
    - 根据配置自动创建对应的 Provider 实例
    """
    
    _providers: dict[str, type[BaseProvider]] = {
        "openai": OpenAICompatibleProvider,
        "ollama": OllamaProvider,
    }
    
    @classmethod
    def create(cls, provider_type: str, config: ProviderConfig) -> BaseProvider:
        """创建 Provider 实例
        
        Args:
            provider_type: Provider 类型标识
            config: Provider 配置
            
        Returns:
            BaseProvider: Provider 实例
        """
        provider_class = cls._providers.get(provider_type)
        if provider_class is None:
            raise ValueError(f"未知的 Provider 类型: {provider_type}")
        return provider_class(config)
    
    @classmethod
    def register(cls, name: str, provider_class: type[BaseProvider]) -> None:
        """注册自定义 Provider"""
        cls._providers[name] = provider_class
```

## AI Provider 配置文件

配置文件位置：`~/.precis/ai_providers.yaml`

```yaml
schema_version: "1.0"

providers:
  # 本地 Ollama
  - id: ollama-local
    name: Ollama (本地)
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

  # 云端 OpenAI
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
    model: gpt-4

defaults:
  chat: ollama-local
  generate: openai
```

## 配置生成服务

```python
class ConfigGenerationService:
    """AI 配置生成服务
    
    功能概述:
    - 基于数据样本自动生成 Schema 和约束配置
    - 支持同步和异步生成模式
    """
    
    async def generate(
        self,
        data_sample: str,
        description: Optional[str] = None,
        provider_id: Optional[str] = None
    ) -> dict:
        """生成配置
        
        Args:
            data_sample: 数据样本（CSV/JSON 格式或文件路径）
            description: 数据描述和业务需求
            provider_id: 指定的 AI Provider
            
        Returns:
            dict: 包含 schema 和 constraints 的配置
        """
        provider = self._get_provider(provider_id)
        
        # 构建生成提示
        prompt = self._build_generation_prompt(data_sample, description)
        
        # 调用 LLM
        response = await provider.chat([
            ChatMessage(role="system", content=self._system_prompt),
            ChatMessage(role="user", content=prompt)
        ])
        
        # 解析响应为配置结构
        return self._parse_config_response(response.message.content)
    
    def _build_generation_prompt(
        self,
        data_sample: str,
        description: Optional[str] = None
    ) -> str:
        """构建配置生成提示"""
        prompt = f"""基于以下数据样本，生成 Precis V2 项目配置。

数据样本:
```
{data_sample}
```
"""
        if description:
            prompt += f"\n业务需求描述: {description}\n"
        
        prompt += """
请生成以下内容的 YAML 配置:
1. Schema 定义（包含列名、数据类型、是否可空）
2. 合理的约束规则（唯一性、非空、允许值、外键等）

输出格式要求:
- 使用 Precis V2 配置规范
- 列 ID 使用小写+下划线命名
- 数据类型从 [string, integer, decimal, boolean, datetime, date, time] 中选择
"""
        return prompt
```

## 本地服务发现

```python
import asyncio
import httpx

class ServiceScanner:
    """本地 AI 服务扫描器
    
    功能概述:
    - 自动发现本地运行的 AI 服务
    - 扫描常见端口和端点
    """
    
    # 扫描端口
    PORTS = [11434, 1234, 8080, 8000]
    
    async def scan(self) -> list[dict]:
        """扫描本地服务
        
        Returns:
            list[dict]: 发现的服务列表
        """
        services = []
        
        for port in self.PORTS:
            # 尝试 Ollama 端点
            if await self._check_ollama(port):
                services.append({
                    "type": "ollama",
                    "name": f"Ollama (端口 {port})",
                    "base_url": f"http://localhost:{port}",
                    "port": port
                })
            
            # 尝试 OpenAI 兼容端点
            elif await self._check_openai_compatible(port):
                services.append({
                    "type": "openai",
                    "name": f"OpenAI 兼容服务 (端口 {port})",
                    "base_url": f"http://localhost:{port}/v1",
                    "port": port
                })
        
        return services
    
    async def _check_ollama(self, port: int) -> bool:
        """检查是否为 Ollama 服务"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"http://localhost:{port}/api/tags",
                    timeout=2.0
                )
                return response.status_code == 200
        except:
            return False
    
    async def _check_openai_compatible(self, port: int) -> bool:
        """检查是否为 OpenAI 兼容服务"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"http://localhost:{port}/v1/models",
                    timeout=2.0
                )
                return response.status_code == 200
        except:
            return False
```

## API 端点规范

### Provider 管理

```
GET    /ai/providers                    # 获取所有 Provider
POST   /ai/providers/discover           # 发现本地服务
POST   /ai/providers/discover/add       # 添加发现的服务
POST   /ai/providers/{id}/test          # 测试连接
GET    /ai/providers/defaults           # 获取配置模板
```

### 聊天

```
POST /ai/chat                           # 通用聊天
POST /ai/chat/completions               # OpenAI 兼容接口
```

### 配置生成

```
POST /ai/v2/config/generate             # 同步生成
POST /ai/v2/config/generate/jobs        # 创建异步任务
GET  /ai/v2/config/generate/jobs/{id}   # 查询任务状态
```

### Ollama 管理

```
GET /ai/ollama/models                   # 获取模型列表
GET /ai/ollama/health                   # 健康检查
```
