<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# X01 SOLUTION — 端到端新增 Precision（小数精度）约束

参考实现 = 后端 6 处 + 前端 8 处 + 双侧 i18n + 2 处测试参考副本同步。下方按文件给出要点与参考代码。

## 三层命名（单一事实源：前端 constraintMeta.ts 的 CONSTRAINT_TYPES）

| 层 | 值 |
|------|-----|
| kind | `precision`（camelCase） |
| nodeType | `precisionConstraint` |
| v2Type / 后端类型名 | `Precision`（PascalCase） |

## 验证语义（核心）

- 逐行：None/NaN 跳过；`Decimal(str(value))` 解析失败 → **非数值违规**；解析成功 →
  `normalize()` 后取 `as_tuple().exponent`，为负时小数位数 = `-exponent`，否则 0；
  `> precision` → 违规。`normalize()` 去除尾随零，保证"整数恒通过"（float 列里的 `3.0`
  视为 0 位小数，而不是 1 位）。
- 违规记录：`error_type: "PrecisionViolation"` + table/row_index/column/value/message。
- 表/列缺失 → `ConstraintConfigError`（与其它约束一致）。
- `precision` 必须 ≥ 0 整数，否则构造时 `ValueError`。

---

## 后端 6 处

### 1. 新建 `backend/app/shared/domain/constraints/precision.py`

```python
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

import pandas as pd

from app.shared.domain.constraints.base import Constraint


class PrecisionConstraint(Constraint):
    """@classdesc 小数精度约束：数值的小数位数不得超过 precision。"""

    def __init__(self, table: str, column: str, precision: int):
        if not isinstance(precision, int) or precision < 0:
            raise ValueError(f"precision 必须是 ≥ 0 的整数，当前值: {precision!r}")
        self.table = table
        self.column = column
        self.precision = precision

    def _get_description(self) -> str:
        return f"精度约束: {self.table}.{self.column} 小数位数 ≤ {self.precision}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        if self.table not in datasets:
            errors.append({"error_type": "ConstraintConfigError", "table": self.table,
                           "column": self.column,
                           "message": f"精度约束失败: 表 '{self.table}' 不在数据集中。"})
            return {"errors": errors, "info": self.get_constraint_info()}
        df = datasets[self.table]
        if self.column not in df.columns:
            errors.append({"error_type": "ConstraintConfigError", "table": self.table,
                           "column": self.column,
                           "message": f"精度约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。"})
            return {"errors": errors, "info": self.get_constraint_info()}
        for row_index, cell_value in df[self.column].items():
            # 空值跳过（与其它约束约定一致）
            if cell_value is None or (isinstance(cell_value, float) and pd.isna(cell_value)):
                continue
            # Decimal(str(value)) 避开浮点二进制表示坑；解析失败 = 非数值违规
            try:
                dec = cell_value if isinstance(cell_value, Decimal) else Decimal(str(cell_value))
            except (InvalidOperation, ValueError, TypeError):
                errors.append({"error_type": "PrecisionViolation", "table": self.table,
                               "row_index": int(row_index), "column": self.column,
                               "value": str(cell_value),
                               "message": f"精度约束冲突: 值 '{cell_value}' 不是有效数值。"})
                continue
            exponent = dec.normalize().as_tuple().exponent
            decimal_places = -exponent if exponent < 0 else 0
            if decimal_places > self.precision:
                errors.append({"error_type": "PrecisionViolation", "table": self.table,
                               "row_index": int(row_index), "column": self.column,
                               "value": cell_value,
                               "message": f"精度约束冲突: 值 {cell_value} 的小数位数 {decimal_places} 超过上限 {self.precision}。"})
        return {"errors": errors, "info": self.get_constraint_info()}
```

### 2. `backend/app/shared/domain/constraints/__init__.py`

加 import 与 `__all__` 项（domain 包的 `__all__` 没有测试锁定，可正常加）：

```python
from app.shared.domain.constraints.precision import PrecisionConstraint
# __all__ 加入 "PrecisionConstraint"
```

### 3. `backend/app/shared/domain/validation_constraints.py`（关键陷阱）

主注册表的导入路径**指向这个 shim**。**必须 import**（否则 `getattr` 找不到名字）：

```python
from app.shared.domain.constraints import (
    ..., PrecisionConstraint, ...
)
```

**`__all__` 不要加！** 仓库既有测试 `tests/unit/test_validation_constraints_imports.py` 硬编码断言
`validation_constraints.__all__` 等于固定 **13 项**集合。`resolve_constraint_class` 用
`getattr(module, name)` 解析，只依赖名字绑定、不依赖 `__all__`——只 import 名字，功能完全正常且
不破坏既有测试。verify 的后端回归门（含该测试）锁死此陷阱，注入测试也直接断言
`"PrecisionConstraint" not in vc.__all__`。

### 4. `backend/app/shared/core/project/constraint/registry.py`

三处：

```python
CONSTRAINT_REGISTRY = {
    ...,
    "Precision": "app.shared.domain.validation_constraints.PrecisionConstraint",  # 新增
}

CONSTRAINT_TYPE_ALIASES = {
    ...,
    "precision": "Precision",  # 新增别名
}

def get_supported_constraint_types():
    return {
        ...,
        "Precision": "精度约束：数值小数位数不超过指定上限",  # 新增
    }
```

### 5. `backend/app/shared/core/project/constraint/builders/single_column.py`

Precision 是"单列 + 一个 param"，与 Range/Charset 同构：

```python
@register_builder("Precision")
def build_precision(inp: BuilderInput) -> BuilderResult:
    """Precision: refs {table_id, column_id}，params {precision}。"""
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    p = inp.params.get("precision", 2)
    kwargs["precision"] = int(p) if p is not None else 2
    return kwargs, None
```

### 6. `backend/app/shared/core/project/constraint/types/constraint_file.py`

`ConstraintType` Literal 加入 `"Precision"`，否则 `ConstraintFile(type="Precision")` 被 Pydantic 拒绝。

---

## 前端 8 处

### 7. `frontend/src/services/constraints/types.ts`

两处联合（漏掉 tsc 不过）：

```ts
export type ConstraintKind = /* ... */ | 'composite' | 'precision'
export type ConstraintNodeType = /* ... */ | 'compositeConstraint' | 'precisionConstraint'
```

### 8. `frontend/src/services/constraints/constraintMeta.ts`

CONSTRAINT_TYPES 加一行（单一事实源）：

```ts
{
  nodeType: 'precisionConstraint',
  kind: 'precision',
  v2Type: 'Precision',
  requireInputHandle: true,
},
```

### 9. `frontend/src/services/constraints/nodeDataBuilder/simpleConstraint.ts`

两处：`buildTypeExtras` 的 case + `SIMPLE_KINDS` 清单：

```ts
case 'precision':
  return { precision: Number(params.precision ?? 2) }

const SIMPLE_KINDS: ConstraintKind[] = [/* ...原 8 项... */, 'precision']
```

### 10. 新建 `frontend/src/services/constraints/validationRegistryHandlers/precisionHandler.ts`

```ts
/**
 * @file precisionHandler.ts
 * @description 小数精度约束验证处理器（行内数据本地校验）
 */
import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'

const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

register({
  kind: 'precision',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const precision = Number(nodeData.precision ?? 2)
    const rows = ctx.inlineRows ?? []
    const names = ctx.inlineColumnNames ?? []
    const colIdx = names.length > 0 ? Math.max(0, names.indexOf(ctx.columnName)) : 0

    const errors: Array<{ row_index: number; error_message: string }> = []
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][colIdx]
      if (raw === null || raw === undefined || raw === '') continue
      const text = String(raw).trim()
      if (!NUMERIC_RE.test(text)) {
        errors.push({ row_index: i, error_message: `值 '${text}' 不是有效数值` })
        continue
      }
      const s = String(Number(text))
      const decimals = s.includes('.') ? s.split('.')[1].length : 0
      if (decimals > precision) {
        errors.push({ row_index: i, error_message: `小数位数 ${decimals} 超过上限 ${precision}` })
      }
    }
    return toResult(errors, rows.length, '小数位数超限')
  },
  resetOnDisconnect: defaultReset,
})
```

### 11. `frontend/src/services/constraints/validationRegistryHandlers/index.ts`

barrel 加 side-effect import（漏掉 register 永不执行）：

```ts
import './precisionHandler'
```

### 12. `frontend/src/types/constraints.ts`

```ts
export interface PrecisionConstraintNodeData extends BaseConstraintNodeData {
  table: string
  column: string
  precision?: number
}
```

### 13. `frontend/src/types/nodes.ts`

**两处**：import 列表加 `PrecisionConstraintNodeData`，`CustomNodeData` 联合加成员
（只加接口、忘加联合成员是最常见漏改，verify 静态检查用"出现 ≥2 次"抓这个）。

### 14. `frontend/src/types/projectV2.ts`

`ConstraintTypeV2` 联合加 `'Precision'`（V2 YAML 落盘类型对）。

---

## 双侧 i18n

### 15. `frontend/src/i18n/locales/zh-CN/constraints.ts`

```ts
precision: {
  name: '小数精度约束',
  description: '限制数值的小数位数不超过指定上限',
},
```

### 16. `frontend/src/i18n/locales/en-US/constraints.ts`

```ts
precision: {
  name: 'Precision Constraint',
  description: 'Limits decimal places to at most the specified precision',
},
```

---

## 测试参考副本同步（任务允许修改 tests/ 的唯一两处）

### 17. `frontend/tests/services/constraints/registryIntegrity.test.ts`

`BACKEND_V2_TYPES` 集合补 `'Precision'`（10 → 11 项，**不得删除既有 10 项**，verify 静态检查锁死）。

### 18. `frontend/tests/services/constraints/validationRegistryCore.test.ts`

`expect(CONSTRAINT_TYPES).toHaveLength(10)` → `toHaveLength(11)`（verify 静态检查要求字面 `toHaveLength(11)`）。

---

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 把 `PrecisionConstraint` 加进 `validation_constraints.__all__` | 回归 `test_validation_constraints_imports.py` 红（__all__ 锁定 13 项）→ 后端回归 `[✗]` |
| 只 import 进 domain 包、漏 import 进兼容层 shim | `resolve_constraint_class("Precision")` → None；工厂报"不支持的约束类型" |
| 忘注册 builder（single_column.py） | `create_constraint` 降级 → 实例残缺，注入测试工厂断言失败 |
| `ConstraintType` Literal 不加 `"Precision"` | `ConstraintFile(type="Precision")` Pydantic 校验失败 |
| 忘加别名 `'precision' → 'Precision'` | `normalize_constraint_type("precision")` 返回原样，注入测试别名断言失败 |
| 忘加 `get_supported_constraint_types` 条目 | 支持类型列表缺失，注入测试断言失败 |
| 前端忘更新 `ConstraintKind`/`ConstraintNodeType` 联合 | tsc 不过（verify 静态检查 `'precision'`/`'precisionConstraint'` 失败） |
| handler 文件建了但 barrel（validationRegistryHandlers/index.ts）没 import | `register()` 永不执行，`handlers` 无 precision，注入测试 `[✗]` |
| 只加接口、忘加 `CustomNodeData` 联合成员 | 节点运行时识别不了；静态检查"出现 ≥2 次"失败 |
| i18n 只加 zh-CN 漏 en-US | 注入测试 en 断言失败；英文界面空白 + i18n 审计红 |
| 参考副本不同步（保持 `toHaveLength(10)` / 不补 BACKEND_V2_TYPES） | 前端回归 `registryIntegrity`/`validationRegistryCore` 红 |
| 为通过参考副本检查删除既有 10 项 v2Type | verify 静态检查"保留 10 项"失败 |
| validate 把非数值当跳过而非违规 | 注入测试 `test_non_numeric_value_flagged` 失败 |
| 小数位数没去尾随零（漏 `normalize()`） | float 列里的 `3.0` 被当 1 位小数，`precision=0` 时"整数恒通过"被破坏（注入测试 `test_precision_zero_flags_any_fraction` 失败） |
| 前端注入测试里没显式 import handler barrel | `register()` 不执行、`handlers` 缺失——但这是**测试**要做的（真实应用经 validationRegistry 聚合入口加载），SOLUTION 的注入测试已含 `import '@/services/constraints/validationRegistryHandlers'` |
| 用浮点运算数小数位（如 `value % 1`）而非 `Decimal(str(value))` | 浮点误差误判（0.29 → 0.289999…） |
| 对非字符串值直接 `value.trim()`（前端 handler） | 数字/其它类型抛 TypeError；先 `String(raw)` |
| 修改了其它测试文件"顺手通过" | 违反题目约束；verify 回归门+静态检查兜底，评阅时也会发现 |

## 出题者自验步骤

1. **主仓库 FAIL 态**（功能未实现时）：`cd challenges/X01-e2e-fullstack-constraint && python verify.py`
   → 首行 `FAIL`，退出码 1；后端注入 `[✗]`（ModuleNotFoundError / 断言失败）、前端注入 `[✗]`、
   参考副本同步 `[✗]`、前端类型接通 `[✗]`；两端回归 `[✓]`（既有测试本来就是绿的）。
   确认：无残留（`backend/tests/unit/test_x01_precision.py` 与 `frontend/tests/test_x01_precision.test.ts`
   均不存在）、`git status` 无 verify 引入的改动。
2. **worktree PASS 态**：
   - `git worktree add --detach D:/Precis/x01-scratch main`
   - 复制挑战目录：`cp -r challenges/X01-e2e-fullstack-constraint D:/Precis/x01-scratch/challenges/`
     （或仅把 verify 需要的测试源复制进 scratch 的对应目录）
   - 共享前端依赖：`cmd //c mklink /J "D:\Precis\x01-scratch\frontend\node_modules" "D:\Precis\Precis\frontend\node_modules"`
   - 在 scratch 按上文 18 处实现 Precision 全链 → `cd challenges/X01-e2e-fullstack-constraint && python verify.py`
     → 首行 `PASS`，全部 `[✓]`。
3. **对抗 1（只做后端）**：scratch 回退前端改动（git checkout 前端文件、恢复两个测试参考副本）
   → verify `FAIL`：前端注入 `[✗]` + 参考副本 `[✗]`（后端两行 `[✓]`）。
4. **对抗 2（i18n 只加 zh-CN）**：补回前端除 en-US 外的全部实现 → verify `FAIL`：前端注入 `[✗]`
   （en-US 条目缺失），其余 `[✓]`。
5. **清理（血泪教训——严格按此顺序）**：
   1. 删除 junction：优先用 PowerShell `Remove-Item -Force "D:\Precis\x01-scratch\frontend\node_modules"`
      （junction 被当目录直接删链接，不穿透）。若用 `cmd /c rmdir`，**必须随后验证 junction 真的
      没了**（`ls <path>` 应报不存在）——实测 Git Bash 里 `cmd /c rmdir` 可能静默变成交互 cmd
      未执行 rmdir，junction 原封不动。
   2. **确认 junction 已删**后才 `git worktree remove --force D:/Precis/x01-scratch`。
   - **绝对禁止**在 junction 尚存时直接 `worktree remove --force`：git 清理 untracked 时会
     **穿透 junction 清空主仓库的 node_modules**（出题自验中已真实发生一次，恢复方式是
     `cd frontend && npm ci`）。事故后务必核对主仓库 `frontend/node_modules/.bin/vitest` 仍在。
   3. 确认主仓库 `frontend/node_modules` 完好、`git worktree list` 无残留。
6. 主仓库 `git status` 干净（仅新增 `challenges/X01-e2e-fullstack-constraint/` 交付物）。

## 验证记录（供复检）

- 参考方案就位（scratch worktree 全链实现）：`python verify.py` → **PASS**（退出码 0），
  后端注入 **28** 项、前端注入 **15** 项全过，后端回归子集（3 文件）、前端回归子集（5 文件）
  与两组静态检查全 `[✓]`。
- 对抗 1（只做后端）：`python verify.py` → **FAIL**（退出码 1），后端两行 `[✓]`，
  前端注入 / 参考副本 / 前端类型 `[✗]`（前端回归仍 `[✓]`，未实现前端的既有测试不受影响）。
- 对抗 2（i18n 只加 zh-CN）：`python verify.py` → **FAIL**（退出码 1），仅前端注入 `[✗]`
  （15 项中恰 2 项失败：en-US 条目与双侧名称差异），其余全 `[✓]`。
- 干净主仓库：`python verify.py` → **FAIL**（退出码 1），后端注入报 ModuleNotFoundError、
  前端注入 15 项断言失败 + 静态检查 `[✗]`，两端回归 `[✓]`（既有测试本就绿），清理后无残留。
