# C01 — 新增 MaxLength 约束

| 项 | 值 |
|------|-----|
| ID | C01 |
| 维度 | nav + inc |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-20 分钟 |
| 依赖 | Python ≥3.12、pandas |

## 背景

workspace 是 Precis 约束系统的精简副本。约束继承自 `Constraint` 基类（`workspace/app/shared/domain/constraints/base.py`），实现 `validate(datasets)` 方法返回 `{"errors": [...], "info": {...}}`。系统里已有约束实现可供参考——自己找。

## 任务

实现一种新的 `MaxLengthConstraint`，限制某列值的最大字符长度。

- **类名**：`MaxLengthConstraint`
- **构造参数**：`table`（表名）、`column`（列名）、`max_length`（最大字符数，int）
- **文件**：`workspace/app/shared/domain/constraints/maxlength_constraint.py`
- 在 `__init__.py` 注册使其可从包导出

其余设计（校验逻辑、错误格式、边缘情况处理）**自行决定**。verify 只测行为，不查内部实现。

## 约束

- 只改 workspace/ 内文件。
- 不碰 seed/、verify.py、task.md。

## 验证

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 会构造各种数据测你的约束行为——含一些不那么明显的边缘情况。
