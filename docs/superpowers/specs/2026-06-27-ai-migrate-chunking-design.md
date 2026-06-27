# 脚本迁移按源分片(Chunking by Source)设计

> **日期**: 2026-06-27
> **功能代号**: B（迁移按源分片）
> **范围**: 大量脚本/表时按源(source)分片,多次生成后合并,避免单次全量 token 超限/质量下降
> **状态**: 待实施
> **并行性**: 与 A/C/D **零文件冲突**,可完全并行

---

## 1. 背景与目标

### 1.1 问题陈述

迁移服务 `migrate_from_script` 把**所有来源意图塞进单条 task message**,单次 AgentExecutor 生成(`migrate_service.py:169-183` + `:182` 的 `_build_migrate_task_message` 拼全量)。问题:

1. **Token 超限**:全量意图+画像+prompt 超 context_window,导致截断/报错/质量塌陷。
2. **质量下降**:模型一条消息综合大量异构意图,易遗漏规则、混淆表列归属、产生冲突约束。
3. **进度无细分**:所有解析挤在 0-0.4 区间,生成阶段对多源无细分。

### 1.2 目标

- 引入**按源分片**策略:来源分组 → 每分片独立生成 → 合并去重。
- 复用父类 `ConfigGenerationService` 已注册的 `merge_results` 工具(已可用,见 `merge_results.py:44-121`)。
- 进度回调体现"分片 N/M → 合并 → 校验 → 精修"。

### 1.3 关键技术约束

`generate_config` 是**终态工具**(`executor.py:35` FINAL_OUTPUT_TOOL + `config_generate.py:114` is_final_config)。单次 AgentExecutor.run() 内**首次** generate_config 即终止。因此"按源多次生成"**不能**靠单 Agent 多次调用,必须由**服务层编排循环**。

### 1.4 关键发现

父类 `_create_agent_registry`(`service.py:416-483`)已注册 plan_chunks + merge_results,system prompt(`:501`)已含分块指引。迁移子类重写 registry(`migrate_service.py:220-260`)绕过了它们。核心工作是**接入 + 适配按源维度**。

---

## 2. 现状分析

- `migrate_service.py:92-114`:来源归一化(去重)。`:134-160`:逐来源解析意图(本身已是逐源,非瓶颈)。
- `migrate_service.py:169-183`:构造单 AgentExecutor,`:182` 把全量意图拼进一条 task message。**这是 token/质量问题根源**。
- `service.py:556-610`:`_generate_config_for_scope` 是 generate_config 工具内核,可绕过终态工具直接调用。
- `merge_results.py:44-121`:合并工具,schemas 按列 name 去重、constraints 按 (table_id,column_id,type) 去重、regex 按 pattern 去重。**与来源解耦,可直接复用**。
- `planner.py:18-78`:现有 build_chunk_plan 按"文件/列"分,无 source 维度。
- `migrate.py:174-186`:progress_callback 已透传 extra 字段到 SSE,新增 chunk 字段无需改路由签名。

---

## 3. 设计方案

### 3.1 架构:服务编排循环(非单 Agent 多调)

```
migrate_from_script
  ├─ 1. 来源归一化(复用) → migrate_sources
  ├─ 2. 逐来源解析意图(复用) → parsed_intents
  ├─ 3. 按源分片: build_source_chunk_plan(parsed_intents) → source_chunks
  ├─ 4. for 每分片 i in 1..M:
  │      partial[i] = _generate_for_chunk(source_chunks[i])  # 复用 _generate_config_for_scope
  │      progress("chunk_generate", ..., {chunk_index:i, chunk_total:M})
  ├─ 5. merged = MergeResultsTool.run({"configs": partial_configs})
  ├─ 6. 多分片时 _optional_refine_via_agent(校验+精修兜底)
  └─ 7. 返回 merged
```

### 3.2 source-based 分块策略

少来源(≤阈值 + token ≤ 预算)→ `single` 退化为现有行为(零回归);否则按"来源数 + token 预算"双约束贪心分组。

---

## 4. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `backend/app/shared/services/ai/agent/planner.py` | **新增** | `SourceChunk`/`SourceChunkPlan`/`build_source_chunk_plan`/`source_plan_to_dict`;**不改**现有 build_chunk_plan/Chunk |
| `backend/app/shared/services/ai/migrate_service.py` | **核心改造** | migrate_from_script 改分片循环;_create_migrate_registry 接入 merge_results(+plan_chunks);_build_migrate_system_prompt 补分块指引;新增 _generate_for_chunk/_build_chunk_task_instructions/_optional_refine_via_agent |
| `backend/app/api/routers/ai/migrate.py` | **最小(仅验证)** | extra 透传新增 chunk_index/chunk_total,**不改路由签名/模型** |
| `service.py` | **不改** | 仅复用 _generate_config_for_scope |

**测试新增**:`test_source_planner.py` / `test_merge_results.py`(补充) / `test_migrate_service_chunking.py` / `test_migrate_multi_source_integration.py`

---

## 5. 后端设计

### 5.1 source-based 分块(planner.py 末尾新增)

```python
# ===== 按源(source)分块（迁移专用，不影响 generation 主路径）=====

@dataclass
class SourceChunk:
    chunk_id: str
    source_names: list[str] = field(default_factory=list)
    source_indices: list[int] = field(default_factory=list)  # 指向 parsed_intents 原始列表
    reason: str = ""

@dataclass
class SourceChunkPlan:
    chunks: list[SourceChunk] = field(default_factory=list)
    strategy: str = ""   # single | by_source
    reason: str = ""

def _estimate_intent_tokens(intent_text: str) -> int:
    return max(1, len(intent_text or "") // 3)  # 保守上界

def build_source_chunk_plan(parsed_intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000) -> SourceChunkPlan:
    n = len(parsed_intents)
    if n == 0:
        return SourceChunkPlan(chunks=[], strategy="single", reason="无来源")
    total_tokens = sum(_estimate_intent_tokens(it.get("intent","")) for it in parsed_intents)
    if n <= max_sources_per_chunk and total_tokens <= max_tokens_per_chunk:
        return SourceChunkPlan(
            chunks=[SourceChunk("source_single",
                [it.get("name","") for it in parsed_intents], list(range(n)),
                f"来源数 {n}、估算 {total_tokens} token，单次处理")],
            strategy="single", reason=f"共 {n} 个来源，单次处理")
    chunks, current, current_tokens = [], SourceChunk("source_chunk_1"), 0
    for idx, it in enumerate(parsed_intents):
        it_tokens = _estimate_intent_tokens(it.get("intent",""))
        over_sources = len(current.source_indices) >= max_sources_per_chunk
        over_tokens = current_tokens + it_tokens > max_tokens_per_chunk and current.source_indices
        if over_sources or over_tokens:
            current.reason = f"分片含 {len(current.source_indices)} 个来源，约 {current_tokens} token"
            chunks.append(current)
            current = SourceChunk(f"source_chunk_{len(chunks)+1}")
            current_tokens = 0
        current.source_indices.append(idx)
        current.source_names.append(it.get("name", f"source_{idx+1}"))
        current_tokens += it_tokens
    if current.source_indices:
        current.reason = f"分片含 {len(current.source_indices)} 个来源，约 {current_tokens} token"
        chunks.append(current)
    return SourceChunkPlan(chunks, "by_source",
        f"共 {n} 个来源、约 {total_tokens} token，按源拆分为 {len(chunks)} 个分片")

def source_plan_to_dict(plan): ...  # 序列化为 dict
```

### 5.2 migrate_from_script 循环改造

替换 `migrate_service.py:169-218` 的单次 Agent 执行为分片循环:

| 阶段 | stage | 进度区间 | extra |
|---|---|---|---|
| 解析 | parse_script | 0–0.30 | current_source |
| 分片规划 | source_planning | 0.30–0.35 | chunk_total |
| 分片生成 | chunk_generate | 0.35–0.80 | chunk_index, chunk_total |
| 合并 | merge_results | 0.80–0.85 | merged_chunks |
| 精修 | refine_config | 0.85–0.95 | metrics |

```python
# 核心循环(示意)
from app.shared.services.ai.agent.planner import build_source_chunk_plan
source_plan = build_source_chunk_plan(parsed_intents, self._chunk_max_sources, self._chunk_max_tokens)
chunk_total = len(source_plan.chunks)
partial_configs = []
for ci, chunk in enumerate(source_plan.chunks):
    if self._cancelled: raise CancelledError()
    if progress_callback:
        progress_callback("chunk_generate", 0.35 + (ci/max(chunk_total,1))*0.45,
            {"iterations": len(partial_configs), "chunk_index": ci+1, "chunk_total": chunk_total})
    instructions = self._build_chunk_task_instructions(chunk_intents, chunk_total, ci+1)
    partial = await self._generate_for_chunk(instructions, previous_config=None)
    if partial.get("schemas") or partial.get("constraints"): partial_configs.append(partial)
# 合并
merge_tool = MergeResultsTool()
merge_result = merge_tool.run({"configs": partial_configs})
config = merge_result.get("config", {})
if chunk_total > 1:
    config = await self._optional_refine_via_agent(config, registry, merge_warnings, ...)
```

`_generate_for_chunk` 复用父类 `_generate_config_for_scope`(scope 传全量 file_paths 保证跨表上下文可见,意图已限定来源)。
`migrate_from_script` 新增参数(默认值向后兼容):`chunk_max_sources=5`, `chunk_max_tokens=8000`, `enable_chunking=True`。

### 5.3 registry 接入(保持工具集一致)

`_create_migrate_registry` 参照父类 `service.py:434-453` 追加注册 `MergeResultsTool`(无状态直接实例化)+ `PlanChunksTool`(注入画像)。从 4 工具扩为 6 工具。

### 5.4 system prompt 补充

`_build_migrate_system_prompt` 参照父类 `:501` 补分块流程指引(多来源已分片生成+合并,Agent 职责是校验精修)。

---

## 6. 测试策略

### 6.1 单测

**test_source_planner.py**:single 退化(少源)/by_source 按数分组(N=12,阈值5→3片)/按 token 分组(超长 intent 独占)/空输入/序列化往返。
**test_merge_results.py(补充)**:两分片同表不同列→列齐全去重;同约束→conflicts;同 regex→去重;空列表。
**test_migrate_service_chunking.py(mock provider)**:多源→_generate_config_for_scope 调 M 次 + merge 调 1 次;少源→single 零回归;进度回调单调递增含 chunk 字段;取消中途抛 CancelledError。

### 6.2 集成

**test_migrate_multi_source_integration.py**:3 个 Python 来源(不同表/列)+ mock provider → 端到端 result.success=True,覆盖 3 源无重复;SSE progress 出现 chunk_index/chunk_total。

### 6.3 回归保护

现有迁移单测/集测全过(重点 single 路径=原行为);generation 主路径不受影响(未改 service.py 主路径)。

---

## 7. 并行边界

### 7.1 零文件冲突

| 文件 | A | B | C | D |
|---|---|---|---|---|
| migrate_service.py | – | **改** | – | – |
| planner.py(新增) | – | **改** | – | – |
| migrate.py | – | **改(最小)** | – | – |
| executor.py | – | – | **改** | – |
| provider 层 | – | – | – | **改** |

B 只动 migrate 路径,**完全可并行**。

### 7.2 唯一弱接口依赖:B ↔ C(executor checkpoint 接口)

B 在 `_optional_refine_via_agent` 构造 AgentExecutor。若 C 改了 executor 的 checkpoint 接口(如 run() 加 initial_checkpoint 入参),B 的构造/调用处需同步。**接口依赖非文件冲突**:B 不改 executor.py,只是调用方。B 实施以当前签名为基线;若 C 先合并,B 对照 C 接口调整调用处。

### 7.3 与 A/D 关系

- A(写入确认):A 改配置写盘前确认,B 产出是内存 config dict 交给路由,无交集。
- D(LLM 缓存):D 改 provider.chat 缓存,B 经 _generate_config_for_scope 间接调 provider,自动受益,无需适配。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| R1 终态工具约束误用 | 已采用服务编排循环(直接调 _generate_config_for_scope),不在单 Agent 内多次调 generate_config |
| R2 分片间规则重复/冲突 | 复用 MergeResultsTool 去重 + 多分片触发 _optional_refine_via_agent 兜底精修 |
| R3 跨表约束(外键)被拆分片 | _generate_for_chunk 的 scope 传全量 file_paths+全画像,跨表上下文可见,分片只限定意图来源不限画像 |
| R4 token 估算不准 | 双约束 + 单分片失败不阻断(_generate_for_chunk 捕获异常返回 {}) |
| R5 进度契约不符 | stage 名沿用现有,新增 chunk_generate 等为新增 stage;progress 严格单调 |
| R6 C 改 executor 接口后 B 失配 | 接口依赖,CI 在 C 合并后跑 B 测试可立即暴露 |
| R7 单源回归 | single 策略零回归 + enable_chunking 开关 + 单测断言少源走原路径 |

---

## 附录:实施顺序

1. planner.py 新增 source 分块 + 单测
2. migrate_service.py:registry 接入 + system prompt
3. migrate_service.py:分片循环改造 + 辅助方法 + 单测
4. migrate.py:确认 extra 透传(预期零代码改动)
5. 集成测试
6. 对照 C 的 executor 接口最终签名校正调用处
