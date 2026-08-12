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

workspace 是 Precis 分块文件加载（chunked loader）的精简缩影，涉及两个文件：
`workspace/memory_monitor.py`（分块决策）与 `workspace/chunked_checker.py`（分块后的唯一性检查）。

这是 **nav（代码导航）任务**：先**读懂**这两个文件，再回答两道理解题并做一处小修复。

## 任务

### 1. 回答两道理解题

新建 `workspace/answers.py`，**仅作为注释**写两行答案（格式严格如下，verify 用正则匹配）：

```python
# C02 理解题答案
# Q1: <number>
# Q2: <method_name>
```

- **Q1**：默认分块阈值是多少 MB？（答案格式：`# Q1: <number>`）
- **Q2**：`MemoryMonitor` 上**确切的方法名**是什么，决定是否分块？（答案格式：`# Q2: <method_name>`）

### 2. 修复 `find_cross_chunk_duplicates`

读 `workspace/chunked_checker.py`，理解 `find_cross_chunk_duplicates(chunks, column)` 当前的行为，
它存在缺陷——某些重复值检测不到。修复它使其正确工作。返回值结构沿用 seed
`find_cross_chunk_duplicates` docstring 声明的契约（`(chunk_idx, local_row)` 元组列表，
`local_row` 为该行在其 chunk 内的索引标签）；其余实现细节自行决定。verify 只测行为，不查内部实现。

## 约束

- 只改 `workspace/` 内文件：编辑 `workspace/chunked_checker.py`，新建 `workspace/answers.py`。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。

## 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。检查项详见 verify 输出。
