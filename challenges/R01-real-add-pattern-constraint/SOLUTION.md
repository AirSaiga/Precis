# R01 参考答案 — 新增 Pattern 约束

## 核心难点（为什么这题是 ★★★）

约束系统是**分散注册**的，新增一种约束需要接通 **6 个文件**，遗漏任何一个都会导致测试失败：

1. 约束**类实现**（domain 层）
2. domain 约束**包导出**（`constraints/__init__.py`）
3. **兼容层 re-export**（`validation_constraints.py`）—— 注意：主注册表
   `CONSTRAINT_REGISTRY` 的导入路径**指向这个 shim**，而不是直接指向 `constraints/` 包。
   漏掉这一步，`resolve_constraint_class("Pattern")` 会 `getattr` 失败。
4. **类型→类的注册表**（`registry.py` 的 `CONSTRAINT_REGISTRY`）+ 别名 + `get_supported_constraint_types`
5. **类型→构建参数的构建器注册表**（`builders/` 的 `@register_builder`）—— 工厂两段式：
   先查类、再查构建参数，builder 没注册会返回 "不支持的约束类型"。
6. **配置数据模型的类型枚举**（`ConstraintType` Literal）—— 不加则
   `ConstraintFile(type="Pattern")` 被 Pydantic 拒绝，连配置对象都构造不出来。

> 陷阱提示里写的"已有正则约束但没进主注册表"指的是 `RegexConstraint`：
   它存在于 domain 包里，但**不在** `CONSTRAINT_REGISTRY`，所以不能从配置构建。
   照搬它的注册方式会漏掉 3-5 步。

## 需要改动的 6 个文件

### 1. 新建 `backend/app/shared/domain/constraints/pattern.py`

新增 `PatternConstraint(Constraint)` 类：

```python
from __future__ import annotations
import re
from typing import Any
import pandas as pd
from app.shared.domain.constraints.base import Constraint


class PatternConstraint(Constraint):
    def __init__(self, table: str, column: str, pattern: str):
        self.table = table
        self.column = column
        self.pattern = pattern

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        # 表/列缺失 → ConstraintConfigError（与其它约束一致）
        if self.table not in datasets:
            errors.append({"error_type": "ConstraintConfigError", "table": self.table,
                           "column": self.column,
                           "message": f"Pattern 约束失败: 表 '{self.table}' 不在数据集中。"})
            return {"errors": errors, "info": self.get_constraint_info()}
        df = datasets[self.table]
        if self.column not in df.columns:
            errors.append({"error_type": "ConstraintConfigError", "table": self.table,
                           "column": self.column,
                           "message": f"Pattern 约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。"})
            return {"errors": errors, "info": self.get_constraint_info()}
        # 正则语法错误 → 记一条 config 错误，不崩溃
        try:
            regex = re.compile(self.pattern)
        except re.error as e:
            errors.append({"error_type": "ConstraintConfigError", ...,
                           "message": f"Pattern 约束失败: 正则表达式语法错误: {e}"})
            return {"errors": errors, "info": self.get_constraint_info()}
        # 逐行：跳过 None/NaN，re.search 不匹配则记违规
        for row_index, cell_value in df[self.column].items():
            if pd.isna(cell_value) or cell_value is None:
                continue
            s = str(cell_value)
            if regex.search(s) is None:
                errors.append({"error_type": "PatternViolation", "table": self.table,
                               "row_index": int(row_index), "column": self.column,
                               "value": s,
                               "message": f"Pattern 约束冲突: 值 '{s}' 不匹配正则 {self.pattern!r}。"})
        return {"errors": errors, "info": self.get_constraint_info()}

    def _get_description(self) -> str:
        return f"Pattern 约束: {self.table}.{self.column} pattern={self.pattern!r}"
```

关键语义：`re.search`（搜索匹配，可用 `^…$` 锚定全匹配）；空值跳过。

### 2. `backend/app/shared/domain/constraints/__init__.py`

加一行 import 并加入 `__all__`：

```python
from app.shared.domain.constraints.pattern import PatternConstraint
# __all__ 加入 "PatternConstraint"
```

### 3. `backend/app/shared/domain/validation_constraints.py`（关键陷阱）

主注册表指向的就是这个 shim。**必须 import**（否则 `getattr` 找不到名字）：

```python
from app.shared.domain.constraints import (..., PatternConstraint, ...)
```

> **`__all__` 是否要加？** 仓库里有一个硬编码完整性测试
> `tests/unit/test_validation_constraints_imports.py::test_all_listed_in_dunder_all`
> 断言 `validation_constraints.__all__` 等于固定的 13 项集合。本题要求不碰 `tests/`，
> 因此**参考答案刻意不把 `PatternConstraint` 加入该 `__all__`**：
> `resolve_constraint_class` 用 `getattr(module, name)` 解析，只依赖名字绑定在模块命名空间，
> 不依赖 `__all__`，功能完全正常，且不破坏既有测试。
> （在真实 PR 里，应同步更新那个测试的 `expected` 集合。）

### 4. `backend/app/shared/core/project/constraint/registry.py`

三处：

```python
CONSTRAINT_REGISTRY = {
    ...,
    "NotNull": "...NotNullConstraint",
    "Pattern": "app.shared.domain.validation_constraints.PatternConstraint",  # 新增
    "AllowedValues": "...",
    ...,
}

CONSTRAINT_TYPE_ALIASES = {
    ...,
    "pattern": "Pattern",  # 新增别名
    ...,
}

def get_supported_constraint_types():
    return {
        ...,
        "Pattern": "Pattern 约束：字符串值必须匹配正则表达式",  # 新增
        ...,
    }
```

### 5. `backend/app/shared/core/project/constraint/builders/single_column.py`

Pattern 是"单列 + 一个 param"，与 AllowedValues 同构，加一个 `@register_builder`：

```python
@register_builder("Pattern")
def build_pattern(inp: BuilderInput) -> BuilderResult:
    kwargs, error = resolve_single_column(inp)
    if error:
        return {}, error
    kwargs["pattern"] = inp.params.get("pattern", "")
    return kwargs, None
```

（`resolve_single_column` 把 `refs.{table_id, column_id}` 映射成 `table`/`column`。）

### 6. `backend/app/shared/core/project/constraint/types/constraint_file.py`

`ConstraintType` Literal 加入 `"Pattern"`：

```python
ConstraintType = Literal[
    "Unique", "NotNull", "Pattern", "AllowedValues", "ForeignKey",
    "Conditional", "Scripted", "Range", "Charset", "DateLogic", "Composite",
]
```

## 验证记录

- 参考方案就位：`python verify.py` → **PASS**（exit 0），19/19 测试通过。
- 回退方案（clean repo）：`python verify.py` → **FAIL**（exit 1），
  `ModuleNotFoundError: No module named 'app.shared.domain.constraints.pattern'`。
- 全后端单测回归：2964 passed, 0 failed（参考方案不破坏任何既有测试）。
