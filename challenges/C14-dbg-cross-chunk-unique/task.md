# C14-dbg-cross-chunk-unique — 修复跨块唯一性检查漏检

| 项 | 值 |
|----|-----|
| ID | C14 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12 + pandas |

## 背景

`workspace/` 里有一个 `check_unique.py`，模拟 Precis 的分块加载（chunked loader）场景：
大文件（>500MB 阈值）被切成多个 chunk 依次加载，`check_unique(chunks, column)` 负责校验
某列在整个数据集中的唯一性，返回所有重复行的**全局行号**（跨 chunk 连续编号，0-based）。

这是 Precis 代码库里一个**真实缺陷的缩影**。主仓库 `AGENTS.md` 明确标注：

> "chunked 校验正确性的已知缺陷：cross-chunk Unique has known defects"

真实代码里，`backend/app/shared/domain/constraints/unique.py` 的 `validate()` 直接对传入的
DataFrame 调 `df.duplicated()`（`unique.py:123` 附近）——分块模式下每块独立校验，跨块重复
必然漏检。后端的缓解措施（`backend/app/shared/services/validation/executor.py`，注释见
"Unique 假阴性"，约 760 行）是在所有块解析完成后 `pd.concat(...)` 成全量，再统一跑约束校验。
本题就是把那个缓解思路落在一个最小的可测函数上。

**先读 `workspace/check_unique.py`**，理解：

- `check_unique(chunks, column)` 的签名与返回约定（全局行号 list[int]）
- 当前实现：`for chunk in chunks:` 循环里对每个 chunk 单独跑 `chunk[column].duplicated(keep=False)`
- bug 的本质：`duplicated()` 只在一个 chunk 内部找重复；若值 `a` 在 chunk0 出现一次、chunk1
  又出现一次，两个 chunk 各自看都"无重复"，跨块重复被**静默漏检**

## 症状

以 `chunks = [DataFrame({"id": ["a","b"]}), DataFrame({"id": ["a","c"]})]`、`column="id"` 为例：

- 全局行号：chunk0 的 `a`=行0、`b`=行1；chunk1 的 `a`=行2、`c`=行3
- 正确答案：`a` 在行0 和行2 重复 → 返回 `[0, 2]`
- 当前 buggy 实现：chunk0 `[a,b]` 无重复、chunk1 `[a,c]` 无重复 → 返回 `[]`（漏报）

注意：**程序不报错**——只是返回值少了该报的行号。这是"静默漏报"，比抛错难发现得多。

## 任务

修复 `check_unique`，使其能检测**跨 chunk 边界**的重复值。修复后必须：

1. 跨块重复能被检出（一个副本在 chunk A、另一个在 chunk B）。
2. 返回值仍为**全局行号**列表（跨 chunk 连续编号，0-based）。
3. 保留 `keep=False` 语义：重复值的所有副本都被标记（不只标第二个）。
4. 不破坏单 chunk 内重复的检测（不能为修跨块而回退块内检测）。

### 规格

- **函数名**：`check_unique`（保持不变）
- **文件**：`workspace/check_unique.py`
- **签名**：`check_unique(chunks: list[pd.DataFrame], column: str) -> list[int]`
- **行为**：
  - 全局行号映射：chunk0 占行 `0..len(chunk0)-1`，chunk1 从 `len(chunk0)` 起，依此类推
    （**注意**：缺列的 chunk 也占行号空间，不能因为它没该列就把后续行号前移）
  - `keep=False`：重复值的所有副本都进返回列表
  - 无重复 → 返回 `[]`
  - 某些 chunk 缺该列 → 至少不能崩溃；最稳妥的做法是跳过缺列 chunk 的该列、但仍计入它的行号偏移
  - 所有 chunk 都缺该列 → 返回 `[]`

### 约束（务必遵守）

- 只改 `workspace/check_unique.py`。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Python 标准库 + pandas）。

### 提示

- 修复思路：**先把所有 chunk 的目标列 concat 成一列，再对该组合列跑 `duplicated(keep=False)`**，
  最后把掩码位置映回全局行号。这正是后端 `executor.py` 在分块结束后 `pd.concat(...)` 再统一
  校验的做法。
- 关键代码骨架：
  ```python
  series_list = [c[column] for c in chunks if column in c.columns]
  combined = pd.concat(series_list, ignore_index=True)
  dup_mask = combined.duplicated(keep=False)
  ```
- **关键决策点（全局行号映射）**：`pd.concat(..., ignore_index=True)` 后组合列的 index 是
  0-based 的"组合内位置"，它在"所有 chunk 都含该列"时恰好等于全局行号；但若**某些 chunk 缺该列**，
  组合内位置就与全局行号错位了（缺列 chunk 的行没进组合列，却仍占了全局行号）。最稳妥的写法是
  并行维护一个 `global_rows` 列表，逐 chunk 累加 `offset += len(chunk)`，只对含列的 chunk 把
  `range(offset, offset+len(chunk))` 追加进去，最后用 `global_rows[i]` 取掩码第 i 位的真实行号。
- 边缘情况：所有 chunk 都缺该列 → `series_list` 为空 → 直接返回 `[]`。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。约 6 项检查详见 verify 输出（含单 chunk 回归、跨块重复、
多跨块重复、无重复、三块跨块、缺列不崩溃）。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
