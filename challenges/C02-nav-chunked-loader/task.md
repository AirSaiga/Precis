# C02-nav-chunked-loader — 分块加载阈值与跨块缺陷

| 项 | 值 |
|----|-----|
| ID | C02 |
| 维度 | nav（代码库导航与理解） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 20-35 分钟 |
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

修复后的完整规格（三条都必须满足）：

1. **跨块重复要检出**：一个值在 chunk A 出现、又在 chunk B 出现，两处都要报出；
   块内重复的既有行为保持不回归。
2. **NaN / None 不算重复**：列中的缺失值（NaN、None 等）**不参与**重复判定——
   无论出现多少次、分散在多少个 chunk，都不应报出。注意 pandas 的 `duplicated()` /
   `value_counts()` 会把多个缺失值标成重复，直接套用会误报。
3. **支持非字符串列**：int / float 等数值列的跨块重复同样要正确报出，重复判定基于
   值相等。注意缺失值与数值混排时列会被 pandas 转成 float，别把缺失值当成"彼此相等"。

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
