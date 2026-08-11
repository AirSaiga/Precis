<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C21 SOLUTION — 校验循环重构成 pipeline（处方式重构）

参考实现 = 在 `workspace/validator.py` 内新增 4 个纯 stage 函数 + 把 `process` 重写成
依次调用它们的 pipeline（不再含任何逐元素 `for`/`if`）。完整代码见下方。

## 关键决策

1. **为什么是"处方式（prescriptive）"**：自由形式的"把循环重构成 pipeline"无法客观打分——
   不同审稿人对"该拆几步、各步怎么签名、数据结构怎么传、要不要引入通用 `compose`"有不同审美。
   本题把可量化目标钉死为"拆成恰好这 4 个具名 stage + `process` 依次调用它们"，使 verify 能
   机械判定对错（符号存在 + 各 stage 行为 + process 行为对照黄金 + process 函数体引用了 4 个
   stage 名）。这是把"控制流重构"这类主观任务改造成可自动评分 benchmark 的标准手法。

2. **为什么用 pipeline（每步一个纯函数）而不是其它重构形态**：原始 `process` 的 4 段逻辑本就是
   **线性数据流**（`values → filtered → converted → (valid, violations) → result dict`），天然
   适合拆成一串"输入 → 输出"的 stage。每 stage 是无状态纯函数，可单独单测、可独立替换
   （想换一种转换或加一道预处理，只动对应 stage，不碰其它）。这正对应 AGENTS.md「后端校验引擎
   采用两阶段流水线（数据加载与预处理 → 约束校验）」的思路——本题是它的微缩版。

3. **`violations` 下标基准 = converted 列表（关键决策点 1）**：范围检查这一步遍历的是
   `converted`（过滤+转换后的列表），越界值记的是它**在 `converted` 里的 `enumerate` 下标**，
   **不是**原始 `values` 的下标。举例：`values = [None, "abc", 5, None, 20]`，过滤+转换后
   `converted = [0, 5, 20]`（"abc"→0），范围 `[0,10]` 下越界的是 `20`，它在 `converted` 里
   下标为 `2`——所以 `violations = [2]`，而不是它在 `values` 里的下标 `4`。`stage_range_check`
   直接 `for i, v in enumerate(values)` 即可对齐（这里的入参 `values` 形参名就是 converted）。

4. **`total_filtered` 来源 = filter_none 之后（关键决策点 2）**：`total_filtered` 是
   `stage_filter_none` 之后的长度（`len(filtered)`）。注意它**不等于** `total_valid`（范围检查
   还会再淘汰越界值），也**不等于** `len(converted)`（这俩恰好同长，但语义上属"过滤后"）。
   `process` 里把它作为 `stage_collect` 的参数显式传入，避免 `stage_collect` 自己再算一遍。

5. **`process` 只做编排**：参考实现的 `process` 只剩 4 行——依次调用 4 个 stage，把上一步输出喂
   给下一步，最后调 `stage_collect` 组装。**不**保留任何 `for`/`if`/`append`。这样"控制流被
   重构"这件事是肉眼可验、verify 可机械判定的（检查 `process` 函数体里出现了 4 个 stage 名）。

## 参考实现

### `workspace/validator.py`（改造后）

```python
"""校验引擎（C21 reference —— 命令式嵌套循环已重构成 pipeline）。

4 个纯 stage 函数 + 一个只做编排的 process。每步是独立可测的纯函数，
数据线性流过 stage 链：values → filtered → converted → (valid, violations) → result。
"""
from __future__ import annotations

from typing import Any


# ============================================================================
# pipeline stages —— 每个是纯函数（输入 → 输出，无副作用）
# ============================================================================


def stage_filter_none(values: list[Any]) -> list[Any]:
    """Stage 1：丢掉 None 值。"""
    return [v for v in values if v is not None]


def stage_convert(values: list[Any]) -> list[int]:
    """Stage 2：逐个 int() 转换；转换失败用 0 占位。"""
    converted: list[int] = []
    for v in values:
        try:
            converted.append(int(v))
        except (ValueError, TypeError):
            converted.append(0)
    return converted


def stage_range_check(
    values: list[int], min_val: int, max_val: int
) -> tuple[list[int], list[int]]:
    """Stage 3：范围检查，返回 (合法值, 越界值在入参 values 中的下标)。"""
    valid: list[int] = []
    violations: list[int] = []
    for i, v in enumerate(values):
        if min_val <= v <= max_val:
            valid.append(v)
        else:
            violations.append(i)
    return valid, violations


def stage_collect(
    valid: list[int],
    violations: list[int],
    total_input: int,
    total_filtered: int,
) -> dict[str, Any]:
    """Stage 4：组装结果 dict。"""
    return {
        "valid": valid,
        "violations": violations,
        "total_input": total_input,
        "total_filtered": total_filtered,
        "total_valid": len(valid),
    }


# ============================================================================
# 编排 —— process 只剩"依次调用 4 个 stage"，不再含逐元素循环
# ============================================================================


def process(values: list[Any], min_val: int, max_val: int) -> dict[str, Any]:
    """pipeline 编排：filter → convert → range_check → collect。"""
    filtered = stage_filter_none(values)
    converted = stage_convert(filtered)
    valid, violations = stage_range_check(converted, min_val, max_val)
    return stage_collect(valid, violations, len(values), len(filtered))
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| `violations` 下标用了原始 `values` 的下标（而非 converted 列表） | 含 None/转换失败值的用例对照黄金 FAIL（下标整体偏移） |
| `total_filtered` 误用 `len(converted)` 后又被范围检查淘汰，写成 `len(valid)` | 含越界值的用例 `total_filtered` 与黄金不符 → process 行为 FAIL |
| 拆了 stage 但 `process` 里仍内联 `for`/`if`（stage 只是定义了没被调用） | "process 函数体调用了 stage_xxx" 4 项 FAIL（substring 检查在 process 函数体里找不到 stage 名） |
| `stage_range_check` 返回 `[violations, valid]`（顺序反了） | stage 独立行为检查 FAIL（`valid != [1, 5]` 或 `violations != [1, 3]`） |
| `stage_convert` 漏捕获 `TypeError`（只捕获 `ValueError`），或把 `int(v)` 写成 `int(float(v))` | 含 `None`-ish 或非数字字符串的用例对照黄金 FAIL（原始只捕 `ValueError, TypeError` 并填 0） |
| 新建了别的文件（如 `pipeline.py`）放 stage | 不影响行为，但若 `validator.py` 没 import 它导致 `validator.stage_*` 不存在 → "stage 函数存在" 4 项 FAIL（任务要求 stage 就在 `validator.py` 内） |
| 把 `stage_collect` 的 `total_valid` 写成参数（而非 `len(valid)`） | 字段数/语义与原始不符 → 对照黄金 FAIL（黄金里 `total_valid = len(valid)`） |
| 在文件顶部 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（从 seed/ 复制出干净 workspace/，此时只有命令式 `process`、
   没有 4 个 stage 函数）
2. 把上面参考实现整段覆盖到 `workspace/validator.py`
3. `cd C21-refactor-pipeline && python verify.py` → 必须 PASS（退出码 0），11 项全 `[✓]`
4. 若 FAIL，对照 verify 输出的 `[✗]` 行修正
5. 验证后回 `challenges/` 跑 `./reset.sh` 复位 → 再跑一次 `python verify.py` 确认**干净 seed 会 FAIL**
   （此时 4 个 stage 不存在 → "stage 函数存在" 4 项 `[✗]` + "stage 各自行为" `[✗]` +
   "process 调用 stage" 4 项 `[✗]`，至少 9 项 `[✗]`；唯二可能 `[✓]` 的是"validator 可导入"和
   "process 行为对照黄金"——因为 seed 的 `process` 本就是黄金实现）——这验证题目有区分度
6. 最后再 `./reset.sh` 一次把 workspace/ 留在干净 seed 状态（workspace/ 不入库，由 .gitignore 排除）
