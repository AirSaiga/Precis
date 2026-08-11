<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C02 SOLUTION — 分块加载阈值与跨块缺陷

参考实现见下方代码块。

## 理解题答案

- **Q1**：`# Q1: 500` —— `DEFAULT_CHUNK_THRESHOLD_MB = 500`（`memory_monitor.py:29`），
  对应 AGENTS.md "大文件支持分块加载（>500MB 阈值）"。
- **Q2**：`# Q2: should_chunk` —— `MemoryMonitor.should_chunk(file_size_mb)`，依据
  `file_size_mb > self.chunk_threshold_mb` 返回是否分块（`memory_monitor.py:98-111` 真实位置）。

`answers.py` 全文：

```python
# C02 理解题答案
# Q1: 500
# Q2: should_chunk
```

## 关键决策

1. **理解题答案必须 grounded 在真实代码**：Q1 不是猜的"一个常见阈值"，而是 `memory_monitor.py`
   顶部 `DEFAULT_CHUNK_THRESHOLD_MB` 常量的字面值 500；Q2 不是"任何相关方法名"，而是确切
   决策入口 `should_chunk`（`chunk_size` 内部也调它，但决策本身归 `should_chunk`）。verify 用
   正则 `#\s*Q1[:：]\s*(\d+)` / `#\s*Q2[:：]\s*(\w+)` 匹配，格式不符直接判错。

2. **跨全集值频次，而非 per-chunk 频次**：bug 根因是 `find_duplicates_in_chunk` 只在单 chunk 内
   跑 `duplicated()`，跨 chunk 边界的重复（副本 A 在 chunk 0、副本 B 在 chunk 1）双方各自看
   都"无重复"，必然漏检。正解是把所有 chunk 的目标列值连同 `(chunk_idx, local_row)` 一起收集，
   对**全量值**做频次统计（`collections.Counter`），频次 > 1 的值对应的所有行都进返回列表。
   这正是后端 `executor.py` 的缓解思路（分块只做"加载与格式解析"，约束校验在全量
   `pd.concat(...)` 之后统一执行，注释明确点出 "Unique 假阴性"是要消除的缺陷，约 856 行）。

3. **返回值是按 chunk 定位的 `(chunk_idx, local_row)`，不是全局行号**：这是本题最容易踩的坑。
   `local_row` = 该行在其 chunk 的 DataFrame 内的**索引标签**（`chunk[column].items()` 给出的
   index），不是"跨 chunk 连续编号"。verify 的预期如 `'a' 在 chunk0 行0 和 chunk1 行0` →
   `[(0,0),(1,0)]`，两个 local_row 都是 0，正体现了"按 chunk 各自定位"。这与 C14（返回全局
   行号）刻意区分——C02 是 nav 题，重点在"读懂 per-chunk 定位语义"。

4. **`keep=False` 语义不变**：重复值的所有副本（不只第二个）都进返回列表。Counter 版天然满足
   （频次 > 1 的值其所有出现都标记），无需额外处理。

5. **列不存在要短路**：若某 chunk 缺目标列，跳过该 chunk（不收集其值），但不要让整体崩。
   全部 chunk 都缺列时返回 `[]`。seed 的 `find_duplicates_in_chunk` 已用 `if column not in
   chunk.columns: return []` 处理，修复版沿用同样守卫。

## 参考实现

```python
"""分块唯一性检查器（C02 SOLUTION —— 修复跨块漏检）。"""
from __future__ import annotations

from collections import Counter

import pandas as pd


def find_duplicates_in_chunk(chunk: pd.DataFrame, column: str) -> list[int]:
    """在单个 chunk 内查找重复行的本地行号。"""
    if column not in chunk.columns:
        return []
    mask = chunk[column].duplicated(keep=False)
    return [int(i) for i in chunk[mask].index]


def find_cross_chunk_duplicates(chunks: list[pd.DataFrame], column: str) -> list[tuple[int, int]]:
    """查找跨块重复：返回 (chunk_index, local_row_index) 列表。

    修复点：把所有 chunk 的目标列值连同 (chunk_idx, local_row) 收集起来，
    对全量值做频次统计，频次 > 1 的值对应的所有行都进返回列表。
    local_row = 该行在其 chunk 的 DataFrame 内的索引标签。
    """
    # 收集 (chunk_idx, local_row, value)
    all_values: list[tuple[int, int, object]] = []
    for chunk_idx, chunk in enumerate(chunks):
        if column not in chunk.columns:
            continue
        for local_row, value in chunk[column].items():
            all_values.append((chunk_idx, int(local_row), value))

    if not all_values:
        # 所有 chunk 都缺该列（或 chunks 为空）→ 无可检重复
        return []

    # 全量值频次：频次 > 1 的值即为跨块（或块内）重复
    value_counts = Counter(v for _, _, v in all_values)
    dup_values = {v for v, c in value_counts.items() if c > 1}
    return [(ci, lr) for ci, lr, v in all_values if v in dup_values]
```

## 简化版（concat-then-duplicated，亦可接受）

```python
import pandas as pd

def find_cross_chunk_duplicates(chunks, column):
    rows = []  # (chunk_idx, local_row)
    series = []  # 对应位置的值
    for ci, chunk in enumerate(chunks):
        if column not in chunk.columns:
            continue
        for local_row, value in chunk[column].items():
            rows.append((ci, int(local_row)))
            series.append(value)
    if not series:
        return []
    dup_mask = pd.Series(series).duplicated(keep=False)
    return [rows[i] for i, is_dup in enumerate(dup_mask) if is_dup]
```

两种写法等价：Counter 版不依赖 pandas concat、对小数据更直接；concat 版更贴近
后端 `executor.py` 的真实缓解思路。verify 对两者都通过。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 仍 per-chunk 跑（没真修，只汇总 per-chunk 结果） | 跨块重复检查（r2/r3）FAIL —— 这正是 seed 的 bug |
| 返回**全局行号**而非 `(chunk_idx, local_row)` | r2 期望 `[(0,0),(1,0)]`，全局行号版返回 `[0,2]` → FAIL |
| `local_row` 用位置序号 `range(len(chunk))` 而非索引标签 | 默认 RangeIndex 下两者相等能过；但 chunk 自带非默认 index 时错位（verify 未覆盖，属隐性缺陷） |
| 丢了 `keep=False` 语义，只标第二个及之后副本 | r1/r2/r3 的预期集合对不上 → FAIL |
| 没处理"列不存在"（直接 `chunk[column]`） | r5（列缺失）抛 `KeyError` → 返回 `ERR: ...` → FAIL |
| 为了修跨块把单 chunk 检测逻辑删了（回归） | r1（单 chunk 内重复）FAIL |
| 在模块顶层 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |
| answers.py 写成 `Q1:500`（冒号后无空格）或 `Q1 = 500` | 正则 `#\s*Q1[:：]\s*(\d+)` 要求 `#` 开头、冒号后可有空白；`Q1 = 500` 不匹配 → FAIL |

## 边缘情况说明

- **所有 chunk 都含该列**：每个 chunk 的所有行都进 `all_values`，频次统计覆盖全量。
- **部分 chunk 缺该列**：缺列 chunk 被 `continue` 跳过，不污染频次；其行也不进返回列表
  （它们本就无可检值）。
- **所有 chunk 都缺该列 / `chunks` 为空**：`all_values` 为空 → 短路返回 `[]`。
- **chunk 自带非默认 index**（如被切片过）：参考版用 `chunk[column].items()` 取索引标签作
  `local_row`，与 seed 的 `find_duplicates_in_chunk`（用 `chunk[mask].index`）语义一致；
  verify 的测试用例均用默认 RangeIndex，标签 == 位置。

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed，无 answers.py）

2. 把参考答案写进 workspace：
   - 新建 `workspace/answers.py`（内容见上方"理解题答案"代码块）
   - 把"参考实现"代码块覆盖 `workspace/chunked_checker.py`

3. `cd C02-nav-chunked-loader && python verify.py` → 必须 PASS（退出码 0）。
   预期 8 项检查全 `[✓]`：
   - answers.py 存在
   - Q1 答案 = 500
   - Q2 答案 = should_chunk
   - chunked_checker 可导入
   - find_cross_chunk_duplicates 存在
   - 单 chunk 内重复仍检测（(0,0),(0,1)）
   - 跨块重复检测（(0,0),(1,0)）
   - 多值跨块重复全检
   - 无重复 → 空列表
   - 列不存在不崩

4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。

5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让以下检查 FAIL，整体 FAIL：
   - answers.py 不存在 → "answers.py 存在" `[✗]`、Q1/Q2 正则不匹配 `[✗]`
   - seed 的 `find_cross_chunk_duplicates` 仍 per-chunk → 跨块重复检查（r2/r3）`[✗]`
   - 仍过的：r1（单 chunk 内重复，per-chunk 能检）、r4（无重复 → 空列表）、r5（列缺失 → 空列表）

6. 再次 `./reset.sh` 复位到干净状态入库。
