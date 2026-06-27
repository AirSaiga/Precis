# AI apply_actions 两阶段确认(写前 diff 审批)设计

> **日期**: 2026-06-27
> **功能代号**: A（apply_actions 写入确认）
> **范围**: AI Chat 的 `apply_actions` 工具由"直接写文件"改为"先产出 diff、用户确认后才落盘"的两阶段流程
> **状态**: 待实施
> **依赖**: `2026-06-27-ai-streaming-p0-design.md`(P0 流式 + SSE + 软取消)已落地

---

## 1. 背景与目标

### 1.1 问题陈述

当前 `apply_actions` 工具在 LLM 决定调用的瞬间**立即、同步写文件**(`apply_actions.py:99-101` 的 `process_actions`)。风险:

1. **LLM 误解即静默破坏**:误解成"删除约束"等会直接落盘,用户毫无察觉。
2. **不可预览**:用户看不到 AI 要改什么,事后才发现。
3. **与软取消语义冲突**:P0 已确立"已落盘改动保留",但用户从未批准过这些改动。
4. **非 agent 路径已有确认、agent 路径没有**:`chat_orchestrator.py:525-536` 有 `confirm_callback`,但 agent 流式路径绕过了它。

### 1.2 目标

1. `apply_actions` 拆两阶段:**生成 diff(不落盘)→ 用户确认 → 落盘**。
2. 新增 dry-run 机制:shadow-copy 配置目录到临时目录跑 `process_actions` 算 diff,不碰真实项目。
3. 新增 SSE 事件 `apply_pending`/`apply_confirmed`/`apply_rejected`(非终止)。
4. 新增确认端点 `POST /ai/chat/{job_id}/confirm`。
5. 前端展示**改动预览卡**(文件 + diff + 确认/拒绝)。
6. 关键语义:**已落盘改动保留语义不变**(确认写入后即使后续取消也保留,与 P0 一致)。

### 1.3 非目标

- 不改 actions 契约(LLM 工具签名不变)。
- 不为只读工具(read_project/read_table/validate_table)加确认。
- 不做部分接受(只全部确认/全部拒绝)。
- 不做跨进程持久化的 diff 暂存(留接口给功能 C 统一,见第 8 章)。

### 1.4 已确认的关键决策

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 确认粒度 | 一次 apply_actions 整体确认/拒绝 | 与备份回滚粒度一致(原子性) |
| 2 | diff 暂存位置 | 进程内内存 store(`InMemoryPendingApplyStore`),留 Protocol 接口 | executor 串行,每 job 至多 1 挂起;持久化留给 C |
| 3 | 暂停/恢复机制 | `asyncio.Event` 确认门 | apply_actions 在协程内 `await gate.wait()`,无轮询 |
| 4 | dry-run 实现 | shadow-copy 配置目录后跑 `process_actions` | YAML KB 级,拷贝可忽略;完全复用落盘逻辑,diff 必然正确 |
| 5 | 取消与确认的关系 | 取消 = 拒绝(resolve gate 为 reject) | 用户取消就是不想继续 |

---

## 2. 现状分析

- `apply_actions.py:99-101`:`run()` 直接 `process_actions` 写盘,无 dry-run 分支。
- `apply_actions.py:109-126`:写盘后累积 `frontendInstructions`,给 LLM 返回摘要(不含 diff)。
- `chat_agent_runner.py:188`:`collected_instructions` 共享容器,`:265-268` 注入 ApplyActionsTool。
- `orchestrator.py:101-180`:run_chat 编排,`:153-163` 软取消分支(partial=True,已落盘保留)。
- `types.py:18-23`:终止事件集合 `TERMINAL_EVENTS`,新事件不进此集合。
- `action_processor.py:43-142`:`_collect_affected_files` 精确算受影响文件(dry-run 拷贝范围金标准);`:172-221` `process_actions` 含备份回滚。
- `chat_orchestrator.py:33-49`+`:525-536`:非 agent 路径已有的 `confirm_callback` Protocol(语义参考,不直接复用)。
- `stream.py:41-42`+`:156-174`:`_cancel_events` 字典 + cancel 端点(确认端点的样板)。
- `useStreamingMessage.ts:115-203`:handleEvent switch,需加 pending 分支并在 started 捕获 jobId。
- `aiChatStore.ts:297-400`:sendMessage + cancelSendMessage,需处理确认流程。

---

## 3. 设计方案:两阶段流程

### 3.1 总体时序

```
前端                      SSE/HTTP                   后端 (orchestrator + executor)
─────                      ────────                   ──────────────────────────────
sendMessage ──────────► POST /ai/chat/stream ─────► 创建 job_id, 后台 task: run_chat
                              ◄── started {job_id}
                              ◄── delta "我将为 email..."
                              ◄── tool_call apply_actions
                                              ApplyActionsTool.run()
                                                ① dry-run: shadow-copy + process_actions(临时目录) → diff
                                                ② 注册 PendingApply 到 store[job_id]
                                                ③ emit(APPLY_PENDING)
                              ◄── apply_pending        ④ await confirm_gate.wait()  ← 协程挂起
[渲染 ApplyConfirmCard]      (SSE 流保持)
用户点「确认」 ─────────► POST /ai/chat/{job_id}/confirm {decision:"confirm"}
                                                   → controller.resolve("confirm"), gate.set()
                                                ⑤ process_actions(actions, 真实路径) ← 落盘
                                                ⑥ emit(APPLY_CONFIRMED)
                              ◄── apply_confirmed      ⑦ 返回 observation 给 LLM
                              ◄── tool_result
                              ◄── delta "已为您添加..."
                              ◄── completed
[画布双写 + 关闭卡片]
```

拒绝:`decision:"reject"` → 跳过写盘 → emit `APPLY_REJECTED` → LLM 回复"未作修改"。
取消:等同 reject(cancel 端点同步 resolve gate 为 reject)。

### 3.2 关键不变量

1. dry-run 永不触碰真实项目(临时目录)。
2. executor 串行 → 每 job 至多 1 挂起,`request_id = job_id`。
3. apply_* 事件非终止,不进 `TERMINAL_EVENTS`。
4. 已落盘改动保留(确认写入后即便取消也保留)。

---

## 4. 涉及文件清单

### 4.1 新建文件

| 文件 | 职责 |
|------|------|
| `backend/app/shared/services/ai/streaming/pending_apply_store.py` | `PendingApplyStore` Protocol + `InMemoryPendingApplyStore` + `ConfirmController`(确认门) |
| `backend/app/shared/services/llm/actions/diff_compute.py` | `compute_action_diff(actions, workspace_path)`:shadow-copy dry-run + unified diff |
| `frontend/src/components/ai/ApplyConfirmCard.vue` | 改动预览卡(文件 + diff + 确认/拒绝按钮) |
| 后端单测: `test_diff_compute.py` / `test_pending_apply_store.py` / `test_apply_actions_two_phase.py` | 见第 7 章 |
| E2E: `tests/e2e/ai_chat_confirm.spec.ts` | 完整确认流程 |

### 4.2 修改文件

| 文件 | 改动性质 |
|------|----------|
| `streaming/types.py` | 加 `EVENT_APPLY_PENDING/CONFIRMED/REJECTED`,**不进** `TERMINAL_EVENTS` |
| `chat_tools/apply_actions.py` | **核心**:`run()` 拆两阶段;注入 controller + 回调 + `dry_run_enabled` 开关;保留 legacy 直写分支 |
| `chat_agent_runner.py` | 注入 `confirm_controller` + apply 回调到 ApplyActionsTool |
| `streaming/orchestrator.py` | run_chat 创建 controller 注册 store;新增 apply 回调桥接 emit;finally 注销 store |
| `routers/ai/stream.py` | 加 `POST /ai/chat/{job_id}/confirm` 端点;cancel 端点同步 resolve(reject) |
| `routers/ai/models.py` | 加 `AiChatConfirmRequest {decision}` |
| `useStreamingMessage.ts` | 加 `pendingApply` 字段 + `jobId`(started 捕获) + apply_* 分支 |
| `stores/aiChatStore.ts` | 加 `confirmApply(decision)`;sendMessage 捕获 jobId;cancel 先 reject 再 close |
| `AIChatPanel.vue` | 渲染 ApplyConfirmCard |
| i18n 文件 | 加确认卡文案 |

### 4.3 不改的文件(明确边界)

- `action_processor.py` / handlers:dry-run 通过 shadow-copy 复用,**不改**。
- `AgentExecutor` 主循环:挂起在工具协程内,对 executor 透明。
- `event_journal.py` / `sse_response.py`:新事件自动被 emit 出口转发。

---

## 5. 后端设计

### 5.1 dry-run diff 机制(diff_compute.py)

shadow-copy 配置目录到临时目录 → `process_actions(actions, 临时目录)` → 对比前后 → unified diff → 清理临时目录。

```python
# backend/app/shared/services/llm/actions/diff_compute.py
from __future__ import annotations
import difflib, logging, os, shutil, tempfile
from dataclasses import dataclass, field
from typing import Any
from app.shared.services.llm.actions.action_processor import _collect_affected_files, process_actions

logger = logging.getLogger(__name__)

@dataclass
class FileDiff:
    path: str; status: str  # modified|created|deleted
    diff: str; before_preview: str = ""; after_preview: str = ""

@dataclass
class DiffResult:
    files: list[FileDiff] = field(default_factory=list)
    summary: dict[str, int] = field(default_factory=lambda: {"modified":0,"created":0,"deleted":0})
    frontend_instructions: list[Any] = field(default_factory=list)
    success: bool = True
    error: str | None = None

def compute_action_diff(actions: list[dict[str, Any]], workspace_path: str) -> DiffResult:
    result = DiffResult()
    affected = _collect_affected_files(actions, workspace_path)
    workspace_abs = os.path.abspath(workspace_path)
    before_contents: dict[str, str | None] = {}
    rel_paths: list[str] = []
    for abs_p in affected:
        rel = os.path.relpath(abs_p, workspace_abs)
        rel_paths.append(rel)
        try:
            with open(abs_p, encoding="utf-8") as f:
                before_contents[rel] = f.read()
        except FileNotFoundError:
            before_contents[rel] = None
        except OSError:
            before_contents[rel] = ""
    tmp_root = tempfile.mkdtemp(prefix="precis_dryrun_")
    try:
        _shadow_copy(workspace_path, tmp_root)
        proc = process_actions(actions, tmp_root)
        if not proc.get("success"):
            result.success = False
            msgs = [r.get("message","") for r in proc.get("results",[]) if not r.get("success")]
            result.error = "; ".join(msgs)
            return result
        for rel in rel_paths:
            tmp_p = os.path.join(tmp_root, rel)
            try:
                with open(tmp_p, encoding="utf-8") as f:
                    after = f.read()
            except FileNotFoundError:
                after = None
            before = before_contents.get(rel)
            result.files.append(_build_file_diff(rel, before, after))
        for fd in result.files:
            result.summary[fd.status] = result.summary.get(fd.status, 0) + 1
        for r in proc.get("results", []):
            fi = r.get("frontendInstructions")
            if fi: result.frontend_instructions.append(fi)
        return result
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

def _shadow_copy(src_workspace: str, dst: str) -> None:
    ignore = shutil.ignore_patterns(".precis", "__pycache__")
    for entry in os.listdir(src_workspace):
        s = os.path.join(src_workspace, entry); d = os.path.join(dst, entry)
        if os.path.isdir(s): shutil.copytree(s, d, ignore=ignore)
        else: shutil.copy2(s, d)

def _build_file_diff(rel: str, before: str | None, after: str | None) -> FileDiff:
    if before is None and after is not None:
        return FileDiff(rel, "created", f"--- /dev/null\n+++ {rel}\n{after}", after_preview=after[:500])
    if after is None and before is not None:
        return FileDiff(rel, "deleted", f"--- {rel}\n+++ /dev/null\n", before_preview=before[:500])
    diff = "".join(difflib.unified_diff(
        (before or "").splitlines(keepends=True), (after or "").splitlines(keepends=True),
        fromfile=f"a/{rel}", tofile=f"b/{rel}"))
    return FileDiff(rel, "modified", diff or "(无文本差异)", before_preview=(before or "")[:500], after_preview=(after or "")[:500])
```

**要点**:`_collect_affected_files` 复用保证 dry-run 范围=真实落盘范围;`FileDiff.path` 用相对路径(不泄漏绝对路径);`finally` 清理临时目录。

### 5.2 新事件类型(types.py)

```python
EVENT_APPLY_PENDING = "apply_pending"      # 非 terminating
EVENT_APPLY_CONFIRMED = "apply_confirmed"  # 非 terminating
EVENT_APPLY_REJECTED = "apply_rejected"    # 非 terminating
# 不加入 TERMINAL_EVENTS
```

### 5.3 确认控制器与 pending store(pending_apply_store.py)

```python
# backend/app/shared/services/ai/streaming/pending_apply_store.py
from __future__ import annotations
import asyncio, threading
from typing import Any, Protocol

class ConfirmController:
    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None):
        self.request_id = request_id
        self.pending_payload = pending_payload
        self._gate = asyncio.Event()
        self._decision: str | None = None
    async def await_decision(self) -> str:
        await self._gate.wait()
        return self._decision or "reject"
    def resolve(self, decision: str) -> None:
        if self._gate.is_set(): return  # 幂等
        self._decision = decision
        self._gate.set()
    @property
    def is_resolved(self) -> bool:
        return self._gate.is_set()

class PendingApplyStore(Protocol):
    def put(self, job_id: str, controller: ConfirmController) -> None: ...
    def get(self, job_id: str) -> ConfirmController | None: ...
    def pop(self, job_id: str) -> ConfirmController | None: ...

class InMemoryPendingApplyStore:
    def __init__(self) -> None:
        self._store: dict[str, ConfirmController] = {}
        self._lock = threading.Lock()
    def put(self, job_id, controller):
        with self._lock: self._store[job_id] = controller
    def get(self, job_id):
        with self._lock: return self._store.get(job_id)
    def pop(self, job_id):
        with self._lock: return self._store.pop(job_id, None)

_global_store: PendingApplyStore = InMemoryPendingApplyStore()
def get_global_pending_store() -> PendingApplyStore:
    return _global_store
```

**并行边界接口**:功能 C 只需实现 `PersistentPendingApplyStore` 替换 `_global_store`,A 代码无需改(见第 8 章)。

### 5.4 apply_actions 两阶段改造(apply_actions.py)

`run()` 流程:legacy 模式(dry_run_enabled=False/无 controller)→ 直接写盘;否则 → dry-run 算 diff → 暂存 + 发 apply_pending → `await controller.await_decision()` → confirm 则真实写盘 + 发 confirmed,reject/cancel 则不写 + 发 rejected。

- 挂起发生在 `await controller.await_decision()`,executor 透明等待 `execute_many` 返回。
- `_summarize` 抽自原 run 逻辑(收集 frontend_instructions + LLM 摘要)。
- 关键:cancel/异常时 controller 兜底 resolve("reject")(见 5.6)。

### 5.5 runner 注入(chat_agent_runner.py)

`__init__` 增参 `confirm_controller` + `apply_callbacks`;`_create_registry` 传给 ApplyActionsTool。

### 5.6 orchestrator 桥接(orchestrator.py)

run_chat 创建 `ConfirmController(request_id=self.job_id)` → `get_global_pending_store().put` → 新增 on_apply_pending/confirmed/rejected 回调 emit 事件 → `finally` 里 `pending_store.pop` + 兜底 `resolve("reject")`(防协程泄漏)。

### 5.7 确认端点(stream.py)

```python
@router.post("/chat/{job_id}/confirm", summary="确认/拒绝挂起的 apply_actions 改动")
async def confirm_apply(job_id: str, request: AiChatConfirmRequest):
    controller = _pending_store.get(job_id)
    if controller is None:
        raise HTTPException(404, detail="无挂起的改动(可能已决策或任务已结束)")
    if controller.is_resolved:
        return {"status": "already_resolved", "decision": controller._decision}
    controller.resolve(request.decision)
    return {"status": "resolved", "decision": request.decision}
```

cancel 端点同步改造:`ev.set()` 后 `_pending_store.get(job_id)` 若未 resolve 则 `resolve("reject")`。

### 5.8 请求模型(models.py)

```python
class AiChatConfirmRequest(BaseModel):
    decision: str = Field(..., description="confirm(确认并落盘)或 reject(拒绝,不落盘)")
```

---

## 6. 前端设计

### 6.1 状态机(useStreamingMessage.ts)

`StreamingMessage` 增 `jobId: string` + `pendingApply: PendingApply | null`。`started` 分支捕获 jobId;新增 `apply_pending/confirmed/rejected` 分支(confirmed/rejected 清空 pendingApply)。

### 6.2 确认卡(ApplyConfirmCard.vue)

形态参照 ToolTrailCard(折叠卡),展示文件列表 + unified diff(pre) + 确认/拒绝按钮。props: `apply: PendingApply`, `onDecide: (decision) => Promise<void>`。

### 6.3 store(aiChatStore.ts)

- `confirmApply(decision)`:`httpClient.post(/ai/chat/${jobId}/confirm, {decision})`。
- `sendMessage`:onEvent 里 `event==='started'` 捕获 jobId 到 `currentStreamingJobId`。
- `cancelSendMessage`:先 `confirm(reject)` 再 close(避免协程挂起)。

### 6.4 panel(AIChatPanel.vue)

ToolTrailCard 之后插入 ApplyConfirmCard,`v-if="msg.streaming?.pendingApply"`。

---

## 7. 测试策略

### 7.1 后端单测

| 测试 | 关键用例 |
|------|----------|
| `test_diff_compute.py` | ① dry-run 不落盘(hash 校验真实文件前后一致);② diff 正确性(ADD_CONSTRAINT → created/modified);③ 失败透传(非法 spec);④ 临时目录清理 |
| `test_pending_apply_store.py` | ① put/get/pop;② ConfirmController resolve 幂等 + await_decision;③ lock 并发安全 |
| `test_apply_actions_two_phase.py` | ① confirm→写盘+frontend_instructions;② reject→不写+skipped:true;③ cancel=reject;④ legacy 分支 |
| `test_orchestrator_two_phase.py` | mock runner:apply_* 事件 emit + 不进 TERMINAL_EVENTS + finally 清理 store + 异常兜底 reject |

### 7.2 E2E

`ai_chat_confirm.spec.ts`:完整确认流(拦截 LLM→apply_actions→确认卡→点确认→文件已改);拒绝流(不写);取消流(不写);断线续传(pending 卡片仍显示)。

---

## 8. 并行边界(与功能 C:checkpoint 续跑)

### 8.1 共享资源

A 与 C 都改 `orchestrator.py` 的 `run_chat`。A 改函数开头(创建 controller)+ finally(清理);C 改 runner.run 前后(memory 快照)。空间分离。

### 8.2 执行顺序

**C 先于 A**。C 的 memory 序列化/恢复是更通用的"暂停-恢复"底座,A 可复用。

### 8.3 C 未完成时 A 先实施

A 自带 `InMemoryPendingApplyStore` 完全自洽。留接口 `get_global_pending_store()` 给 C:C 落地 `PersistentPendingApplyStore` 后替换 `_global_store` 单例,A 的 orchestrator/stream.py 无需改(都通过 `get_global_pending_store()` 取)。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 挂起协程泄漏(用户不决策) | orchestrator finally 兜底 reject + cancel 端点同步 resolve + 确认卡常驻引导 |
| dry-run 与真实落盘不一致 | 复用同一份 process_actions,仅 workspace 不同;单测断言产物一致 |
| shadow-copy 大目录耗时 | YAML KB 级可忽略;ignore_patterns 跳过 .precis |
| SSE 长时无事件被代理断开 | 复用 sse_response 心跳(:keep-alive 每 15s) |
| 重复/并发确认 | ConfirmController.resolve 幂等;端点对已 resolve 返回 already_resolved |

---

## 附录:实施顺序

① diff_compute.py + 单测 → ② pending_apply_store.py + 单测 → ③ apply_actions.py 两阶段 + 单测(legacy 保底) → ④ types.py + orchestrator 桥接 → ⑤ stream.py 端点 + models.py → ⑥ 前端状态机 + store → ⑦ ApplyConfirmCard.vue + panel → ⑧ E2E。
