# AI 流式响应与可观测性增强(P0)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天/配置生成/脚本迁移三处 AI 场景实现统一的全链路流式响应(SSE),补齐 Provider 流式 tool_calls,恢复工具调用轨迹可视化,并接入软取消。

**Architecture:** 四层分层——① Provider 层补齐 `chat_stream` 的 tool_calls 支持(统一 `StreamChunk` 输出)→ ② AgentExecutor 流式化(回调注入)→ ③ StreamingOrchestrator 包装层(把三个现有 service 转成事件流,EventJournal 落盘续传)→ ④ 前端统一 SSE 客户端 + 流式状态机 + AIChatPanel 增强。业务逻辑零改动,只做流式包装。

**Tech Stack:** Python(FastAPI StreamingResponse / asyncio)、TypeScript(fetch + ReadableStream / Vue 3 Composition API / Pinia)、SSE 协议。

**对应 Spec:** `docs/superpowers/specs/2026-06-27-ai-streaming-p0-design.md`

---

## 关键设计决策对齐(写代码前必读)

这些是从现有代码精确对齐得出的约束,**不可偏离**:

1. **`parse_tool_call` 期望 OpenAI 完整格式**:`registry.parse_tool_call(raw)` 期望 `raw = {"id":..., "function":{"name":..., "arguments":"<json string>"}}`(见 `tool_registry.py:137-150`)。因此 Provider `chat_stream` 产出的 `StreamChunk(type="tool_calls")` 必须携带 **raw dict 列表**(非项目内 `ToolCall` dataclass),以便直接喂给 `parse_tool_call` 复用,保持 DRY。
2. **`StreamChunk.tool_calls` 类型 = `list[dict]`**(OpenAI 原始格式),**不是** `list[ToolCall]`。这是与 `parse_tool_call` 对齐的结果。
3. **`ToolCall.arguments` 是 `dict`**(`types.py:19`),`parse_tool_call` 内部已处理 str→dict 解析。
4. **现有回调注入模式**:service 层已用 `progress_callback`/`cancelled_callback` 参数注入(见 generation/service.py)。本设计在 AgentExecutor 补 `on_chunk`/`on_turn`/`on_tool_call`/`on_tool_result` 回调,沿用此模式。
5. **AgentResult 加 `cancelled` 字段**:用于区分"取消"与"失败",前端据此显示不同 UI。

---

## 文件结构

### 新建文件

**后端**:
| 文件 | 职责 |
|------|------|
| `backend/app/shared/services/ai/streaming/__init__.py` | 流式内核聚合导出 |
| `backend/app/shared/services/ai/streaming/types.py` | 事件类型常量(`EVENT_*`)、`StreamEvent` 数据模型 |
| `backend/app/shared/services/ai/streaming/event_journal.py` | EventJournal:追加/读取/续传/清理 |
| `backend/app/shared/services/ai/streaming/orchestrator.py` | StreamingOrchestrator:包装 3 个 service 成事件流 |
| `backend/app/shared/services/ai/streaming/sse_response.py` | SSE StreamingResponse 封装(含续传逻辑) |
| `backend/app/api/routers/ai/stream.py` | 3 个 SSE 端点 + cancel 端点 |
| `backend/tests/unit/shared/services/ai/streaming/test_event_journal.py` | EventJournal 单测 |
| `backend/tests/unit/shared/services/ai/streaming/test_orchestrator.py` | StreamingOrchestrator 单测 |
| `backend/tests/unit/shared/services/llm/providers/test_openai_stream.py` | OpenAI chat_stream 单测 |
| `backend/tests/unit/shared/services/llm/providers/test_ollama_stream.py` | Ollama chat_stream 单测 |
| `backend/tests/unit/shared/services/ai/agent/test_executor_stream.py` | AgentExecutor 流式化单测 |

**前端**:
| 文件 | 职责 |
|------|------|
| `frontend/src/core/services/sseClient.ts` | 统一 SSE 客户端(fetch + ReadableStream) |
| `frontend/src/composables/useStreamingMessage.ts` | 流式状态机 |
| `frontend/src/components/ai/ToolTrailCard.vue` | 工具轨迹折叠卡组件 |
| `frontend/tests/core/services/sseClient.test.ts` | sseClient 单测 |
| `frontend/tests/composables/useStreamingMessage.test.ts` | 流式状态机单测 |

### 修改文件

**后端**:
| 文件 | 改动 |
|------|------|
| `backend/app/shared/services/llm/providers/base.py` | 新增 `StreamChunk` dataclass |
| `backend/app/shared/services/llm/providers/openai.py` | `chat_stream` 补齐 tools + tool_calls 分片累积 |
| `backend/app/shared/services/llm/providers/ollama.py` | `chat_stream` 补齐 tool_calls |
| `backend/app/shared/services/ai/agent/executor.py` | chat→chat_stream,加回调,取消检查点 |
| `backend/app/shared/services/ai/agent/types.py` | AgentResult 加 `cancelled` 字段 |
| `backend/app/shared/services/ai/chat_agent_runner.py` | 暴露 `configure_callbacks` 入口 |
| `backend/app/api/routers/ai/router.py` | 注册 stream 路由 |

**前端**:
| 文件 | 改动 |
|------|      |
| `frontend/src/stores/aiChatStore.ts` | sendMessage 改 SSE,接入 useStreamingMessage |
| `frontend/src/features/ai-config-generator/composables/useGenerationJob.ts` | 轮询→SSE |
| `frontend/src/features/ai-config-generator/composables/useMigrationJob.ts` | 轮询→SSE |
| `frontend/src/components/ai/AIChatPanel.vue` | 流式区+折叠卡+取消按钮 |
| `frontend/src/core/services/httpClient.ts` | 移除 chat 请求的 timeout |

---

## 实施阶段总览

本计划分 **4 个阶段**,严格按顺序执行(阶段间有依赖):

- **阶段 A(后端内核)**:Provider → AgentExecutor → chat_agent_runner 回调 → StreamingOrchestrator + EventJournal → SSE 路由
- **阶段 B(前端聊天)**:sseClient → useStreamingMessage → AIChatPanel 增强
- **阶段 C(前端生成/迁移)**:useGenerationJob / useMigrationJob 接 SSE
- **阶段 D(清理)**:移除 timeout 特例、清理轮询代码

---

# 阶段 A:后端流式内核

## Task A1:Provider 层 — 新增 StreamChunk 类型

**Files:**
- Modify: `backend/app/shared/services/llm/providers/base.py`(末尾追加)

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/unit/shared/services/llm/providers/test_stream_chunk.py`:

```python
"""StreamChunk 类型测试。"""

from __future__ import annotations

from app.shared.services.llm.providers.base import StreamChunk


def test_stream_chunk_delta():
    """delta 类型 StreamChunk。"""
    chunk = StreamChunk(type="delta", text="你好")
    assert chunk.type == "delta"
    assert chunk.text == "你好"
    assert chunk.tool_calls is None


def test_stream_chunk_tool_calls():
    """tool_calls 类型 StreamChunk。"""
    tcs = [{"id": "call_1", "function": {"name": "f", "arguments": "{}"}}]
    chunk = StreamChunk(type="tool_calls", tool_calls=tcs)
    assert chunk.type == "tool_calls"
    assert chunk.tool_calls == tcs
    assert chunk.text is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_stream_chunk.py -v`
Expected: FAIL — `ImportError: cannot import name 'StreamChunk'`

- [ ] **Step 3: 实现 StreamChunk**

在 `backend/app/shared/services/llm/providers/base.py` 末尾(`resolve_context_window` 函数之后)追加:

```python
@dataclass
class StreamChunk:
    """@classdesc chat_stream 的统一输出单元

    所有 Provider 的 chat_stream 必须返回 AsyncIterator[StreamChunk]。
    统一两边输出契约,上层 AgentExecutor 只消费此类型,不关心 Provider 差异。

    Attributes:
        type: "delta"(文本增量) 或 "tool_calls"(完整工具调用集,一次性产出)
        text: type="delta" 时的文本增量,其余为 None
        tool_calls: type="tool_calls" 时的 OpenAI 原始格式 tool_call dict 列表,
            格式与 parse_tool_call 期望一致: [{"id":..., "function":{"name":..., "arguments":"<json str>"}}],
            其余为 None。注意:必须是原始 dict 而非项目内 ToolCall dataclass,
            以便直接喂给 registry.parse_tool_call() 复用。
    """

    type: str  # Literal["delta", "tool_calls"] 用 str 避免循环导入
    text: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_stream_chunk.py -v`
Expected: PASS(2 个测试)

- [ ] **Step 4a: Ruff 检查**

Run: `cd backend && python -m ruff check tests/unit/shared/services/llm/providers/test_stream_chunk.py app/shared/services/llm/providers/base.py && python -m ruff format app/shared/services/llm/providers/base.py`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
cd backend
git add app/shared/services/llm/providers/base.py tests/unit/shared/services/llm/providers/test_stream_chunk.py
git commit -m "feat(ai): 新增 StreamChunk 类型统一 Provider 流式输出契约"
```

---

## Task A2:OpenAI Provider — chat_stream 补齐 tools + tool_calls 分片累积

**Files:**
- Modify: `backend/app/shared/services/llm/providers/openai.py:163-195`(替换 `chat_stream`)
- Test: `backend/tests/unit/shared/services/llm/providers/test_openai_stream.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/unit/shared/services/llm/providers/test_openai_stream.py`:

```python
"""OpenAI chat_stream 流式 tool_calls 支持测试。"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.openai import OpenAIProvider


def _make_provider() -> OpenAIProvider:
    """构造 OpenAIProvider(provider 内部 client 会被 mock 替换)。"""
    cfg = AIProvider(
        id="test", name="test", provider="openai", base_url="http://x", model="m", api_key="k"
    )
    return OpenAIProvider(cfg)


class _FakeDelta:
    """模拟 OpenAI SDK 的 delta 对象。"""

    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _FakeChoice:
    def __init__(self, delta, finish_reason=None):
        self.delta = delta
        self.finish_reason = finish_reason


class _FakeChunk:
    def __init__(self, choices):
        self.choices = choices


class _FakeStreamCall:
    """模拟 client.chat.completions.create(stream=True) 返回的 async iterator。"""

    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        self._iter = iter(self._chunks)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


def _make_tc_delta(index, id_=None, name=None, args_fragment=None):
    """构造 tool_calls delta 分片。"""
    tc = MagicMock()
    tc.index = index
    func = MagicMock()
    func.name = name
    func.arguments = args_fragment
    tc.id = id_
    tc.function = func
    return tc


@pytest.mark.asyncio
async def test_stream_text_only():
    """纯文本流:多个 delta → 逐个 yield StreamChunk(type=delta)。"""
    provider = _make_provider()
    chunks = [
        _FakeChunk([_FakeChoice(_FakeDelta(content="你好"))]),
        _FakeChunk([_FakeChoice(_FakeDelta(content="世界"))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="stop")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    assert len(results) == 2
    assert results[0].type == "delta" and results[0].text == "你好"
    assert results[1].type == "delta" and results[1].text == "世界"


@pytest.mark.asyncio
async def test_stream_tool_calls_accumulation():
    """tool_calls 分片累积:多个分片 → finish_reason=tool_calls 时一次性 yield 完整 tool_calls。"""
    provider = _make_provider()
    # 模拟分片到达:id/name 在首片,args 分 2 片到达
    chunks = [
        _FakeChunk([_FakeChoice(_FakeDelta(tool_calls=[
            _make_tc_delta(0, id_="call_1", name="apply_actions", args_fragment='{"act')
        ]))]),
        _FakeChunk([_FakeChoice(_FakeDelta(tool_calls=[
            _make_tc_delta(0, args_fragment='ions":[1]}')
        ]))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="tool_calls")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(
        messages=[ChatMessage(role="user", content="do")],
        tools=[{"type": "function", "function": {"name": "apply_actions"}}],
    )
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    # 应只有一个 tool_calls chunk
    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1
    tcs = tc_chunks[0].tool_calls
    assert len(tcs) == 1
    # 格式必须是 OpenAI 原始格式(parse_tool_call 期望)
    assert tcs[0]["id"] == "call_1"
    assert tcs[0]["function"]["name"] == "apply_actions"
    assert tcs[0]["function"]["arguments"] == '{"actions":[1]}'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_openai_stream.py -v`
Expected: FAIL — 当前 `chat_stream` 不传 tools、不 yield tool_calls

- [ ] **Step 3: 实现 chat_stream 改造**

用以下内容**完全替换** `openai.py:163-195` 的 `chat_stream` 方法:

```python
    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """
        @methoddesc 发送流式对话请求(支持 tools 与 tool_calls 分片累积),逐块返回统一 StreamChunk

        统一输出契约:
        - delta 文本 → StreamChunk(type="delta", text=...)
        - tool_calls(分片累积, finish_reason="tool_calls" 时) → StreamChunk(type="tool_calls", tool_calls=[...原始格式])

        参数:
            req: 对话请求对象

        返回:
            AsyncIterator[StreamChunk]: 统一流式输出单元

        异常:
            APIConnectionError: 网络连接失败
            APIStatusError: 服务端返回错误
            ValueError: 流式响应解析异常
        """
        try:
            # 构造 messages payload,与非流式 chat 一致(支持 tool_calls/tool_call_id 上下文)
            messages_payload = []
            for m in req.messages:
                msg: dict = {"role": m.role}
                if m.content is not None:
                    msg["content"] = m.content
                if m.tool_calls is not None:
                    msg["tool_calls"] = m.tool_calls
                if m.tool_call_id is not None:
                    msg["tool_call_id"] = m.tool_call_id
                messages_payload.append(msg)

            kwargs: dict = {
                "model": self._get_model(req.model),
                "messages": messages_payload,
                "temperature": req.temperature,
                "stream": True,
            }
            if req.tools:
                kwargs["tools"] = req.tools
                kwargs["tool_choice"] = req.tool_choice if req.tool_choice is not None else "auto"

            stream = await self.client.chat.completions.create(**kwargs)

            # tool_calls 分片累积器: {index: {"id":"", "name":"", "arguments":""}}
            tc_acc: dict[int, dict[str, str]] = {}
            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                # 1. 文本增量 → 立即 yield
                if delta and delta.content:
                    yield StreamChunk(type="delta", text=delta.content)

                # 2. tool_calls 分片 → 累积(不立即 yield)
                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        slot = tc_acc.setdefault(
                            tc.index, {"id": "", "name": "", "arguments": ""}
                        )
                        if getattr(tc, "id", None):
                            slot["id"] = tc.id
                        if getattr(tc.function, "name", None):
                            slot["name"] = tc.function.name
                        slot["arguments"] += tc.function.arguments or ""

                # 3. finish_reason="tool_calls" → 一次性 yield 完整 tool_calls(OpenAI 原始格式)
                if choice.finish_reason == "tool_calls":
                    yield StreamChunk(
                        type="tool_calls",
                        tool_calls=[
                            {
                                "id": v["id"],
                                "type": "function",
                                "function": {
                                    "name": v["name"],
                                    "arguments": v["arguments"],
                                },
                            }
                            for v in tc_acc.values()
                        ],
                    )
                    tc_acc.clear()
                # finish_reason="stop" → 流自然结束(循环结束),无需特殊处理
        except (APIConnectionError, APIStatusError):
            raise
        except Exception as e:
            raise ValueError(f"流式响应异常: {e}") from e
```

- [ ] **Step 4: 导入 StreamChunk**

在 `openai.py` 顶部 import 段(同模块导入),确保有:

```python
from .base import ChatMessage, ChatRequest, ChatResponse, StreamChunk
```

(原文件已 import `ChatMessage, ChatRequest, ChatResponse`,只需追加 `StreamChunk`)

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_openai_stream.py -v`
Expected: PASS(2 个测试:`test_stream_text_only`, `test_stream_tool_calls_accumulation`)

- [ ] **Step 6: Ruff + 提交**

```bash
cd backend
python -m ruff check --fix app/shared/services/llm/providers/openai.py tests/unit/shared/services/llm/providers/test_openai_stream.py
python -m ruff format app/shared/services/llm/providers/openai.py tests/unit/shared/services/llm/providers/test_openai_stream.py
git add app/shared/services/llm/providers/openai.py tests/unit/shared/services/llm/providers/test_openai_stream.py
git commit -m "feat(ai): OpenAI chat_stream 补齐 tools 传递与 tool_calls 分片累积"
```

---

## Task A3:Ollama Provider — chat_stream 补齐 tool_calls

**Files:**
- Modify: `backend/app/shared/services/llm/providers/ollama.py:234-269`(替换 `chat_stream`)
- Test: `backend/tests/unit/shared/services/llm/providers/test_ollama_stream.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/unit/shared/services/llm/providers/test_ollama_stream.py`:

```python
"""Ollama chat_stream 流式 tool_calls 支持测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.ollama import OllamaProvider


def _make_provider() -> OllamaProvider:
    cfg = AIProvider(
        id="test", name="test", provider="ollama", base_url="http://localhost:11434", model="m"
    )
    return OllamaProvider(cfg)


class _FakeResp:
    """模拟 aiohttp response。"""

    def __init__(self, status, lines):
        self.status = status
        self._lines = lines
        self.request_info = MagicMock()
        self.history = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def text(self):
        return ""

    @property
    def content(self):
        async def _aiter():
            for line in self._lines:
                yield line
        return _aiter()


@pytest.mark.asyncio
async def test_ollama_stream_text():
    """纯文本流。"""
    provider = _make_provider()
    lines = [
        b'{"message":{"content":"你好"}}',
        b'{"message":{"content":"世界"}}',
        b'{"done":true}',
    ]
    session = MagicMock()
    session.post = MagicMock(return_value=_FakeResp(200, lines))
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    assert len(results) == 2
    assert results[0].type == "delta" and results[0].text == "你好"
    assert results[1].type == "delta" and results[1].text == "世界"


@pytest.mark.asyncio
async def test_ollama_stream_tool_calls():
    """Ollama tool_calls 在单 chunk 完整体到达。"""
    provider = _make_provider()
    tc_payload = b'{"message":{"content":"","tool_calls":[{"id":"call_1","function":{"name":"apply_actions","arguments":"{\\"actions\\":[1]}"}}]}}'
    lines = [tc_payload, b'{"done":true}']
    session = MagicMock()
    session.post = MagicMock(return_value=_FakeResp(200, lines))
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(
        messages=[ChatMessage(role="user", content="do")],
        tools=[{"type": "function", "function": {"name": "apply_actions"}}],
    )
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1
    tcs = tc_chunks[0].tool_calls
    assert len(tcs) == 1
    assert tcs[0]["id"] == "call_1"
    assert tcs[0]["function"]["name"] == "apply_actions"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_ollama_stream.py -v`
Expected: FAIL — 当前 `chat_stream` 只 yield content,不 yield tool_calls

- [ ] **Step 3: 实现 chat_stream 改造**

用以下内容**完全替换** `ollama.py:234-269` 的 `chat_stream` 方法:

```python
    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """
        @methoddesc 发送流式对话请求(支持 tool_calls),逐块返回统一 StreamChunk

        统一输出契约:
        - delta 文本 → StreamChunk(type="delta", text=...)
        - tool_calls(单 chunk 完整体到达时) → StreamChunk(type="tool_calls", tool_calls=[...OpenAI 格式])

        参数:
            req: 对话请求对象

        返回:
            AsyncIterator[StreamChunk]: 统一流式输出单元
        """
        if _aiohttp is None:
            raise ImportError("aiohttp 未安装,请运行 pip install aiohttp")

        data = self._build_chat_options(req)
        data["stream"] = True
        url = f"{self.cfg.base_url}/api/chat"
        session = await self._get_session()
        async with session.post(url, json=data) as resp:
            if resp.status >= 400:
                text = await resp.text()
                raise _aiohttp.ClientResponseError(
                    request_info=resp.request_info,
                    history=resp.history,
                    status=resp.status,
                    message=f"流式请求失败({resp.status}): {text[:200]}",
                )
            async for line in resp.content:
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "error" in chunk:
                    raise ValueError(f"Ollama 流式错误: {chunk['error']}")
                if "message" not in chunk:
                    continue
                message = chunk["message"]
                # 1. 文本增量 → yield delta
                content = message.get("content", "")
                if content:
                    yield StreamChunk(type="delta", text=content)
                # 2. tool_calls 完整体 → yield tool_calls(转换为 OpenAI 格式)
                raw_tcs = message.get("tool_calls")
                if raw_tcs:
                    yield StreamChunk(
                        type="tool_calls",
                        tool_calls=[
                            {
                                "id": tc.get("id", ""),
                                "type": "function",
                                "function": {
                                    "name": tc.get("function", {}).get("name", ""),
                                    "arguments": tc.get("function", {}).get("arguments", ""),
                                },
                            }
                            for tc in raw_tcs
                        ],
                    )
```

- [ ] **Step 4: 导入 StreamChunk**

在 `ollama.py` 顶部 import 段,确保有:

```python
from .base import ChatMessage, ChatRequest, ChatResponse, StreamChunk
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/shared/services/llm/providers/test_ollama_stream.py -v`
Expected: PASS(2 个测试)

- [ ] **Step 6: Ruff + 提交**

```bash
cd backend
python -m ruff check --fix app/shared/services/llm/providers/ollama.py tests/unit/shared/services/llm/providers/test_ollama_stream.py
python -m ruff format app/shared/services/llm/providers/ollama.py tests/unit/shared/services/llm/providers/test_ollama_stream.py
git add app/shared/services/llm/providers/ollama.py tests/unit/shared/services/llm/providers/test_ollama_stream.py
git commit -m "feat(ai): Ollama chat_stream 补齐 tool_calls 支持"
```

---

## Task A4:AgentExecutor — 流式化 + 回调 + 取消检查点

**Files:**
- Modify: `backend/app/shared/services/ai/agent/types.py`(AgentResult 加 cancelled)
- Modify: `backend/app/shared/services/ai/agent/executor.py`(run 方法)
- Test: `backend/tests/unit/shared/services/ai/agent/test_executor_stream.py`

- [ ] **Step 1: AgentResult 加 cancelled 字段**

在 `backend/app/shared/services/ai/agent/types.py` 的 `AgentResult` dataclass 定义中(`class AgentResult:` 块内,`error: str | None = None` 之后),追加字段:

```python
    # 取消标记:True 表示任务被软取消(区别于失败)。软取消时已落盘的 apply_actions 改动保留。
    cancelled: bool = False
```

同步更新 `to_dict` 方法,在返回 dict 中追加:

```python
            "cancelled": self.cancelled,
```

(放在 `"iterations": self.iterations,` 之后)

- [ ] **Step 1a: 写 AgentResult cancelled 单测**

在 `backend/tests/unit/shared/services/ai/agent/test_executor_stream.py` 开头添加:

```python
"""AgentExecutor 流式化测试。"""

from __future__ import annotations

import pytest

from app.shared.services.ai.agent.types import AgentResult


def test_agent_result_cancelled_default():
    """AgentResult 默认 cancelled=False。"""
    r = AgentResult(success=True)
    assert r.cancelled is False
    assert r.to_dict()["cancelled"] is False


def test_agent_result_cancelled_true():
    """AgentResult 可设置 cancelled=True。"""
    r = AgentResult(success=False, cancelled=True, error="任务已取消")
    assert r.cancelled is True
    assert r.to_dict()["cancelled"] is True
```

运行:`cd backend && python -m pytest tests/unit/shared/services/ai/agent/test_executor_stream.py::test_agent_result_cancelled_default tests/unit/shared/services/ai/agent/test_executor_stream.py::test_agent_result_cancelled_true -v`
Expected: PASS(此时仅 types 改动已生效)

- [ ] **Step 2: 写 AgentExecutor 流式化失败测试**

在 `test_executor_stream.py` 追加:

```python
from unittest.mock import AsyncMock, MagicMock

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest, StreamChunk


def _make_mock_provider_with_stream(chunks_per_turn: list[list[StreamChunk]]):
    """构造 mock provider,chat_stream 按轮次返回预设 StreamChunk 序列。

    chunks_per_turn[i] 是第 i+1 轮的 StreamChunk 列表。
    """
    provider = MagicMock()
    provider.model = "test-model"

    # 用可变索引模拟轮次递增
    state = {"turn": 0}

    class _StreamResult:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._it = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration

    async def _chat_stream(req):
        chunks = chunks_per_turn[state["turn"]]
        state["turn"] += 1
        return _StreamResult(chunks)

    provider.chat_stream = _chat_stream
    return provider


@pytest.mark.asyncio
async def test_executor_streams_delta_and_terminates_on_text():
    """流式文本:delta 回调被触发,无 tool_calls → 终止。"""
    provider = _make_mock_provider_with_stream([
        [StreamChunk(type="delta", text="你好"), StreamChunk(type="delta", text="世界")]
    ])
    registry = ToolRegistry()
    chunks_received = []
    turns_received = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_chunk=lambda t: chunks_received.append(t),
        on_turn=lambda n: turns_received.append(n),
    )

    result = await executor.run("测试任务")

    assert "".join(chunks_received) == "你好世界"
    assert turns_received == [1]
    assert result.success is True
    assert result.content == "你好世界"


@pytest.mark.asyncio
async def test_executor_tool_calls_continue_loop():
    """有 tool_calls 的轮 → 执行工具后继续循环 → 下一轮纯文本终止。"""
    # 第 1 轮:tool_calls;第 2 轮:纯文本
    provider = _make_mock_provider_with_stream([
        [StreamChunk(type="tool_calls", tool_calls=[
            {"id": "c1", "function": {"name": "noop", "arguments": "{}"}}
        ])],
        [StreamChunk(type="delta", text="完成")],
    ])
    registry = ToolRegistry()
    # 注册一个 noop 工具
    registry.register("noop", "测试工具", {"type": "object", "properties": {}}, lambda args: {"success": True})

    tool_calls_received = []
    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_tool_call=lambda name, cid, turn: tool_calls_received.append((name, cid, turn)),
    )

    result = await executor.run("测试任务")

    assert result.success is True
    assert result.content == "完成"
    assert tool_calls_received == [("noop", "c1", 1)]


@pytest.mark.asyncio
async def test_executor_cancel_at_turn_start():
    """取消检查点(turn 开始):第 2 轮开始时 cancelled=True → 返回 cancelled 结果。"""
    provider = _make_mock_provider_with_stream([
        [StreamChunk(type="delta", text="第一轮")],
        # 第 2 轮不会真正执行(取消)
    ])
    registry = ToolRegistry()
    cancel_flags = [False, True]  # 第 2 次检查(第 2 轮开始)返回 True

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        cancelled_callback=lambda: cancel_flags.pop(0),
    )

    result = await executor.run("测试任务")

    assert result.success is False
    assert result.cancelled is True
    assert "取消" in (result.error or "")
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/shared/services/ai/agent/test_executor_stream.py -v`
Expected: FAIL — executor 未接 chat_stream、无 on_chunk 回调

- [ ] `executor.py` run 方法改造(较大,需要先读全 → 替换)。先读取当前完整 run 方法及周围上下文:`executor.py:98-235`。

**Step 4 占位:读 executor.py run 方法完整实现 → 设计精确替换**

(实际编写时,Step 4-6 会是:替换 `run` 方法核心循环 → 加回调参数到构造函数 → 运行测试 → 提交。由于 executor.py run 方法较长且包含多处取消检查点/终止判定,需要精确逐行替换,这部分在执行时详细展开。)

---

## Task A5:AgentExecutor run 方法精确改造

**Files:**
- Modify: `backend/app/shared/services/ai/agent/executor.py`

- [ ] **Step 1: 构造函数加回调参数**

读取 `executor.py:60-96` 的 `__init__`,在现有参数 `on_tool_result` 之后追加:

```python
        on_chunk: Callable[[str], None] | None = None,
        on_turn: Callable[[int], None] | None = None,
        on_tool_call: Callable[[str, str, int], None] | None = None,
```

并在 `__init__` body 中赋值:

```python
        self.on_chunk = on_chunk or (lambda text: None)
        self.on_turn = on_turn or (lambda turn: None)
        self.on_tool_call = on_tool_call or (lambda name, call_id, turn: None)
```

- [ ] **Step 2: 替换 run 方法中 provider.chat 调用**

读取 `executor.py:98-235`,将以下逻辑:

```python
            req = ChatRequest(...)
            try:
                llm_response = await self.provider.chat(req)
            except Exception as e:
                ...
            content = llm_response.content
            raw_tool_calls = llm_response.tool_calls or []
            tool_calls = [self.registry.parse_tool_call(tc) for tc in raw_tool_calls]
```

替换为流式版本(详见 executor.py 当前实现,核心改动:把 `await self.provider.chat(req)` 换成 `async for chunk in await self.provider.chat_stream(req): ...`,在循环内累积 text + tool_calls,并在 chunk 间检查取消):

具体替换代码(执行时根据当前 executor.py 精确匹配):

```python
            req = ChatRequest(
                messages=chat_messages,
                model=self.provider.model if hasattr(self.provider, "model") else None,
                temperature=0.3,
                tools=tools,
                tool_choice="auto",
            )

            # 流式调用:累积文本 + tool_calls,逐字触发 on_chunk
            content = ""
            raw_tool_calls: list[dict[str, Any]] = []
            try:
                async for chunk in await self.provider.chat_stream(req):
                    # 取消检查点 2:流内 chunk 间
                    if self.cancelled_callback():
                        result.success = False
                        result.cancelled = True
                        result.error = "任务已取消"
                        return result
                    if chunk.type == "delta":
                        content += chunk.text or ""
                        self.on_chunk(chunk.text or "")
                    elif chunk.type == "tool_calls" and chunk.tool_calls:
                        raw_tool_calls.extend(chunk.tool_calls)
            except Exception as e:
                logger.error(f"Agent LLM 流式调用失败: {e}")
                result.success = False
                result.error = f"AI 服务调用失败: {e}"
                return result

            tool_calls = [self.registry.parse_tool_call(tc) for tc in raw_tool_calls]
```

- [ ] **Step 3: 加 on_turn / on_tool_call 回调触发**

在 run 方法每轮循环开始(`for turn_idx in range(...)`)之后、取消检查之后,加:

```python
            self.on_turn(turn_idx)
```

在有 `tool_calls` 的分支(执行工具前),遍历 tool_calls 触发回调:

```python
            if tool_calls:
                for tc in tool_calls:
                    self.on_tool_call(tc.name, tc.id, turn_idx)
                # ... 后续 execute_many 不变
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/shared/ai/agent/test_executor_stream.py -v`
Expected: PASS(全部测试)

- [ ] **Step 5: 运行全量后端测试确认无回归**

Run: `cd backend && python -m pytest -x`
Expected: 全部 PASS(确保流式化未破坏现有 generation agent)

- [ ] **Step 6: Ruff + 提交**

```bash
cd backend
python -m  ruff check --fix app/shared/services/ai/agent/executor.py app/shared/services/ai/agent/types.py
python -m ruff format app/shared/services/ai/agent/executor.py app/shared/services/ai/agent/types.py
git add app/shared/services/ai/agent/executor.py app/shared/services/ai/agent/types.py tests/unit/shared/services/ai/agent/test_executor_stream.py
git commit -m "feat(ai): AgentExecutor 流式化(chat→chat_stream)+ 回调 + 取消检查点"
```

---

## Task A6:chat_agent_runner — 暴露回调配置入口

**Files:**
- Modify: `backend/app/shared/services/ai/chat_agent_runner.py`
- Test: 扩展 `backend/tests/unit/shared/services/ai/agent/test_executor_stream.py`(或新建 `test_chat_agent_runner_callbacks.py`)

spec 要求 StreamingOrchestrator 通过 `runner.configure_callbacks(...)` 注入回调,当前 runner 直接 `new AgentExecutor(...)` 没有暴露入口。需要加一个配置方法。

- [ ] **Step 1: 写失败测试**

在 `test_chat_agent_runner_callbacks.py`:

```python
"""ChatAgentRunner 回调配置入口测试。"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.shared.services.ai.chat_agent_runner import ChatAgentRunner


def test_configure_callbacks_stores_callbacks():
    """configure_callbacks 存储回调,后续 run 时透传给 AgentExecutor。"""
    runner = ChatAgentRunner(provider=MagicMock(), project_path="/tmp")
    chunks = []
    runner.configure_callbacks(
        on_chunk=lambda t: chunks.append(t),
        on_turn=lambda n: None,
        on_tool_call=lambda name, cid, turn: None,
        on_tool_result=lambda r: None,
        cancelled=lambda: False,
    )
    # 回调应被存储,可通过 _callbacks 属性或等效方式访问
    assert runner._callbacks["on_chunk"]("x") is None  # 调用不报错
    chunks.append("y")
    assert chunks == ["y"]


def test_configure_callbacks_defaults_to_noop():
    """未调用 configure_callbacks 时,run 不报错(用默认 noop)。"""
    runner = ChatAgentRunner(provider=MagicMock(), project_path="/tmp")
    # 不调 configure_callbacks,直接访问 _callbacks 应为空 dict 或 noop
    # (具体实现:run 方法里 _callbacks.get("on_chunk", lambda t: None))
    assert hasattr(runner, "_callbacks")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/shared/services/ai/agent/test_chat_agent_runner_callbacks.py -v`
Expected: FAIL — `configure_callbacks` 方法不存在 / `_callbacks` 属性不存在

- [ ] **Step 3: 实现 configure_callbacks**

读取 `chat_agent_runner.py:304` 的 `run` 方法,改造:

(a) `ChatAgentRunner.__init__` 末尾追加:

```python
        self._callbacks: dict[str, Any] = {}
```

(b) 新增方法(放在 `run` 方法之前):

```python
    def configure_callbacks(self, **kwargs):
        """@methoddesc 配置流式回调,run 时透传给 AgentExecutor。

        由 StreamingOrchestrator 调用,把 on_chunk/on_turn/on_tool_call/on_tool_result/cancelled
        注入,实现 service 输出 → 事件流的桥接。
        """
        self._callbacks = kwargs
```

(c) 在 `run` 方法创建 `AgentExecutor` 的地方(`executor = AgentExecutor(...)`),把存储的回调透传:

```python
        executor = AgentExecutor(
            provider=self.provider,
            registry=registry,
            system_prompt=self.system_prompt,
            max_iterations=self.max_iterations,
            max_tokens=self.max_history_tokens,
            # 流式回调透传(未配置时为 None,AgentExecutor 内部用默认 noop)
            on_chunk=self._callbacks.get("on_chunk"),
            on_turn=self._callbacks.get("on_turn"),
            on_tool_call=self._callbacks.get("on_tool_call"),
            on_tool_result=self._callbacks.get("on_tool_result"),
            cancelled_callback=self._callbacks.get("cancelled"),
        )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/shared/services/ai/agent/test_chat_agent_runner_callbacks.py -v`
Expected: PASS(2 个测试)

- [ ] **Step 5: Ruff + 提交**

```bash
cd backend
python -m ruff check --fix app/shared/services/ai/chat_agent_runner.py tests/unit/shared/services/ai/agent/test_chat_agent_runner_callbacks.py
python -m ruff format app/shared/services/ai/chat_agent_runner.py tests/unit/shared/services/ai/agent/test_chat_agent_runner_callbacks.py
git add app/shared/services/ai/chat_agent_runner.py tests/unit/shared/services/ai/agent/test_chat_agent_runner_callbacks.py
git commit -m "feat(ai): ChatAgentRunner 暴露 configure_callbacks 入口供流式回调注入"
```

---

## Task A7:StreamingOrchestrator 与 EventJournal

这是后端核心,较大。包含:
- `streaming/types.py`:事件类型常量 + StreamEvent 数据模型
- `streaming/event_journal.py`:EventJournal(追加/读取/续传/清理)
- `streaming/orchestrator.py`:StreamingOrchestrator(包装 3 个 service)
- `streaming/sse_response.py`:SSE StreamingResponse 封装

**Step 1-N**:对每个文件写失败测试 → 实现 → 运行 → 提交。具体代码在执行时展开。

**EventJournal 关键设计**(执行时详细编码):
- `__init__(job_id, journal_dir)`:构造路径 `~/.precis/jobs/<hash>/<job_id>.journal`
- `append(event: str, data: dict) -> int`:追加 JSON 行,返回分配的递增 id(加文件锁)
- `read_since(last_id: int) -> list[tuple[int, str, dict]]`:读取 id > last_id 的所有事件(用于续传)
- `read_all() -> list[tuple[int, str, dict]]`:读取全部(用于已完成任务重连)
- `is_terminated() -> bool`:检查最后一条是否终止事件
- `cleanup()`:删除 journal 文件

**StreamingOrchestrator 关键设计**:
- 三方法 `run_chat`/`run_generate`/`run_migrate`,各自包装对应 service
- 通过回调注入把 service 的进度/结果转成事件
- `finally` 块注销 `_cancel_events` entry(防内存泄漏)
- `emit` 方法同时落盘 EventJournal + 推给 SSE 队列(asyncio.Queue)

**SSE 响应封装**:
- `create_sse_streaming_response(job_id, journal, orchestrator_task) -> StreamingResponse`
- 支持 Last-Event-ID header 续传
- 自动心跳(每 15s 发 `:keep-alive` 注释行防代理超时)

---

## Task A8:SSE 路由 + Cancel 端点

**Files:**
- Create: `backend/app/api/routers/ai/stream.py`
- Modify: `backend/app/api/routers/ai/router.py`(注册路由)

**关键端点**:
- `POST /ai/chat/stream`:接收 chat 请求 → 创建 job_id → 启动 orchestrator task → 返回 SSE
- `POST /ai/config/generate/stream`:类似,包装 ConfigGenerationService
- `POST /ai/config/migrate/stream`:类似,包装 ConfigMigrationService
- `POST /ai/jobs/{job_id}/cancel`:设置 cancel_event

**路由注册**:在 `router.py` 的 `router.include_router(...)` 列表追加 stream 子路由。

**Step 1-N**:写端点 → 处理 Last-Event-ID → 启动 task → SSE 响应 → 提交。

---

# 阶段 B:前端聊天流式

## Task B1:统一 SSE 客户端

**Files:**
- Create: `frontend/src/core/services/sseClient.ts`
- Test: `frontend/tests/core/services/sseClient.test.ts`

**核心实现**(fetch + ReadableStream):
- `connect(url, body, headers, callbacks)`:发起 POST fetch,读取 ReadableStream,按 SSE 格式解析
- `setLastEventId(id)`:更新 Last-Event-ID,用于重连
- `cancel(jobId)`:POST /ai/jobs/{id}/cancel
- 自动重连:指数退避(1s/2s/5s,最多 3 次),带 Last-Event-ID header
- 事件去重:`lastProcessedId` 机制

**Step 1-N**:写失败测试(mock fetch ReadableStream)→ 实现 → 运行 → 提交。

---

## Task B2:流式状态机 useStreamingMessage

**喂入事件序列 → 聚合成可渲染消息状态**。

**核心状态**:`content`(累积 delta)、`toolSteps`(工具轨迹)、`isStreaming`、`status`。
**关键容错**:`completed` 事件的完整快照覆盖累积结果(防丢)。

**Step 1-N**:写失败测试 → 实现 → 运行 → 提交。

---

## Task B3:AIChatPanel 增强 + ToolTrailCard 组件

**Files:**
- Create: `frontend/src/components/ai/ToolTrailCard.vue`
- Modify: `frontend/src/components/ai/AIChatPanel.vue`
- Modify: `frontend/src/stores/aiChatStore.ts`(sendMessage 改 SSE)

**ToolTrailCard.vue**:折叠卡组件,props 接收 toolSteps + status,内部维护展开/折叠态。形态:折叠态"🔧 已完成 N 步 ▾",展开态列出每步 ✓/⟳/✗。

**AIChatPanel.vue 改动**:
- AI 消息渲染时,若 `msg.streamingMessage` 存在,渲染流式区(delta 实时累积 + 光标)
- 比起现有 `v-html="renderMarkdown(msg.content)"`,流式时先累积到 streamingMessage.content,完成后切换为 markdown 渲染
- 顶部加取消按钮(loading 时发送按钮变停止图标)
- 重新挂载 ToolTrailCard(从被禁用的 Drawer 迁移)

**aiChatStore.ts sendMessage 改造**:
- 原 `sendAiChatMessage`(POST + await)→ 改用 `sseClient.connect`
- 创建 streamingMessage 状态 → SSE 事件实时更新 → 终止事件后最终化
- 接入取消逻辑

**Step 1-N**:TDD:写工具轨迹折叠卡形态测试(E2E)→ 实现 ToolTrailCard → AIChatPanel 集成 → store 改造 → E2E 用例 → 提交。

---

# 阶段 C:前端生成/迁移接 SSE

## Task C1:useGenerationJob 接 SSE

**Files:**
- Modify: `frontend/src/features/ai-config-generator/composables/useGenerationJob.ts`

**改动**:
- 移除 `pollJob`/`setInterval(pollJob, 600)` 轮询逻辑
- 改用 `sseClient.connect(/ai/config/generate/stream, ...)`
- SSE 事件 → 更新 `progressMessage`/`currentStage`/`receivedChars`/`generatedConfig`/`yamlPreview`/`metrics`/`currentPlan`
- `cancelGenerate` 改用 `sseClient.cancel(jobId)`

**Step 1-N**:TDD → 改造 → E2E → 提交。

---

## Task C2:useMigrationJob 接 SSE

**Files:**
- Modify: `frontend/src/features/ai-config-generator/composables/useMigrationJob.ts`

**改动**:同 C1,迁移场景。

**Step 1-N**:TDD → 改造 → E2E → 提交。

---

# 阶段 D:清理

## Task D1:移除前端 timeout 特例 + 清理轮询代码

**Files:**
- Modify: `frontend/src/core/services/httpClient.ts`:移除/放宽 chat 请求 timeout
- 清理:三处 composable 残留的轮询相关变量/函数

**Step 1**:TDD → 改造 → E2E → 提交。

---

## 自查清单(执行后)

- [ ] Provider chat_stream 单测全绿(openai + ollama tool_calls 分片/完整体)
- [ ] AgentExecutor 流式化单测全绿(delta/终止判定/取消检查点)
- [ ] EventJournal 单测全绿(追加/续传/清理)
- [ ] StreamingOrchestrator 单测全绿(emit/取消/finally 注销)
- [ ] sseClient 单测全绿(解析/重连/去重/取消)
- [ ] useStreamingMessage 单测全绿(状态机转换)
- [ ] E2E 聊天流式用例绿(delta 逐字 + 轨迹卡 + 取消)
- [ ] E2E 配置生成流式用例绿
- [ ] E2E 迁移流式用例绿
- [ ] 后端全量测试无回归
- [ ] 前端全量测试无回归
- [ ] Ruff/ESLint/Prettier 全绿
- [ ] type-check 全绿

---

## 阶段 A 详细任务表(自查用)

| Task | 内容 | 依赖 |
|------|------|------|
| A1 | StreamChunk 类型 | — |
| A2 | OpenAI chat_stream | A1 |
| A3 | Ollama chat_stream | A1 |
| A4 | AgentResult cancelled | — |
| A5 | AgentExecutor 流式化 | A2, A3, A4 |
| A6 | chat_agent_runner configure_callbacks | A5 |
| A7 | StreamingOrchestrator + EventJournal | A6 |
| A8 | SSE 路由 + Cancel | A7 |

## 阶段 B 详细任务表

| Task | 内容 | 依赖 |
|------|------|------|
| B1 | sseClient | — |
| B2 | useStreamingMessage | — |
| B3 | AIChatPanel + ToolTrailCard + store | B1, B2, 后端 A8 |

## 阶段 C 详细任务表

| Task | 内容 | 依赖 |
|------|------|------|
| C1 | useGenerationJob SSE | B1, 后端 A8 |
| C2 | useMigrationJob SSE | B1, 后端 A8 |

## 阶段 D

| Task | 内容 | 依赖 |
|------|------|------|
| D1 | 清理 timeout + 轮询 | B3, C1, C2 |

---

## 关于这份计划的一些说明

这份计划覆盖 spec 全部范围,但有几个地方做了 **"框架 + 执行时展开"** 的处理,需要你知道:

1. **Task A6/A7、B1-B3、C1-C2、D1** 没有写出完整代码块——它们涉及读取现有代码精确实现后才能写出准确替换代码(EventJournal/Orchestrator/SSE 路由/sseClient/前端组件等)。这些在执行时我会按 TDD 写出完整代码。但我已经在计划里给出了**关键设计约束**(StreamChunk 格式对齐 parse_tool_call、回调注入模式、取消检查点粒度等)和**文件结构**,确保执行方向不会跑偏。

2. **E2E 测试**:项目 E2E-first 策略,聊天/生成/迁移的流式 E2E 是验证正确性的主手段。单测覆盖纯逻辑(sseClient/useStreamingMessage/Provider/EventJournal),E2E 覆盖集成行为。

这份计划**框架完整、阶段依赖清晰、A1-A5 有完整代码块**,但 **A6-A7、B1-B3、C1-C2、D1 的具体代码留待执行时展开**。这是因为这些任务依赖"读取当前精确代码后才能写准确的替换代码"——在执行时我会严格 TDD,写完整测试+实现+提交。

**两个执行选择:**

**1. Subagent-Driven(推荐)** — 我为每个 task 派发新的 subagent 执行,任务间 review,快速迭代。适合这种大计划。

**2. Inline Execution** — 在当前会话按 executing-plans 批量执行,带检查点 review。

**哪个方式?**