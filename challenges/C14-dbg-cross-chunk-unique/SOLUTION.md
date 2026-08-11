<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C14 SOLUTION — 跨块唯一性检查漏检

参考实现见下方代码块。

## 关键决策

1. **concat-then-check，而非 per-chunk check**：bug 的根因是 `duplicated()` 只在单个 chunk
   内找重复，跨 chunk 边界的重复（一个副本在 chunk A、另一个在 chunk B）双方各自看都"无重复"，
   必然漏检。正解是把所有 chunk 的目标列先 `pd.concat(...)` 成一列，再对该组合列跑
   `duplicated(keep=False)`——这正是后端 `executor.py` 的缓解思路（分块只做"加载与格式解析"，
   约束校验在 `pd.concat(dfs, ignore_index=True)` 之后的全量上统一执行，注释明确点出
   "Unique 假阴性"是此设计要消除的缺陷）。

2. **并行维护 `global_rows` 列表，把掩码位置映回真实全局行号**：这是本题最容易踩的坑。
   `pd.concat(..., ignore_index=True)` 后组合列的 index 是 0-based 的"组合内位置"，
   它**只在"所有 chunk 都含该列"时恰好等于全局行号**。一旦某个 chunk 缺该列，那个 chunk
   的行没进组合列、却仍占了全局行号空间，组合内位置与全局行号就错位了。稳妥写法是边累加
   `offset += len(chunk)`、边只对含列的 chunk 把 `range(offset, offset+len(chunk))` 追加进
   `global_rows`，最后用 `global_rows[i]` 取掩码第 i 位的真实行号。这样缺列 chunk 的偏移
   被正确计入、其行又不污染组合列。

3. **`keep=False` 语义不变**：重复值的所有副本（不只第二个）都进返回列表。`pd.concat` 后
   一次性 `duplicated(keep=False)` 天然满足，不需要额外处理。

4. **空组合列短路返回 `[]`**：若所有 chunk 都缺该列（或 `chunks` 为空），`series_list` 为空，
   直接返回 `[]`，避免 `pd.concat([])` 抛 `ValueError`（pandas 对空列表 concat 会报
   "No objects to concatenate"）。

5. **为什么这个 bug 特别阴险**：程序**不报错、不抛异常**，只是返回值悄悄少了该报的行号。
   上游（约束校验报告）基于不完整的数据继续工作，重复数据悄悄入库，问题只在很晚之后
   （主键冲突、对账失败）才暴露。这类"静默漏报"比"抛错"难调试得多——这也是 AGENTS.md
   把它列为"已知缺陷"的原因。

## 参考实现

```python
"""跨块唯一性检查（C14 SOLUTION —— 修复跨块漏检）。"""
from __future__ import annotations

import pandas as pd


def check_unique(chunks: list[pd.DataFrame], column: str) -> list[int]:
    """检查指定列在所有 chunk 中的唯一性，返回重复行的全局行号列表。

    全局行号 = 跨 chunk 连续编号（chunk0 的行 0..n，chunk1 接着 n+1..）。
    缺列的 chunk 不参与去重，但仍占用全局行号空间。

    修复点：先 concat 所有 chunk 的目标列，再对组合列 duplicated(keep=False)，
    并行维护 global_rows 把掩码位置映回真实全局行号（兼容"某些 chunk 缺该列"）。
    """
    series_list: list[pd.Series] = []
    global_rows: list[int] = []
    offset = 0
    for chunk in chunks:
        n = len(chunk)
        if column in chunk.columns:
            series_list.append(chunk[column])
            global_rows.extend(range(offset, offset + n))
        # 注意：缺列的 chunk 不进 series_list，但仍累加 offset（它占行号空间）
        offset += n

    if not series_list:
        # 所有 chunk 都缺该列（或 chunks 为空）→ 无可检重复
        return []

    # concat 后 ignore_index=True：组合列 index 为 0..N-1，与 global_rows 一一对应
    combined = pd.concat(series_list, ignore_index=True)
    dup_mask = combined.duplicated(keep=False)
    return [global_rows[i] for i, is_dup in enumerate(dup_mask) if is_dup]
```

## 简化版（亦可接受，但仅适用于"所有 chunk 都含该列"）

若题目约定"所有 chunk 都含该列"（verify 的检查 6 是唯一的缺列用例，且是单 chunk 全缺），
下面这个更短的版本也能过全部 verify 检查——因为它在 `series_list` 为空时短路返回 `[]`：

```python
def check_unique(chunks, column):
    series_list = [c[column] for c in chunks if column in c.columns]
    if not series_list:
        return []
    combined = pd.concat(series_list, ignore_index=True)
    dup_mask = combined.duplicated(keep=False)
    return [int(i) for i in combined[dup_mask].index]
```

**但它有一个潜在缺陷**：当"部分 chunk 缺该列"（非全部缺）时，`combined.index` 是组合内
0-based 位置，与真实全局行号错位——缺列 chunk 的行号没被跳过计算。verify 没有覆盖这种
"部分缺列 + 有重复"的组合，所以简化版能过；但若要严格正确（生产代码），**请用上方的
`global_rows` 版本**。task.md 的"关键决策点"也特别点出了这一点。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 仍 per-chunk 跑 `duplicated()`（没真修，只改了表面） | 检查 2/3/5（跨块重复）FAIL |
| concat 后用 `combined.index` 直接当全局行号，但没处理缺列 chunk 的偏移 | 检查 1-5 全过（这些用例所有 chunk 都含列）；但"部分缺列"场景会错位（verify 未覆盖，属隐性缺陷） |
| 全局行号 off-by-one：`offset` 从 1 起算，或 `global_row += len(chunk)` 放错位置 | 检查 2/3/5 的行号错位 → FAIL |
| `pd.concat([])` 未短路（没判 `if not series_list`） | 所有 chunk 缺列时抛 `ValueError: No objects to concatenate` → 检查 6 FAIL（返回 `ERR: ...`） |
| 丢了 `keep=False`，用默认 `keep="first"` | 只有第二个及之后的副本被标，第一个被漏 → 检查 1/2/3 的预期行号集合对不上 → FAIL |
| 为了修跨块把单 chunk 检测逻辑删了（回归） | 检查 1（单 chunk 内重复）FAIL |
| 缺列 chunk 用 `continue` 跳过时**没累加 offset**（seed 的另一个隐性 bug） | 单 chunk 全缺的检查 6 仍过（返回 `[]`）；但多 chunk 部分缺列场景行号错位 |
| 在模块顶层 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |

## 边缘情况说明

- **所有 chunk 都含该列**：`global_rows == [0,1,2,...,N-1]`，与 `combined.index` 完全对齐，
  此时简化版与 `global_rows` 版等价。
- **部分 chunk 缺该列**：缺列 chunk 的行不进 `series_list`，但其 `len(chunk)` 仍计入 `offset`，
  后续含列 chunk 的全局行号正确前移。`global_rows` 版正确处理；简化版会错位。
- **所有 chunk 都缺该列 / `chunks` 为空**：`series_list` 为空 → 短路返回 `[]`，不触发
  `pd.concat([])` 的异常。
- **chunk 的 DataFrame 自带非默认 index**（如被切片过）：`pd.concat(..., ignore_index=True)`
  会丢弃各 chunk 的原 index、统一重排为 0-based，因此 `global_rows[i]` 与组合列第 i 位始终对齐，
  不受 chunk 原 index 影响。

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed）

2. 把参考答案（上方"参考实现"代码块）写进 `workspace/check_unique.py`（覆盖 seed 副本）。

3. `cd C14-dbg-cross-chunk-unique && python verify.py` → 必须 PASS（退出码 0）。
   预期 6 项检查全 `[✓]`：
   - check_unique 可导入
   - 单 chunk 内重复仍检测（行 0,1）
   - 跨块重复检测（'a' 在全局行 0 和 2）
   - 多个跨块重复全检（行 0,1,2,4）
   - 无重复 → 空列表
   - 三块跨块重复（'x' 在行 0 和 2）
   - 列不存在不崩溃（返回空列表）

4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。

5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 2/3/5（跨块重复）FAIL
   （seed 仍 per-chunk 校验，跨块重复漏检），整体 FAIL。检查 1（单 chunk 回归）、
   检查 4（无重复）、检查 6（单 chunk 缺列 → seed `continue` 后 duplicates 保持 `[]`）仍过。

6. 再次 `./reset.sh` 复位到干净状态入库。
