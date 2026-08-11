# C02-nav-chunked-loader — 分块加载阈值与跨块缺陷

| 项 | 值 |
|----|-----|
| ID | C02 |
| 维度 | nav（代码库导航与理解） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12 + pandas |

## 背景

本 `workspace/` 是 Precis 分块文件加载（chunked file loader）的精简缩影，两个文件：

- `workspace/memory_monitor.py` —— 决定大文件是否分块加载。AGENTS.md 明确：
  > "后端校验引擎采用两阶段流水线……大文件支持分块加载（>500MB 阈值）"
- `workspace/chunked_checker.py` —— 分块后的唯一性检查器，包含一个**文档化的已知缺陷**：
  per-chunk 校验导致跨块重复漏检（"Unique 假阴性"）。

真实代码定位：

- `backend/app/shared/services/validation/memory_monitor.py:29` — `DEFAULT_CHUNK_THRESHOLD_MB = 500`
- `memory_monitor.py:98-111` — `should_chunk()` 依据 `size_mb > self.chunk_threshold_mb` 决策
- `backend/app/shared/services/validation/executor.py:856` — "Unique 假阴性" 缺陷注释
- `backend/app/shared/services/validation/engine.py:107, 278` — 同类跨块缺陷

这是 **nav（导航理解）任务**：你必须先**读懂**这两个文件，再回答两个理解题并做一处小修复。

**先读 `workspace/memory_monitor.py`**，理解：

- `DEFAULT_CHUNK_THRESHOLD_MB` 常量值（Q1 答案）
- `MemoryMonitor` 类上**哪个方法**决定是否分块（Q2 答案）

**再读 `workspace/chunked_checker.py`**，理解：

- `find_duplicates_in_chunk` —— 在单个 chunk 内用 `duplicated(keep=False)` 找重复
- `find_cross_chunk_duplicates` —— 当前只是把上面那个 per-chunk 结果汇总，**跨块重复看不到**

## 任务

### 1. 回答两道理解题

新建 `workspace/answers.py`，**仅作为注释**写两行答案（格式严格如下，verify 用正则匹配）：

```python
# C02 理解题答案
# Q1: <数字>
# Q2: <方法名>
```

- **Q1**：默认分块阈值是多少 MB？（答案格式：`# Q1: <number>`）
- **Q2**：`MemoryMonitor` 上**确切的方法名**是什么，决定是否分块？（答案格式：`# Q2: <method_name>`）

### 2. 修复 `find_cross_chunk_duplicates`

当前 `find_cross_chunk_duplicates(chunks, column)` 只在每个 chunk 内独立查重复，
跨块的重复（一个值在 chunk A 出现、又在 chunk B 出现）完全看不到。

修复它，使其能检测**跨多个 chunk** 出现的重复值。要求：

- 返回 `list[tuple[int, int]]`，元素为 `(chunk_index, local_row_index)`。
- 覆盖**所有**值在**整个拼接后的数据集**中出现超过一次的行（`keep=False` 语义：所有副本都标记）。
- 保留对"单 chunk 内重复"的检测能力（不能回归）。
- 列不存在时返回 `[]`，不崩溃。

### 约束（务必遵守）

- 只改 `workspace/` 内文件：编辑 `workspace/chunked_checker.py`，新建 `workspace/answers.py`。
- **不碰** `seed/memory_monitor.py` / `seed/chunked_checker.py` / `verify.py` / `task.md` / `SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。

### 提示

- **关键决策点**：返回值是**按 chunk 定位**的 `(chunk_idx, local_row)`，**不是**全局行号。
  `local_row` = 该行在其所属 chunk 的 DataFrame 内的**索引标签**（`chunk[column]` 的 index）。
- 思路：把所有 chunk 的目标列值连同其 `(chunk_idx, local_row)` 一起收集，对**全量值**做频次统计
  （或 `pd.concat(...)` 后 `duplicated(keep=False)`），凡频次 > 1 的值对应的行都进返回列表。
- 别忘了处理"列不存在"：该 chunk 跳过，但不要让整体崩。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。检查项详见 verify 输出（理解题 2 项 + 修复正确性 5 项）。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
