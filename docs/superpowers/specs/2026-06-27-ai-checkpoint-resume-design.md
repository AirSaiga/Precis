# AgentExecutor Checkpoint 续跑设计

> **日期**: 2026-06-27
> **功能代号**: C（checkpoint 续跑）
> **范围**: AgentExecutor 中间状态持久化,失败/重连后从最近 checkpoint 恢复,避免从头重跑
> **状态**: 待实施
> **关键定位**: C 是 A/B/D 三个并行功能中**唯一需要先于其他落地**的(A 依赖 C 的状态恢复机制)

---

## 1. 背景与目标

### 1.1 问题陈述

AgentExecutor 已有 `checkpoint_callback`/`initial_checkpoint` 参数和 `_make_checkpoint`(`executor.py:287-309`),但:

1. **checkpoint 只产不存**:`run()` 每次都 `AgentMemory(...)` 新建(`executor.py:125-126`),**从不读** `initial_checkpoint` 恢复 memory。
2. **memory.create_checkpoint 不完整**(`memory.py:119-125`):只返回 summary 计数(message_count/turn_count),**不返回 messages**,无法恢复。
3. **AgentJobStorage 有完整存取但无人调用**(`job_storage.py:117-158` 的 save_checkpoint/load_latest_checkpoint,带 _MAX_CHECKPOINTS_PER_JOB=10 滚动保留):jobs.py 只用它存 status,不存 agent checkpoint。

结果:长任务(LLM 慢/分块多轮)失败后只能从头重跑,token/时间浪费。

### 1.2 目标

1. `AgentMemory` 支持完整序列化(messages/turns)与恢复(restore_from_checkpoint)。
2. `AgentExecutor.run()` 开头:若有 `initial_checkpoint` 则重建 memory(恢复 turn/messages),而非新建。
3. 接通 `AgentJobStorage.save_checkpoint/load_latest_checkpoint`,checkpoint_callback 真正落盘。
4. 新增续跑端点 `POST /ai/jobs/{job_id}/resume`,用最近 checkpoint 重启 executor。

### 1.3 非目标

- 不用 EventJournal 做 checkpoint(它是 SSE 事件流,粒度太细,反向重建 memory 代价高易错)。复用现成的 AgentJobStorage。
- 不持久化 LLM 流式中间 token(只存结构化 memory 状态)。
- 不改 generation agent 的 plan/chunk 逻辑。

---

## 2. 现状分析

- `executor.py:60-101`:__init__ 已有 checkpoint_callback 参数。`:110-113`:run 签名已有 initial_checkpoint 形参(但未使用)。
- `executor.py:125-126`:`self._memory = AgentMemory(...)` 无条件新建。`:201-203`+`:221-222`:每轮调 checkpoint_callback 但传的是 `_make_checkpoint` 产物。
- `executor.py:287-309`:`_make_checkpoint` 只存 turn/tool_calls,**不存 messages**。
- `memory.py:44-48`:`_messages` 是核心状态(system+task+assistant/tool 消息)。`:119-125`:create_checkpoint 只返回 {message_count, turn_count}。
- `job_storage.py:117-158`:save_checkpoint(job_id, checkpoint_dict) 按项目路径分片落盘,load_latest_checkpoint 返回最新一条,保留 10 条滚动。
- `jobs.py:120-312`:`_run_job` 创建 executor 时未传 checkpoint_callback 落盘逻辑;从头起跑无续跑分支。

---

## 3. 设计方案

### 3.1 数据流

```
首次运行:
  executor.run(initial_checkpoint=None)
    → 新建 AgentMemory
    → 每轮结束: _make_checkpoint(含完整 messages) → checkpoint_callback → save_checkpoint 落盘
    → 成功: 返回 result

失败/中断后续跑:
  POST /ai/jobs/{job_id}/resume
    → load_latest_checkpoint(job_id) → {turn_index, messages, ...}
    → executor.run(initial_checkpoint=loaded)
    → AgentMemory.restore_from_checkpoint(loaded) 恢复 → 从 turn_index+1 继续
```

### 3.2 checkpoint 数据结构(扩展)

```python
# memory.py: AgentMemory.create_checkpoint 返回值扩展
{
    "turn_count": 2,
    "message_count": 8,
    "messages": [...]  # 完整 OpenAI messages 格式(新增,核心)
    "system_prompt": "...",
    "max_tokens": 120000,
}
```

---

## 4. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `backend/app/shared/services/ai/agent/memory.py` | **核心** | create_checkpoint 返回完整 messages;新增 restore_from_checkpoint(checkpoint) 重建 _messages |
| `backend/app/shared/services/ai/agent/executor.py` | **核心** | run() 开头:若有 initial_checkpoint 则 _memory=AgentMemory.restore_from_checkpoint 而非新建;_make_checkpoint 含 messages |
| `backend/app/api/routers/ai/jobs.py` | **改** | _run_job 传 checkpoint_callback(调 storage.save_checkpoint);新增 /resume 端点(load_latest_checkpoint + 重启 executor) |
| `backend/app/api/routers/ai/migrate.py` | **改** | 同 jobs.py(_run_migrate_job 同构:加 checkpoint_callback + migrate resume) |
| 后端单测: test_memory_checkpoint.py / test_executor_resume.py / test_job_resume.py | **新增** | 见第 7 章 |

**不改的文件**:
- `streaming/event_journal.py` / `orchestrator.py`:checkpoint 用 AgentJobStorage,不用 journal。
- `job_storage.py`:已有完整 save/load,直接用。

---

## 5. 后端设计

### 5.1 memory 序列化/恢复(memory.py)

```python
class AgentMemory:
    # ... 现有 ...

    def create_checkpoint(self) -> dict[str, Any]:
        """完整序列化(含 messages),支持跨进程恢复。"""
        return {
            "turn_count": self._turn_count,
            "message_count": len(self._messages),
            "messages": [dict(m) for m in self._messages],  # OpenAI 格式 dict,可 JSON 序列化
            "system_prompt": self.system_prompt,
            "max_tokens": self.max_tokens,
        }

    @classmethod
    def restore_from_checkpoint(cls, checkpoint: dict[str, Any]) -> "AgentMemory":
        """从 checkpoint 重建 memory 状态。"""
        mem = cls(
            system_prompt=checkpoint.get("system_prompt", ""),
            max_tokens=checkpoint.get("max_tokens", 120000),
        )
        mem._messages = [dict(m) for m in checkpoint.get("messages", [])]
        mem._turn_count = checkpoint.get("turn_count", 0)
        return mem
```

`_messages` 已是 OpenAI messages 格式 dict(含 role/content/tool_calls/tool_call_id),可直接 JSON 序列化往返。

### 5.2 executor run() 续跑分支(executor.py)

```python
async def run(self, task_message: str, initial_checkpoint: dict[str, Any] | None = None):
    # 续跑:从 checkpoint 恢复 memory,而非新建
    if initial_checkpoint and initial_checkpoint.get("messages"):
        self._memory = AgentMemory.restore_from_checkpoint(initial_checkpoint)
        result = AgentResult(success=False, error="")
        # 从 checkpoint 的下一轮继续(turn_count 已恢复)
        start_turn = initial_checkpoint.get("turn_count", 0) + 1
    else:
        self._memory = AgentMemory(system_prompt=self.system_prompt, max_tokens=self.max_tokens)
        self._memory.add_task_message(task_message)
        result = AgentResult(success=False, error="")
        start_turn = 1

    for turn_idx in range(start_turn, self.max_iterations + 1):
        # ... 现有循环 ...
        # 每轮结束存 checkpoint
        if self.checkpoint_callback:
            cp = self._make_checkpoint(turn_idx)  # 现扩展为含 messages
            self.checkpoint_callback(cp)
```

`_make_checkpoint` 改为返回 `self._memory.create_checkpoint()`(含 messages)+ 当前 turn_idx。

### 5.3 jobs.py 接通落盘 + resume 端点

```python
async def _run_job(job_id, payload, config_path, emit=None):
    storage = _get_storage(config_path)
    # 接通 checkpoint 落盘
    def on_checkpoint(cp):
        storage.save_checkpoint(job_id, cp)
    executor 创建时传 checkpoint_callback=on_checkpoint
    # ...

@router.post("/jobs/{job_id}/resume", summary="从最近 checkpoint 续跑任务")
async def resume_job(job_id, config_path = Depends(...)):
    storage = _get_storage(config_path)
    cp = storage.load_latest_checkpoint(job_id)
    if not cp:
        raise HTTPException(404, "无可用 checkpoint")
    # 用 checkpoint 重启 executor(后台 task)
    asyncio.create_task(_run_job_with_checkpoint(job_id, payload, config_path, cp, emit=None))
    return {"status": "resuming", "turn": cp.get("turn_count", 0)}
```

`_run_job_with_checkpoint` 复用 _run_job 逻辑,但 executor.run(initial_checkpoint=cp)。

### 5.4 migrate.py 同构

`_run_migrate_job` 同样加 on_checkpoint + migrate resume 端点。

---

## 6. 并行边界

### 6.1 C 与 A 的关系(关键:C 先 A 后)

A(写入确认)的 diff 暂存 + 协程挂起本质是"任务暂停-恢复"。C 的 memory 序列化/恢复是更通用的底座。

**执行顺序:C 先于 A**。理由:
- C 把 `AgentMemory.restore_from_checkpoint()` 做出来后,A 的"挂起态保存/恢复"可复用该机制,避免 A 自己造一套。
- 若 A 不等 C,A 用 `InMemoryPendingApplyStore`(自带,自洽),但 A 的 orchestrator.run_chat 与 C 的 checkpoint 改动同处一函数,合并时需协调。

### 6.2 C 独占 executor.py

C 是**唯一**需要深度改造 `executor.py` 的功能(D 必须走 provider 包装方案,不碰 executor.py)。这是 C 能先行的关键——executor.py 无并发修改冲突。

### 6.3 C 与 B 的弱接口依赖

B 在 `_optional_refine_via_agent` 构造 AgentExecutor。若 C 给 run() 加了 initial_checkpoint 入参(本设计确实如此),B 的调用处需对照 C 接口。B 调用 `executor.run(task)` 时 `initial_checkpoint` 默认 None 即可(向后兼容)。

### 6.4 C 与 D 无冲突

D 走 provider 包装层,不改 executor/memory,C 独占这两文件。

---

## 7. 测试策略

### 7.1 单测

**test_memory_checkpoint.py**:
- create_checkpoint 返回含 messages(非空)+ 可 JSON 往返(json.dumps/loads 后 restore_from_checkpoint 重建的 _messages 一致)。
- restore_from_checkpoint 后 _messages/_turn_count/max_tokens 正确恢复。
- 空 checkpoint(无 messages)→ restore 后 _messages 为空,不报错。

**test_executor_resume.py**(mock provider):
- 首次 run 2 轮 → checkpoint_callback 被调 2 次,每次含 messages。
- 用第 2 轮 checkpoint 调 run(initial_checkpoint=cp) → 从 turn 3 继续(_messages 含前 2 轮记录),不重复前 2 轮。
- 无 initial_checkpoint → 新建 memory(start_turn=1),行为不变(回归保护)。

**test_job_resume.py**:
- _run_job 的 checkpoint_callback 调 storage.save_checkpoint(用临时 storage 验证落盘)。
- resume 端点:有 checkpoint → 后台重启 executor.run(initial_checkpoint);无 checkpoint → 404。

### 7.2 集成

长任务场景(多轮 tool_call)→ 模拟中途失败 → resume → 验证从断点继续而非重跑(LLM 调用次数 = 总轮数 - 已完成轮数)。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| checkpoint messages 体积大占内存/磁盘 | AgentJobStorage 已有 _MAX_CHECKPOINTS_PER_JOB=10 滚动保留;messages 是 OpenAI 格式 dict,通常 KB 级 |
| 恢复后 memory 与 executor 状态不一致 | restore_from_checkpoint 严格重建 _messages/_turn_count;run() 用 turn_count+1 作 start_turn |
| checkpoint_callback 抛异常中断任务 | on_checkpoint 内 try/except,落盘失败仅 warning,不中断 run() |
| 续跑时 provider/context 变化(如配置改了) | resume 端点重新加载 provider 与 project_path,与首次一致;checkpoint 只含 memory 不含外部状态 |
| 与 A 合并冲突(executor.py) | C 独占 executor.py;A 不改 executor(挂起在工具协程内,对 executor 透明) |

---

## 附录:实施顺序

1. memory.py:create_checkpoint 含 messages + restore_from_checkpoint + 单测
2. executor.py:run() 续跑分支 + _make_checkpoint 扩展 + 单测(回归保护)
3. jobs.py:on_checkpoint 接通落盘 + /resume 端点 + 单测
4. migrate.py:同构改造
5. 集成测试(长任务断点续跑)
6. **落地后通知 A**:A 可复用 restore_from_checkpoint 做 diff 暂存恢复
