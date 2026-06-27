# LLM 响应缓存设计

> **日期**: 2026-06-27
> **功能代号**: D（LLM 响应缓存）
> **范围**: 基于 prompt hash 的 LLM 响应缓存,避免相同输入重复调用,降低 token 成本与延迟
> **状态**: 待实施
> **并行性**: 走 provider 包装方案,**不碰 executor.py**,与 A/B/C 完全可并行

---

## 1. 背景与目标

### 1.1 问题陈述

- **无 LLM 响应缓存**:相同画像/提示词重复调用会重新请求 LLM(`openai.py`/`ollama.py` 的 chat/chat_stream 每次都打网络)。
- **分块放大调用**:generation/migrate 的分块场景对 N 个 chunk 至少 N+1 次 LLM 调用,token 成本线性甚至超线性增长。
- **重复画像/生成**:同一组文件多次生成配置,每次都重新调 LLM。

### 1.2 目标

1. 引入基于 **prompt hash**(messages+model+temperature+tools 的规范化哈希)的 LLM 响应缓存。
2. 命中缓存时直接返回,不打网络;未命中正常调用并写缓存。
3. **透明性**:用 `CachedProvider` 装饰器包装 `BaseProvider`,agent 层和所有调用方**零感知**。
4. 可配置:开关、TTL、容量上限(LRU)。

### 1.3 关键约束(决定方案)

- **D 必须走 provider 包装方案,不碰 executor.py**。理由:executor.py 是功能 C 的独占文件,若 D 在 executor.py 的 chat_stream 调用处插缓存,会与 C 的 run() 改造高度冲突(同函数不同段)。用 `CachedProvider` 装饰 `BaseProvider` 在 registry.create 注入包装,executor 完全透明,规避冲突。

### 1.4 非目标

- 不缓存流式的中间 delta(只缓存完整响应,因为 chat_stream 产出的 StreamChunk 序列对相同输入确定)。
- 不做语义级缓存(只精确 hash 匹配)。
- 不缓存 tool_calls 失败的响应(只缓存 success 响应)。

---

## 2. 现状分析

- `providers/base.py`:`BaseProvider` 抽象基类,抽象方法 `chat`(返回 ChatResponse)/`chat_stream`(返回 AsyncIterator[StreamChunk])/`list_models`/`health`。`:149-178` get_context_window。
- `providers/registry.py`:`create(config) -> BaseProvider` 工厂,`:71-72` 内置注册 openai/ollama。
- `executor.py:173`:`async for chunk in self.provider.chat_stream(req)` —— 调用点(D 不在此处改)。
- `generation/service.py`/`migrate_service.py`:多次调 provider.chat/chat_stream,是缓存收益最大的场景。

---

## 3. 设计方案

### 3.1 架构:CachedProvider 装饰器

```
registry.create(config)
  → create_real_provider(config)  # OpenAIProvider/OllamaProvider
  → if cache_enabled: return CachedProvider(real_provider, cache)
  → else: return real_provider

executor/service 调 provider.chat_stream(req)
  → CachedProvider.chat_stream(req)
    → key = hash(req)  # messages+model+temperature+tools 规范化哈希
    → if key in cache and not expired: return cached StreamChunk 序列(重放)
    → else: 调 real_provider.chat_stream(req),边收边记录,结束后存 cache
```

### 3.2 缓存键设计(prompt hash)

规范化序列化后哈希,保证"语义相同但引用不同"的请求命中同一 key:

```python
def _cache_key(req: ChatRequest) -> str:
    """规范化哈希请求,作为缓存键。"""
    payload = {
        "model": req.model,
        "temperature": req.temperature,
        "messages": _normalize_messages(req.messages),  # 去除 None 字段、排序无关项
        "tools": _normalize_tools(req.tools),           # tools 定义序列化
        "tool_choice": req.tool_choice,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
```

`_normalize_messages` 把 ChatMessage 转为可哈希的 dict(去除 content=None 的字段),保证 `[ChatMessage(role="user", content="hi")]` 与 `[{"role":"user","content":"hi"}]` 命中同 key。

### 3.3 chat vs chat_stream

- **chat(非流式)**:直接缓存 `ChatResponse`(dataclass,可序列化)。
- **chat_stream(流式)**:缓存完整的 `list[StreamChunk]`。命中时用 `async def` + yield 重放(对调用方透明,仍是 AsyncIterator[StreamChunk])。
  - **关键**:chat_stream 的 StreamChunk 序列对相同输入是确定的(OpenAI/Ollama 流式是确定性的,temperature>0 时不缓存或单独标记)。
  - temperature > 0 时默认不缓存(结果有随机性),除非显式配置 `cache_temperature_above_zero`。

---

## 4. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| **新建** `backend/app/shared/services/llm/cache/response_cache.py` | **核心** | `ResponseCache`(LRU + TTL)、`_cache_key`、`_normalize_messages/tools` |
| **新建** `backend/app/shared/services/llm/providers/cached_provider.py` | **核心** | `CachedProvider(BaseProvider)` 装饰器,包装 chat/chat_stream/list_models/health |
| `backend/app/shared/services/llm/providers/registry.py` | **改(注入点)** | create() 末尾按配置决定是否包装:if cache_enabled: return CachedProvider(real, cache) |
| `backend/app/shared/services/llm/config/models.py` | **改** | AIConfig 加 cache 配置字段(enabled/ttl_seconds/max_entries/cache_temperature_above_zero) |
| 后端单测: test_response_cache.py / test_cached_provider.py | **新增** | 见第 7 章 |

**不改的文件(关键)**:
- `executor.py`:**不改**。CachedProvider 对 executor 透明(provider.chat_stream 签名不变)。
- `openai.py` / `ollama.py`:**不改**。它们是被包装的真实 provider,CachedProvider 调用它们。

---

## 5. 后端设计

### 5.1 ResponseCache(LRU + TTL)

```python
# backend/app/shared/services/llm/cache/response_cache.py
from __future__ import annotations
import hashlib, json, time
from collections import OrderedDict
from threading import Lock
from typing import Any

from app.shared.services.llm.providers.base import ChatMessage, ChatRequest

class ResponseCache:
    """LLM 响应缓存(LRU + TTL,线程安全)。"""
    def __init__(self, max_entries: int = 100, ttl_seconds: float = 3600):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()  # key -> (value, expire_at)
        self._max = max_entries
        self._ttl = ttl_seconds
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None: return None
            value, expire_at = entry
            if time.time() > expire_at:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)  # LRU
            return value

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = (value, time.time() + self._ttl)
            self._store.move_to_end(key)
            while len(self._store) > self._max:
                self._store.popitem(last=False)  # 驱逐最旧

def cache_key(req: ChatRequest) -> str:
    payload = {
        "model": req.model,
        "temperature": req.temperature,
        "messages": [_normalize_message(m) for m in req.messages],
        "tools": req.tools,
        "tool_choice": req.tool_choice,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()

def _normalize_message(m: ChatMessage) -> dict:
    d = {"role": m.role}
    if m.content is not None: d["content"] = m.content
    if m.tool_calls is not None: d["tool_calls"] = m.tool_calls
    if m.tool_call_id is not None: d["tool_call_id"] = m.tool_call_id
    return d
```

### 5.2 CachedProvider 装饰器

```python
# backend/app/shared/services/llm/providers/cached_provider.py
from __future__ import annotations
from collections.abc import AsyncIterator
from typing import Any

from app.shared.services.llm.cache.response_cache import ResponseCache, cache_key
from .base import BaseProvider, ChatRequest, ChatResponse, StreamChunk

class CachedProvider(BaseProvider):
    """缓存装饰器:包装真实 provider,透明缓存 chat/chat_stream 响应。"""
    def __init__(self, real: BaseProvider, cache: ResponseCache, cache_temperature_above_zero: bool = False):
        self._real = real
        self._cache = cache
        self._cache_temp = cache_temperature_above_zero

    @property
    def name(self): return f"Cached({self._real.name})"

    @property
    def model(self) -> str: return self._real.model

    def _cacheable(self, req: ChatRequest) -> bool:
        # temperature > 0 默认不缓存(随机性),除非显式开启
        return self._cache_temp or (req.temperature or 0) == 0

    async def chat(self, req: ChatRequest) -> ChatResponse:
        if not self._cacheable(req):
            return await self._real.chat(req)
        key = cache_key(req)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        resp = await self._real.chat(req)
        if resp.content or resp.tool_calls:  # 缓存有效响应(非空)
            self._cache.put(key, resp)
        return resp

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        if not self._cacheable(req):
            async for c in self._real.chat_stream(req): yield c
            return
        key = cache_key(req)
        cached = self._cache.get(key)
        if cached is not None:
            # 命中:重放缓存的 StreamChunk 序列
            for c in cached:
                yield c
            return
        # 未命中:边收边记录,结束后存
        chunks: list[StreamChunk] = []
        async for c in self._real.chat_stream(req):
            chunks.append(c)
            yield c
        if chunks:
            self._cache.put(key, chunks)

    async def list_models(self): return await self._real.list_models()
    async def health(self): return await self._real.health()
    def get_context_window(self, model=None): return self._real.get_context_window(model)
```

### 5.3 registry 注入(唯一改动点)

```python
# providers/registry.py 的 create()
def create(config: AIProvider) -> BaseProvider:
    real = _create_real_provider(config)  # OpenAI/Ollama
    cache_cfg = _load_cache_config()  # 从 AIConfig 读 cache 配置
    if cache_cfg and cache_cfg.get("enabled"):
        cache = ResponseCache(
            max_entries=cache_cfg.get("max_entries", 100),
            ttl_seconds=cache_cfg.get("ttl_seconds", 3600),
        )
        return CachedProvider(real, cache, cache_cfg.get("cache_temperature_above_zero", False))
    return real
```

### 5.4 配置(models.py)

`AIConfig` 加:
```python
class AICacheConfig(BaseModel):
    enabled: bool = False
    ttl_seconds: float = 3600
    max_entries: int = 100
    cache_temperature_above_zero: bool = False

class AIConfig:
    # ... 现有 ...
    cache: AICacheConfig = AICacheConfig()  # 默认关闭,显式开启
```

---

## 6. 并行边界

### 6.1 D 与所有功能零冲突

| 文件 | A | B | C | D |
|---|---|---|---|---|
| executor.py | – | – | **改** | – |
| memory.py | – | – | **改** | – |
| providers/* | – | – | – | **改** |
| cache/* (新建) | – | – | – | **新建** |

**D 完全独立**:只动 providers 层 + 新建 cache 模块,不碰 executor/memory/migrate/chat_tools。与 A/B/C 任意组合并行,无合并冲突。

### 6.2 D 的收益自动惠及 B

B(migrate 分块)通过 `_generate_config_for_scope` 间接调 provider.chat_stream。D 落地后,B 的重复分片生成自动命中缓存,token 成本下降。B 无需适配。

### 6.3 D 无前置依赖

D 不依赖 A/B/C 任何改动,可最先做或随时插入。

---

## 7. 测试策略

### 7.1 单测

**test_response_cache.py**:
- get/put 基本存取。
- LRU:超 max_entries 驱逐最旧。
- TTL:过期返回 None。
- cache_key:相同 messages+model+temp 同 key;不同 temp 不同 key;_normalize_message 去除 None 字段。
- 线程安全:多线程并发 get/put。

**test_cached_provider.py**(mock real provider):
- chat 命中:第二次相同 req 不调 real.chat,返回缓存。
- chat 未命中:调 real.chat 并写缓存。
- chat temperature>0(未开 cache_temp):不缓存,每次调 real。
- chat_stream 命中:重放缓存的 StreamChunk 序列(逐个 yield,顺序一致)。
- chat_stream 未命中:边收边记录,结束后 cache 含完整序列。
- list_models/health/get_context_window 透传 real。

### 7.2 集成(可选)

配置 cache.enabled=True → 两次相同生成请求 → 第二次 LLM 调用次数为 0(用 mock provider 计数)。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| temperature>0 缓存导致结果固化 | 默认 `_cacheable` 仅 temp==0 缓存;cache_temperature_above_zero 默认 False |
| 缓存 chat_stream 序列占内存 | LRU max_entries 上限 + TTL;StreamChunk 是轻量 dataclass,单序列通常 KB 级 |
| tools 定义变化未命中(prompt 含 tools) | cache_key 已含 tools 规范化,工具集变化自动 miss |
| 缓存了失败/空响应 | 只缓存 content 或 tool_calls 非空的响应 |
| 与 C 合并冲突 | D 不碰 executor/memory(C 独占),只动 providers + 新建 cache,零冲突 |
| 跨进程缓存不一致(多 worker) | 本设计是进程内 LRU;若需跨 worker 共享,后续可换 Redis 后端(ResponseCache 是接口,实现可替换) |

---

## 附录:实施顺序

1. response_cache.py(ResponseCache + cache_key + normalize)+ 单测
2. cached_provider.py(CachedProvider 装饰器)+ 单测
3. models.py:AICacheConfig 配置字段
4. registry.py:create() 注入包装(默认关闭)
5. 集成测试(可选)
6. 文档:在 ai_providers.yaml 配置示例里说明 cache 开启方式
