---
challenge: C01-nav-add-maxlength
agent: deepseek-v4-flash
runner: ZCode
verify_exit_code: 0
started: 2026-08-12T00:00:00Z
finished: 2026-08-12T00:05:00Z
---

## verify 输出

```
PASS
  [✓] maxlength_constraint.py 存在
  [✓] MaxLengthConstraint 可导入
  [✓] MaxLengthConstraint 继承自 Constraint
  [✓] __init__ 签名为 (table, column, max_length)
  [✓] 表不存在 → ConstraintConfigError
  [✓] 列不存在 → ConstraintConfigError
  [✓] 全合规数据 → errors 为空
  [✓] 超长值 → MaxLengthViolation，row_index/value 正确
  [✓] None/NaN 值被正确跳过（不报错）
  [✓] NaN 值被正确跳过
  [✓] 多行超长 → 每行各一条 error
  [✓] error 字典含 max_length 字段（值为配置值）
  [✓] info.constraint_type == MaxLengthConstraint
  [✓] __init__.py 的 __all__ 含 MaxLengthConstraint
  [✓] row_index 为 pandas 索引标签（非位置序号）
```

## 改动摘要
- 新增 `workspace/app/shared/domain/constraints/maxlength_constraint.py`：实现 `MaxLengthConstraint(table, column, max_length)`，继承 `Constraint`；表/列不存在报 `ConstraintConfigError`；遍历列值，None/NaN 跳过，`len(str(value)) > max_length` 报 `MaxLengthViolation`（含 `max_length` 字段，`row_index` 取 pandas 索引标签）；info 走基类 `get_constraint_info()`。
- `workspace/app/shared/domain/constraints/__init__.py`：加 import 行 + `__all__` 条目。

## 遇到的困难 / 备注
无。参照 not_null.py 结构实现，一次通过 15 项检查。
