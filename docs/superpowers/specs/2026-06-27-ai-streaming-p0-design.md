# AI 流式响应与可观测性增强(P0)设计

> **日期**: 2026-06-27
> **范围**: P0 四项 + P1-5(取消)+ Q9(流式 tool_calls)
> **状态**: 待实施
> **决策来源**: brainstorming 会话(已确认 4 个关键决策)

## 1. 背景与目标

### 1.1 问题陈述

Precis 的 AI 功能存在三个严重影响可用性的问题:

- **P0-1 超时不匹配**:前端 axios 全局 `timeout: 30000`(`httpClient.ts:144`),而 Agent 模式需 3 轮迭代 × (LLM 60s + 工具 IO),用户几乎必然看到超时报错,且后端仍在消耗 token。
- **P0-2 无流式反馈**:聊天主端点 `/ai/chat` 和前端都没接入流式。用户发送消息后只能盯着三点动画等待几十秒,全程无中间反馈。Provider 层虽有 `chat_stream` 能力,但未用于主链路。
- **P0-3 工具轨迹丢失**:后端精心构建了 `tool_steps`(工具名+label+轮次+action_count),前端 store 也存了 `agentMeta`,但当前激活的 `AIChatPanel.vue:53` 只渲染 `renderMarkdown(msg.content)`,完全没渲染 agentMeta。展示逻辑留在被注释禁用的 `AIChatDrawer.vue`。
- **P0-4 写入无确认**:`apply_actions` 工具直接 `process_actions` 写文件,无二次确认。LLM 误解意图时配置被静默修改。

附加问题:

- **P1-5 取消机制缺失**:`sendMessage` 无 AbortController,runner 也没传 `cancelled_callback`,用户无法中断。
- **Q9 流式 tool_calls 缺失**:OpenAI `chat_stream`(openai.py:163-195)不传 tools、忽略 tool_calls delta;Ollama `chat_stream`(ollama.py:247-269)丢弃 tool_calls。

### 1.2 目标

1. 聊天/配置生成/脚本迁移三处统一接入 **全链路流式响应**(方案 C),每一轮 LLM 思考和工具调用都实时展示。
2. 补齐 Provider 层流式 tool_calls 支持,统一两边输出契约。
3. 工具调用轨迹以折叠卡形式在 AIChatPanel 实时展示,恢复可观测性。
4. 统一 SSE 机制 + EventJournal 落盘 + Last-Event-ID 续传,支持刷新页面后任务不断。
5. 三处场景接入软取消,已落盘改动保留,轨迹如实显示。

### 1.3 非目标

- 不扩展 Provider 类型(Anthropic/Gemini 等留待后续)。
- 不改动现有业务逻辑(画像、约束生成、校验等),只做流式包装。
- P0-4(写入确认)不在本 spec 范围,作为独立的后续 spec。

### 1.4 已确认的关键决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 流式方案 | 全链路流式(方案 C) | alpha 阶段接受大改动;连带解决 Q9 |
| 2 | UI 载体 | 增强现有 AIChatPanel | 消除两套组件分裂,不恢复旧 Drawer |
| 3 | 轨迹形态 | 折叠卡 | 信息密度可控,不推挤流式回复 |
| 4 | SSE 范围 | 三处统一 SSE + 落盘 + 续传 | 体验一致性 + 刷新页面任务不断 |
| 5 | 取消语义 | 软取消 | 已落盘改动保留,轨迹如实显示 |
| 6 | SSE 客户端实现 | fetch + ReadableStream | 需带 POST body + 自定义 header,EventSource 不支持 |

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (aiChatStore + useGenerationJob + useMigrationJob)    │
│  统一 SSE 客户端 (core/services/sseClient.ts) ← 新建        │
│  - fetch + ReadableStream                                   │
│  - 自动重连 + Last-Event-ID 续传(指数退避,最多 3 次)      │
│  - 事件去重(按 event_id)                                  │
│  - 取消按钮 → POST /ai/jobs/{id}/cancel                     │
└───────────────┬─────────────────────────────────────────────┘
                │ SSE (text/event-stream)
┌───────────────▼─────────────────────────────────────────────┐
│  后端 SSE 路由层 (routers/ai/stream.py) ← 新建,统一入口     │
│  POST /ai/chat/stream                                        │
│  POST /ai/config/generate/stream                             │
│  POST /ai/config/migrate/stream                              │
│  DELETE /ai/jobs/{job_id}/cancel                             │
│  - 启动后台 task + 返回 StreamingResponse                    │
│  - 重连时读取 Last-Event-ID → 从 EventJournal 续传           │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│  流式执行内核 (services/ai/streaming/) ← 新建                │
│  StreamingOrchestrator — 把现有 3 个 service 包装成事件流   │
│  EventJournal — 持久化事件序列(支持 Last-Event-ID 续传)    │
│  调用底层现有 service,不改业务逻辑(回调注入)              │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│  现有业务层(基本不动)                                       │
│  ConfigGenerationService / ConfigMigrationService           │
│  AIChatOrchestrator + AgentExecutor                         │
│  ★ AgentExecutor 改造:provider.chat → provider.chat_stream │
│  ★ Provider 改造:补齐 chat_stream 的 tool_calls 支持       │
└─────────────────────────────────────────────────────────────┘
```

**关键设计原则**:

1. **统一事件协议**:三个场景发出相同结构的事件(type/data/event_id),前端用同一个 SSE 客户端消费。
2. **EventJournal 落盘**:每个 job_id 维护追加写入的事件日志文件,断线重连时从 `Last-Event-ID` 之后续传。
3. **业务层最小改动**:StreamingOrchestrator 是包装层,通过回调把现有 service 的进度/结果转成事件;AgentExecutor 内部把 `chat()` 换成 `chat_stream()` 并增加逐字回调。

## 3. 统一事件协议

### 3.1 事件格式

所有事件统一为 SSE 标准格式:`id` + `event` + `data`。

```
id: 1
event: started
data: {"job_id":"job_abc","kind":"chat|generate|migrate","ts":1706000000}

id: 3
event: delta
data: {"text":"我将"}

id: 5
event: tool_call
data: {"tool":"apply_actions","call_id":"call_1","turn":1,"label":"修改配置"}

id: 6
event: tool_result
data: {"call_id":"call_1","success":true,"action_count":2,"label":"修改配置"}

id: 7
event: progress
data: {"stage":"agent_executing_tools","progress":0.5,"msg":"正在修改配置"}

id: 9
event: completed
data: {"reply":"...完整回复...","frontend_instructions":[...],"tool_steps":[...],"result":{...}}

event: error
data: {"message":"...","code":"LLM_TIMEOUT"}

event: cancelled
data: {"completed_turns":2,"partial":true,"tool_steps":[...]}
```

### 3.2 事件类型清单

| 事件 | chat | generate | migrate | 终止? | 说明 |
|------|:----:|:--------:|:-------:|:-----:|------|
| `started` | ✓ | ✓ | ✓ | 否 | 任务启动,携带 job_id/kind |
| `progress` | — | ✓ | ✓ | 否 | 阶段进度(画像/分块/合并等) |
| `turn_start` | ✓ | ✓ | ✓ | 否 | Agent 新一轮开始 |
| `delta` | ✓ | ✓ | ✓ | 否 | 流式文本块(增量,前端累积) |
| `tool_call` | ✓ | ✓ | ✓ | 否 | 工具调用开始 |
| `tool_result` | ✓ | ✓ | ✓ | 否 | 工具执行完成 |
| `completed` | ✓ | ✓ | ✓ | 是 | 成功完成(含完整快照) |
| `error` | ✓ | ✓ | ✓ | 是 | 失败 |
| `cancelled` | ✓ | ✓ | ✓ | 是 | 软取消确认 |

### 3.3 关键约定

- **`delta` 增量语义**:`delta` 只承载增量文本,不重复已发内容;前端自行累积。
- **终止事件是完整快照**:`completed`/`error`/`cancelled` 携带完整数据(reply 全文、所有 tool_steps、frontend_instructions、result),保证即使中途没收到 delta,前端也能渲染完整结果——这是续传的容错基础。
- **终止后关闭连接**:服务端发出终止事件后关闭 SSE 连接;前端收到终止事件后正常关闭,不重连。

## 4. EventJournal(落盘 + 续传)

### 4.1 存储结构

```
~/.precis/jobs/<project_hash>/<job_id>.journal
```

每行一个 JSON 对象(追加写入):

```json
{"id":3,"event":"delta","data":{"text":"我将"},"ts":1706000001}
```

### 4.2 续传逻辑

1. **首次连接**:服务端创建 job → 启动后台 task → 开始追加 journal → SSE 实时推送。
2. **断线重连**:客户端带上 `Last-Event-ID` header → 服务端读取 journal,从该 id+1 开始快速回放(不等延时)→ 回放到最新后切到实时推送。
3. **任务已完成的重连**(用户刷新页面):journal 里最后是 `completed`/`error`/`cancelled` 事件 → 服务端直接回放整个 journal 后关闭连接,前端据此恢复完整消息状态。
4. **journal 清理**:任务完成 24h 后删除(复用现有 `_JOB_TTL_HOURS = 24.0`)。

### 4.3 设计理由

文件而非内存:刷新页面/后端重启后任务状态不丢;多个并发请求(如同一 job 被多次重连)能共享同一份事件源。

## 5. 后端流式内核

### 5.1 Provider 层:补齐流式 tool_calls(连带解决 Q9)

#### 5.1.1 新增统一类型

`providers/base.py` 新增:

```python
@dataclass
class StreamChunk:
    """chat_stream 的统一输出单元。"""
    type: Literal["delta", "tool_calls"]
    text: str | None = None           # type="delta" 时有效
    tool_calls: list[ToolCall] | None = None  # type="tool_calls" 时有效
```

#### 5.1.2 OpenAI chat_stream 改造

难点:流式 tool_calls 是分片到达的,需按 `index` 累积拼接。

```python
async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
    stream = await self.client.chat.completions.create(
        model=self._get_model(req.model),
        messages=[...],
        tools=req.tools,          # ← 新增:传入 tools
        tool_choice=...,          # ← 新增
        temperature=req.temperature,
        stream=True,
    )
    tc_acc: dict[int, dict] = {}  # {index: {"id":"","name":"","arguments":""}}
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        # 1. 文本增量 → 立即 yield
        if delta.content:
            yield StreamChunk(type="delta", text=delta.content)
        # 2. tool_calls 分片 → 累积
        if delta.tool_calls:
            for tc in delta.tool_calls:
                slot = tc_acc.setdefault(tc.index, {"id":"","name":"","arguments":""})
                if tc.id: slot["id"] = tc.id
                if tc.function.name: slot["name"] = tc.function.name
                slot["arguments"] += tc.function.arguments or ""
        # 3. finish_reason="tool_calls" → 一次性 yield 完整 tool_calls
        if chunk.choices[0].finish_reason == "tool_calls":
            yield StreamChunk(type="tool_calls", tool_calls=[
                ToolCall(id=v["id"], name=v["name"], arguments=v["arguments"])
                for v in tc_acc.values()
            ])
            tc_acc.clear()
        # finish_reason="stop" → 流结束,无 tool_calls(不 yield,循环自然结束)
```

#### 5.1.3 Ollama chat_stream 改造

Ollama 流式每个 chunk 的 `message` 可能含 `tool_calls` 完整体(非分片)。逻辑更直接:逐字 `yield StreamChunk(type="delta")`;检测到 tool_calls 则 `yield StreamChunk(type="tool_calls")`。

#### 5.1.4 契约约定

两个 Provider 的 `chat_stream` 签名统一返回 `AsyncIterator[StreamChunk]`。上层 AgentExecutor 只消费 `StreamChunk`,不关心 Provider 差异。未来新增 Provider 只需实现此契约。

### 5.2 AgentExecutor 流式化

#### 5.2.1 新增回调

`agent/executor.py` 构造函数新增:

```python
def __init__(
    self,
    ...,
    on_chunk: Callable[[str], None] | None = None,        # 逐字文本回调
    on_turn: Callable[[int], None] | None = None,         # 新轮次回调
    on_tool_call: Callable[[str, str, int], None] | None = None,  # (name, call_id, turn)
    on_tool_result: Callable[[ToolResult], None] | None = None,
):
    self.on_chunk = on_chunk or (lambda text: None)
    ...
```

#### 5.2.2 循环改造

```python
async def run(self, task_message, ...):
    for turn_idx in range(1, self.max_iterations + 1):
        # 取消检查点 1:turn 开始
        if self.cancelled_callback():
            return AgentResult(success=False, error="任务已取消", cancelled=True)
        self.on_turn(turn_idx)
        ...
        # 改:chat → chat_stream,边收边回调
        tool_calls = None
        text_buffer = ""
        async for chunk in await self.provider.chat_stream(req):
            # 取消检查点 2:流内 chunk 间
            if self.cancelled_callback():
                break
            if chunk.type == "delta":
                text_buffer += chunk.text
                self.on_chunk(chunk.text)
            elif chunk.type == "tool_calls":
                tool_calls = [self.registry.parse_tool_call(tc) for tc in chunk.tool_calls]
        ...
```

#### 5.2.3 终止判定调整

当前:`provider.chat()` 一次返回,根据有无 tool_calls 判定。
流式后:`chat_stream` 走完且无 tool_calls chunk → 该 turn 的 text_buffer 即最终回复 → 终止;若有 tool_calls → 执行工具后继续循环。

### 5.3 StreamingOrchestrator(包装层)

新建 `services/ai/streaming/orchestrator.py`,把三个现有 service 包装成事件流。**不改业务逻辑**,只拦截输出转事件。

```python
class StreamingOrchestrator:
    def __init__(self, job_id, journal: EventJournal, cancel_event: asyncio.Event):
        self.job_id = job_id
        self.journal = journal
        self.cancel_event = cancel_event

    def emit(self, event: str, data: dict):
        """落盘 + 推给 SSE 队列。"""
        self.journal.append(event, data)

    async def run_chat(self, message, history, ...):
        self.emit("started", {"job_id": self.job_id, "kind": "chat"})
        runner = ChatAgentRunner(provider, ...)
        # 回调注入(桥接到 emit)
        runner.configure_callbacks(
            on_chunk=lambda text: self.emit("delta", {"text": text}),
            on_turn=lambda t: self.emit("turn_start", {"turn": t}),
            on_tool_call=lambda name,cid,t: self.emit("tool_call", {...}),
            on_tool_result=lambda r: self.emit("tool_result", {...}),
            cancelled=lambda: self.cancel_event.is_set(),
        )
        try:
            result = await runner.run(message, history)
            if self.cancel_event.is_set():
                self.emit("cancelled", {"completed_turns": result.iterations, "tool_steps": ...})
            else:
                self.emit("completed", {
                    "reply": result.reply,
                    "frontend_instructions": ...,
                    "tool_steps": ...,
                })
        finally:
            # 无论成功/取消/失败,注销取消信号,防止内存泄漏
            _unregister_cancel_event(self.job_id)

    async def run_generate(self, ...):   # 包装 ConfigGenerationService,发 progress 事件
    async def run_migrate(self, ...):    # 包装 ConfigMigrationService
```

**回调注入方式**:现有 service 已用 `progress_callback`/`cancelled_callback` 注入模式。本设计在 AgentExecutor/runner 上补 `on_chunk`/`on_tool_call`/`on_tool_result` 回调,StreamingOrchestrator 把它们桥接到 `emit`。业务逻辑零改动。

### 5.4 取消机制(软取消)

#### 5.4.1 取消信号

```python
# routers/ai/stream.py
_cancel_events: dict[str, asyncio.Event] = {}  # 内存中,job_id → 取消信号
_cancel_events_lock = threading.Lock()           # 保护字典并发访问

@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    ev = _cancel_events.get(job_id)
    if ev:
        ev.set()  # 通知正在跑的 task
        return {"status": "cancelling"}
    return {"status": "not_found"}

# 生命周期管理:StreamingOrchestrator 在 run_* 结束后(无论成功/取消/失败)
# 必须从 _cancel_events 移除该 job_id,防止内存泄漏。
def _unregister_cancel_event(job_id: str):
    with _cancel_events_lock:
        _cancel_events.pop(job_id, None)
```

#### 5.4.2 软取消行为

- `cancel_event.set()` 后,AgentExecutor 在**下一个检查点**(turn 开始 / 流内 chunk 间)中断循环。
- 已执行并落盘的 `apply_actions` 改动**保留**(符合软取消语义)。
- 发出 `cancelled` 事件,携带 `completed_turns` 和已执行的 tool_steps。
- 前端在轨迹折叠卡里如实显示"已执行 N 步,已取消"。

#### 5.4.3 取消检查点粒度

- turn 开始(`executor.py` 每轮循环开头)
- 流内 chunk 间(`chat_stream` 的 `async for` 内部)

粒度足够细(用户点击后最多等一个 chunk,约几百毫秒即响应),又不会细到每个字符检查影响性能。chunk 是自然的批处理边界。

## 6. 前端设计

### 6.1 统一 SSE 客户端

新建 `frontend/src/core/services/sseClient.ts`,三场景共用。

```typescript
interface SSEClient {
  connect(url: string, opts: {
    onEvent: (event: string, id: number, data: any) => void
    onError: (e: Error) => void
    onClose: () => void
  }): void
  cancel(jobId: string): Promise<void>  // → POST /ai/jobs/{id}/cancel
  close(): void
}
```

#### 6.1.1 实现选型

用 `fetch` + `ReadableStream` 而非原生 `EventSource`。原因:`EventSource` 只支持 GET(无法带 POST body 传参数)、不支持自定义 header(无法带 `X-Project-Config-Path` 和 `Last-Event-ID`)。fetch 流式可控性更强。

#### 6.1.2 重连 + 续传逻辑

- 记录最后收到的 `event_id`。
- 连接意外断开 → 自动带 `Last-Event-ID` header 重连(指数退避:1s/2s/5s,最多 3 次)。
- 重连后服务端从该 id+1 续传,前端**去重**(用 event_id 防止重复处理)。
- 收到终止事件(`completed`/`error`/`cancelled`)→ 正常关闭,不重连。

#### 6.1.3 事件去重

前端维护 `lastProcessedId`,收到 `id <= lastProcessedId` 的事件直接丢弃(防止重连续传时重复累积 delta)。

### 6.2 流式状态机

新建 `composables/useStreamingMessage.ts`,把事件流聚合成可渲染的消息状态,三个 store 共用。

```typescript
interface StreamingMessage {
  content: string                 // 累积的 delta 文本
  toolSteps: ToolStep[]           // 工具轨迹(折叠卡数据源)
  isStreaming: boolean
  status: 'streaming' | 'completed' | 'cancelled' | 'error'
}

function useStreamingMessage() {
  const msg = reactive<StreamingMessage>({ content: '', toolSteps: [], ... })
  function handleEvent(event: string, data: any) {
    switch (event) {
      case 'delta':        msg.content += data.text; break
      case 'tool_call':    msg.toolSteps.push({ label: data.label, status: 'running' }); break
      case 'tool_result':  更新对应 step 状态为 ✓/✗; break
      case 'turn_start':   触发折叠卡"新一轮"提示; break
      case 'completed':
        msg.isStreaming = false; msg.status = 'completed'
        // 用终止事件的完整快照覆盖累积结果(容错:防丢)
        msg.content = data.reply; msg.toolSteps = data.tool_steps; break
      case 'cancelled':    msg.status = 'cancelled'; break  // 已落盘改动保留,轨迹如实显示
      case 'error':        msg.status = 'error'; break
    }
  }
  return { msg, handleEvent }
}
```

**容错要点**:即便中途 delta 丢失,`completed` 的完整快照会覆盖累积结果,保证最终一致性。

### 6.3 AIChatPanel.vue 增强

在现有面板上加三个东西,**不破坏现有结构**:

**(a) 流式渲染区**:消息列表里 AI 消息从"等 loading 完整段出现"→"delta 实时累积,带光标 `▋`"。

**(b) 工具轨迹折叠卡**(方案A形态,每个 AI 消息体顶部):

```
┌─────────────────────────────────┐
│ 🔧 已完成 2 步              ▾  │  ← 折叠态,点击展开
└─────────────────────────────────┘
  展开后:
  ✓ 读取项目结构
  ✓ 读取 users 表 (12 列)
  ✓ 修改配置 (2 个动作)
```

- 流式中:`🔧 执行中 · 已完成 1 步`(进行中的步骤显示 ⟳)
- 完成后:自动折叠为 `🔧 已完成 N 步`
- 取消后:`🔧 已取消 · 已执行 2 步`(如实显示半成品)

**(c) 取消按钮**:loading 时发送按钮变为"停止"图标按钮,点击 → `sseClient.cancel(jobId)`。

### 6.4 三处场景接入

| 场景 | 改动 |
|------|------|
| **聊天** | `aiChatStore.sendMessage` 改用 SSE;`AIChatPanel` 加流式区+折叠卡+取消按钮 |
| **配置生成** | `useGenerationJob` 的轮询(`pollJob`)→ SSE;`PreviewPanel` 进度区接流式 |
| **迁移** | `useMigrationJob` 的轮询 → SSE;`MigratePanel` 进度区接流式 |

**废弃轮询**:三处 `setInterval(pollJob)` 全部移除,统一走 `sseClient`。后端 `/jobs/{id}/status` 轮询端点保留(作为降级/调试用,不删)。

### 6.5 渲染容错

- 流式中途网络断 → 自动重连续传,用户无感知。
- 重连失败耗尽 → 显示"连接中断,点击重试"+ 已收到的部分内容。
- 后端任务已完成但前端断线 → 重连时收到完整 `completed` 快照,直接渲染最终结果。

## 7. 涉及文件清单

### 7.1 新建文件

**后端**:
- `backend/app/shared/services/ai/streaming/__init__.py`
- `backend/app/shared/services/ai/streaming/orchestrator.py` — StreamingOrchestrator
- `backend/app/shared/services/ai/streaming/event_journal.py` — EventJournal
- `backend/app/shared/services/ai/streaming/sse_response.py` — FastAPI StreamingResponse 封装
- `backend/app/shared/services/ai/streaming/types.py` — 事件类型常量、数据模型
- `backend/app/api/routers/ai/stream.py` — 三个 SSE 端点 + cancel 端点

**前端**:
- `frontend/src/core/services/sseClient.ts` — 统一 SSE 客户端
- `frontend/src/composables/useStreamingMessage.ts` — 流式状态机
- `frontend/src/components/ai/ToolTrailCard.vue` — 工具轨迹折叠卡组件

### 7.2 修改文件

**后端(改造)**:
- `backend/app/shared/services/llm/providers/base.py` — 新增 `StreamChunk` 类型
- `backend/app/shared/services/llm/providers/openai.py` — `chat_stream` 补齐 tools + tool_calls
- `backend/app/shared/services/llm/providers/ollama.py` — `chat_stream` 补齐 tool_calls
- `backend/app/shared/services/ai/agent/executor.py` — chat→chat_stream,加回调,取消检查点
- `backend/app/shared/services/ai/agent/types.py` — AgentResult 加 cancelled 字段
- `backend/app/shared/services/ai/chat_agent_runner.py` — 暴露回调配置入口
- `backend/app/api/routers/ai/router.py` — 注册 stream 路由

**前端(改造)**:
- `frontend/src/stores/aiChatStore.ts` — sendMessage 改 SSE,接入 useStreamingMessage
- `frontend/src/features/ai-config-generator/composables/useGenerationJob.ts` — 轮询→SSE
- `frontend/src/features/ai-config-generator/composables/useMigrationJob.ts` — 轮询→SSE
- `frontend/src/components/ai/AIChatPanel.vue` — 流式区+折叠卡+取消按钮
- `frontend/src/features/ai-config-generator/components/preview-panel/PreviewPanel.vue` — 进度区接流式
- `frontend/src/features/ai-config-generator/components/migrate-panel/MigratePanel.vue` — 进度区接流式
- `frontend/src/core/services/httpClient.ts` — 移除/放宽 chat 请求的 timeout(不再需要)

### 7.3 废弃(保留不删)

- `backend/app/api/routers/ai/jobs.py` 的 `/jobs/{id}/status` GET 轮询端点 — 降级/调试用
- `frontend/src/components/common/AIChatDrawer.vue` — 已禁用,本设计不恢复

## 8. 测试策略

遵循项目 E2E-first 策略 + 后端 pytest。

### 8.1 后端单测(pytest)

- `providers/openai.py` `chat_stream`:mock OpenAI SDK 流式响应,验证 tool_calls 分片累积正确性(多分片、跨 chunk、finish_reason 判定)。
- `providers/ollama.py` `chat_stream`:mock aiohttp 流,验证 tool_calls 提取。
- `event_journal.py`:追加/读取/续传(从指定 id)/清理/并发追加安全性。
- `executor.py` 流式改造:mock provider 返回预设 StreamChunk 序列,验证 on_chunk 回调触发、取消检查点中断、终止判定。

### 8.2 前端单测(vitest,纯逻辑)

- `sseClient.ts`:mock fetch ReadableStream,验证事件解析、重连(带 Last-Event-ID)、去重、取消。
- `useStreamingMessage.ts`:喂入事件序列,验证状态机转换(content 累积、toolSteps 更新、completed 覆盖兜底)。

### 8.3 E2E(Playwright)

- 聊天流式:发消息 → 验证 delta 逐字出现 + 工具轨迹折叠卡显示 + 取消按钮可点。
- 配置生成流式:选文件生成 → 验证 progress 事件 + 最终结果展示。
- 取消:发消息后立即取消 → 验证软取消行为(轨迹显示已执行步数)。
- 续传:模拟断线重连(拦截 fetch 中断)→ 验证从断点续传。

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| OpenAI 流式 tool_calls 分片拼接复杂,边界 case 多 | 用单测覆盖多分片/跨 chunk/无 finish_reason 等场景;参考 OpenAI 官方流式 tool_calls 处理模式 |
| SSE 长连接占用后端资源 | 任务结束立即关闭;EventJournal 24h 清理;_cancel_events 及时移除已完成项 |
| 续传时 event_id 不连续(如 journal 丢失) | 续传从 `Last-Event-ID+1` 开始,若该 id 不存在则从头回放(完整快照兜底) |
| 三处场景改动面大,回归风险 | 分阶段实施:先后端内核+单测 → 再聊天接入 → 再生成/迁移接入。每阶段可独立验证 |
| AgentExecutor 流式化可能影响现有 generation agent | generation agent 也走 AgentExecutor,改造后同步受益(流式生成);保持非流式回退路径 |

## 10. 实施顺序建议

1. **阶段 A — 后端内核**:StreamChunk → Provider chat_stream 改造 → AgentExecutor 流式化 → StreamingOrchestrator + EventJournal → SSE 路由。配套单测。
2. **阶段 B — 前端聊天**:sseClient → useStreamingMessage → AIChatPanel 增强(流式区+折叠卡+取消)。E2E 聊天流式用例。
3. **阶段 C — 前端生成/迁移**:useGenerationJob / useMigrationJob 接 SSE。E2E 用例。
4. **阶段 D — 清理**:移除前端 timeout 特例、废弃轮询 composable 代码、文档更新。

每阶段完成后可独立提交、独立验证。
