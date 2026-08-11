<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C20 SOLUTION — 提取 formatters 模块（处方式重构）

参考实现 = 新建 `workspace/formatters.py`（4 个公开函数，逐字搬运去下划线）+ 改造后的
`workspace/service.py`（删 4 个 `def _format_*`、加 import、改 2 处调用点）。完整代码见下方。

## 关键决策

1. **为什么是"处方式（prescriptive）"**：自由形式的"把代码重构好"无法客观打分——不同审稿人对
   "好"有不同审美（提几个函数？怎么分组？要不要改名？）。本题把可量化目标钉死为"提取恰好这 4 个
   具名函数到新模块、并改成公开"，使 verify 能机械判定对错（符号存在 + 文本特征 + 行为不变）。
   这是把"重构"这类主观任务改造成可自动评分 benchmark 的标准手法。

2. **为什么搬到 `formatters.py` 后要去掉前导下划线（改公开）**：`_format_*` 原本是 `service.py`
   模块私有（前导下划线 = "本模块内部"）。一旦搬到独立模块成为该模块的对外 API，再保留下划线就
   语义错位了——`formatters._format_xxx` 暗示"formatters 模块内部私有"，但 service 又跨模块 import
   它，自相矛盾。任务显式要求改成 `format_*`（公开），既修正语义，又让 verify 能用 `hasattr(fmt,
   "format_*")` 判定新 API 是否就位。

3. **为什么 `service.py` 仍然拥有 `UnifiedValidationService` 类**：这 4 个 formatter 是**无状态纯
   函数**（输入→dict 字面量），不属于任何对象实例；而 `UnifiedValidationService` 是有状态的编排
   服务。把它们剥到 `formatters.py` 后，service.py 只剩"编排职责"，单一职责更清晰。这复刻了真实
   仓库 `backend/app/shared/services/validation/service.py` 的同款结构（服务类 + 一组格式化辅助）。

4. **import 写法（参考实现导入全部 4 个）**：参考实现按任务文本逐字导入全部 4 个 formatter
   （`from formatters import format_not_null_error, format_unique_error, format_range_error,
   format_foreign_key_error`），即使 service 当前只调用其中 2 个——保持"4 个 formatter 作为一组整体
   搬出"的对称性，也便于将来 service 新增校验方法时直接复用。
   **注意**：verify 只检查 service.py 是否含子串 `from formatters import`，并不强制导入哪几个；
   若你更看重 ruff 干净（避免 F401 unused-import），只导入用到的 `format_not_null_error` /
   `format_unique_error` 两个也完全通过。两种写法行为一致、都判 PASS。

## 参考实现

### `workspace/formatters.py`（新建）

```python
"""C20 reference — 提取出来的错误格式化函数（formatters 模块公开 API）。

从 service.py 搬运而来，去掉了前导下划线改为公开；函数体逻辑一字不改。
"""
from __future__ import annotations

from typing import Any


def format_not_null_error(column: str, row: int) -> dict[str, Any]:
    """格式化非空错误。"""
    return {
        "error_type": "NotNullViolation",
        "column": column,
        "row_index": row,
        "message": f"列 '{column}' 的值不能为空",
    }


def format_unique_error(column: str, row: int, value: Any) -> dict[str, Any]:
    """格式化唯一性错误。"""
    return {
        "error_type": "UniqueViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 '{value}' 重复",
    }


def format_range_error(column: str, row: int, value: Any, min_val: float, max_val: float) -> dict[str, Any]:
    """格式化范围错误。"""
    return {
        "error_type": "RangeViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 {value} 不在 [{min_val}, {max_val}] 内",
    }


def format_foreign_key_error(column: str, row: int, value: Any, ref_table: str) -> dict[str, Any]:
    """格式化外键错误。"""
    return {
        "error_type": "ForeignKeyViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 '{value}' 在引用表 '{ref_table}' 中不存在",
    }
```

### `workspace/service.py`（改造后）

```python
"""统一校验服务（C20 reference —— 已把 4 个 formatter 提取到 formatters 模块）。"""
from __future__ import annotations

from typing import Any

from formatters import (
    format_foreign_key_error,
    format_not_null_error,
    format_range_error,
    format_unique_error,
)


class UnifiedValidationService:
    """统一校验服务。"""

    def validate_not_null(self, column: str, rows: list[int]) -> list[dict[str, Any]]:
        return [format_not_null_error(column, r) for r in rows]

    def validate_unique(self, column: str, duplicates: list[tuple[int, Any]]) -> list[dict[str, Any]]:
        return [format_unique_error(column, r, v) for r, v in duplicates]
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 没新建 `formatters.py`，只把函数挪到 `service.py` 别处 | `formatters` 导入失败 → formatters 可导入 / 4 函数存在 / formatters 独立可用 三类检查全 FAIL |
| 新建了 `formatters.py` 但函数名仍带下划线（`_format_*`） | `formatters.format_*` 存在检查 FAIL（4 项） |
| `service.py` 里仍保留 `def _format_not_null_error` / `def _format_unique_error`（只是又 import 了一份） | "service.py 不再含 def _format_* 定义" 两项 FAIL（重复定义没删干净） |
| import 写错模块名（`from formatter import` 单数 / `from service.formatters import`） | `service` 导入失败 → 服务可导入 + 行为不变 两项 FAIL |
| 改了函数体（如把 f-string 文案 / dict key 改了） | 行为不变 / formatters 独立可用 检查 FAIL |
| 把 `UnifiedValidationService` 类也搬走或改名 | "service.UnifiedValidationService 可导入" FAIL（违反"不重命名类"约束） |
| import 后忘了更新调用点（仍调 `_format_not_null_error`） | NameError → 行为不变 FAIL |
| 在 `formatters.py` 顶部 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |
| 用 `import formatters as _f` 然后 `_f.format_*` 调用 | 行为通过、但若同时漏掉直接的 `from formatters import` 字样，则 "service.py import 自 formatters" 文本检查 FAIL（用 `as` 别名时也保留 `from formatters import` 写法即可） |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（从 seed/ 复制出干净 workspace/，此时只有 service.py + __init__.py，没有 formatters.py）
2. 把上面两段参考实现分别落到 `workspace/formatters.py`（新建）和 `workspace/service.py`（整段覆盖）
3. `cd C20-refactor-extract-module && python verify.py` → 必须 PASS（退出码 0），9 项全 `[✓]`
4. 若 FAIL，对照 verify 输出的 `[✗]` 行修正
5. 验证后回 `challenges/` 跑 `./reset.sh` 复位 → 再跑一次 `python verify.py` 确认**干净 seed 会 FAIL**
   （此时 `formatters` 不可导入、service.py 仍含 `def _format_*`，至少 6 项 `[✗]`）——这验证题目有区分度
6. 最后再 `./reset.sh` 一次把 workspace/ 留在干净 seed 状态（workspace/ 不入库，由 .gitignore 排除）
