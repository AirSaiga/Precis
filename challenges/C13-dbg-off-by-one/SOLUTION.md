<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C13 SOLUTION — 校验辅助函数的 3 个 bug

参考修复见下方代码块。3 个 bug 互相独立，逐个改即可。

## 关键决策

1. **validate_range —— bug 在分支动作，不在不等号**。seed 里 `if v < min_val or v > max_val:`
   这个判断**对闭区间已经是正确的**（严格小于 min 或严格大于 max 才算越界，边界值通过）。
   真正的缺陷是判断命中后执行的是 `continue`（跳过越界值），而从不在合规分支里
   `append(i)`，导致 `out_of_range` 恒为空。修复方式：把 `continue` 换成
   `out_of_range.append(i)`，**不要去改不等号**。常见的错误是看到 docstring 提到
   "严格不等号"就去把 `<` 改成 `<=`，那反而会把边界值误判为越界。

2. **find_first_null —— range 上界减多了 1**。seed 写成 `range(len(series) - 1)`，
   少扫最后一个元素。修复方式：改回 `range(len(series))`。循环体里的
   `pd.isna(series.iloc[i])` + `return i` 本身是对的，无需动。
   **不要**保留 seed 里那条死代码 `if i > len(series): pass`（它无害但也无意义，
   会让代码读起来像还藏着 bug）——参考实现里整条删掉。

3. **count_violations —— 用 `is None` 而非 `if not errors`**。调用方传 `None` 要返回 0，
   但**空列表 `[]` 也是 falsy**。虽然 verify 没测空列表，但语义上 `[]`（"没有任何违规记录"）
   和 `None`（"调用方没拿到 errors"）是两回事，应分别走正常循环（返回 0）和早退守卫（返回 0）。
   用 `if errors is None: return 0` 精确判别，避免把 `[]`、`0`、`False` 等合法 falsy 输入
   误当 None 处理。

4. **为什么这 3 个 bug 是经典模式**：
   - validate_range 的"逻辑反转"在 Precis 真实校验代码里表现为：校验通过时 `continue`、
     违规时本该收集却走错分支——结果**返回值永远是空**，调用方以为"全部合规"。这是比
     抛错更危险的**静默漏报**。
   - find_first_null 的 off-by-one 是最经典的循环边界缺陷，常见于 `range(len(x) - 1)`、
     `< len(x) - 1`、切片 `[:-1]` 等写法。
   - count_violations 缺 None 守卫：真实代码里上游解析失败 / 字段缺失常返回 None，
     下游没防御就崩。

## 参考实现

```python
"""校验辅助函数（C13 SOLUTION —— 3 个 bug 已修复）。"""
from __future__ import annotations

import pandas as pd


def validate_range(values: list[float], min_val: float, max_val: float) -> list[int]:
    """返回超出 [min_val, max_val] 范围的值的索引列表（闭区间，边界值合规）。"""
    out_of_range: list[int] = []
    for i, v in enumerate(values):
        # 闭区间：严格小于 min 或严格大于 max 才算越界
        if v < min_val or v > max_val:
            out_of_range.append(i)
    return out_of_range


def find_first_null(series: pd.Series) -> int | None:
    """返回第一个空值的索引，没有返回 None。"""
    for i in range(len(series)):  # 扫描所有元素（含最后一个）
        if pd.isna(series.iloc[i]):
            return i
    return None


def count_violations(errors: list[dict] | None, severity: str = "error") -> int:
    """统计 errors 列表中指定 severity 的数量；errors 为 None 时返回 0。"""
    if errors is None:  # 调用方可能传 None
        return 0
    count = 0
    for err in errors:
        if err.get("severity") == severity:
            count += 1
    return count
```

> 注：参考实现把 `count_violations` 的 `errors` 形参类型从 `list[dict]` 收紧为
> `list[dict] | None`，以反映"可接受 None"的真实契约。这**不违反**"保持函数签名"
> 的约束（签名指参数名 / 顺序 / 默认值 / 可调用性；类型注解属于文档，收紧更准确）。
> 如果你不想动类型注解，只加 `if errors is None: return 0` 也能过 verify。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| validate_range 把 `<` 改成 `<=`（误以为不等号是 bug） | 边界值（正好等于 min/max）被误判越界 → 检查 1（`[0,5,10,15]` 边界 0/10 应合规）和检查 2（`[1,2,3]` 边界 1/3 应合规）FAIL |
| validate_range 改了不等号却没去掉 `continue` | 仍恒返回 `[]` → 全部 range 检查 FAIL |
| validate_range 用 `if min_val <= v <= max_val: continue`（条件取反 + 仍 continue） | 逻辑等价于"合规的跳过、越界的留下但没 append"——还是恒返回 `[]` → FAIL |
| find_first_null 只删死代码 `if i > len(series): pass` 但没改 `range(len(series) - 1)` | 仍漏检最后一个元素 → 检查"最后一个元素是 null"FAIL |
| find_first_null 改成 `range(1, len(series))`（漏检第一个） | 检查"中间 null"和"无 null"过，但若 verify 有"第一个是 null"用例会 FAIL；且偏离了"扫描所有"的契约 |
| count_violations 用 `if not errors: return 0`（而不是 `is None`） | 本题 verify 没测空列表所以能过；但语义错（空列表 `[]` 被当 None），属隐性缺陷 |
| count_violations 用 `try/except TypeError` 兜底 | 能过 verify，但把 None 和其它意外异常混在一起，不如显式 `is None` 守卫清晰 |
| 在模块顶层 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |

## 边缘情况说明

- **validate_range 空列表 `[]`**：循环不执行，返回 `[]`（正确——没有越界值）。
- **validate_range NaN 输入**：`NaN < min_val` 和 `NaN > max_val` 都是 `False`（IEEE 754），
  所以 NaN 会被当作"合规"而不报。本题 verify 不测 NaN；若生产代码需要把 NaN 当越界，
  应显式加 `or pd.isna(v)` 判断。
- **find_first_null 空系列**：`range(0)` 不执行循环，返回 `None`（正确）。
- **find_first_null 系列 dtype 为 object（混型）**：`pd.isna` 对 `None`/`NaN`/`pd.NA`
  都返回 True，与 dtype 无关。
- **count_violations 空列表 `[]`**：循环不执行，返回 `0`（正确——`is None` 守卫不拦截 `[]`）。
- **count_violations 条目缺 `severity` 键**：`err.get("severity")` 返回 `None`，不等于
  任何 severity 字符串，不计入——符合"统计指定 severity"的契约。

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed）。

2. 把参考答案（上方"参考实现"代码块）写进 `workspace/validators.py`（覆盖 seed 副本）。

3. `cd C13-dbg-off-by-one && python verify.py` → 必须 PASS（退出码 0）。
   预期 4 项检查全 `[✓]`：
   - validators.py 可导入
   - validate_range 闭区间正确（边界值合规，越界值返回索引）
   - find_first_null 能找到最后一个元素的空值
   - count_violations 处理 None 不崩 + 正确计数

4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。

5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 FAIL：
   - **validate_range 检查 FAIL**：seed 恒返回 `[]`，`[0,5,10,15]` 期望 `[3]` 拿到 `[]`。
   - **find_first_null 检查 FAIL**：seed `range(len(series) - 1)` 漏检最后一个，
     `pd.Series([1.0, 2.0, None])` 期望 `2` 拿到 `None`。
   - **count_violations 检查 FAIL**：seed 对 `fn(None)` 抛 TypeError，被 verify 的
     `except Exception` 兜成 False。
   - 仅"validators.py 可导入"一项过 → 整体 FAIL。

6. 再次 `./reset.sh` 复位到干净状态入库。

## 设计说明（出题者备忘）

- 本题 seed 刻意把每个 bug 在 docstring 和行内注释里标成 `BUG:`——★☆☆ 难度考的是
  **读契约 + 精确定位 + 最小修复**，不是逆向黑盒调试。题目正文也明说了这一点。
- 3 个 bug 选择的是**互相独立、覆盖 3 种经典模式**（逻辑反转 / off-by-one / 缺 None 守卫），
  且每个都能被 verify 的对应检查**精确捕获**——没有"bug 无害"或"多个 bug 互相掩盖"的情况。
- **find_first_null 的 bug 选择**：早期草稿用过"死守卫 `if i > len(series): pass`"，
  但那实际上**无害**（循环仍扫描所有元素，verify 全过）——会让"干净 seed FAIL"的自验
  不成立。最终改成 `range(len(series) - 1)`，这是真正会漏检最后一个元素的 off-by-one，
  与 docstring "循环范围 off-by-one" 的描述一致。
