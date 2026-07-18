# C01 — 新增 MaxLength 约束

| 项 | 值 |
|----|-----|
| ID | C01 |
| 维度 | nav（代码库导航）+ inc（增量开发） |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-20 分钟 |
| 依赖 | Python ≥3.12、pandas |

## 背景

本 `workspace/` 是 Precis 项目约束系统的精简副本。所有约束都继承自 `Constraint` 抽象基类（见 `workspace/app/shared/domain/constraints/base.py`），实现 `validate(datasets)` 方法返回 `{"errors": [...], "info": {...}}`。

参考实现：`workspace/app/shared/domain/constraints/not_null.py`（NotNull 约束，结构同构）。

**先读 `base.py` 和 `not_null.py`**，理解：
- `Constraint` 基类的抽象方法签名
- `get_constraint_info()` 如何从 `self.table` 和 `self._get_description()` 生成 info
- 错误字典的标准格式（`error_type` / `table` / `row_index` / `column` / `value` / `message`）

## 任务

新增一种约束 `MaxLengthConstraint`，限制字符串列的最大字符长度。

### 规格

- **类名**：`MaxLengthConstraint`
- **构造**：`__init__(self, table: str, column: str, max_length: int)`
- **文件**：`workspace/app/shared/domain/constraints/maxlength_constraint.py`
- **行为**：
  - 表不存在 → 加一条 `error_type: "ConstraintConfigError"` 错误，返回
  - 列不存在 → 同上
  - 对该列每个值：
    - 值为 `None` 或 `NaN` → **跳过**（空值归 NotNull 管，本约束不管）
    - `len(str(value)) > max_length` → 加一条 `error_type: "MaxLengthViolation"` 错误
- **违规错误格式**：
  ```python
  {
      "error_type": "MaxLengthViolation",
      "table": <表名>,
      "row_index": <行索引, int>,
      "column": <列名>,
      "value": <原值>,
      "max_length": <配置的 max_length>,
      "message": "<人类可读描述>",
  }
  ```
- **info**：通过 `self.get_constraint_info()` 获取（基类已实现，会自动包含 `constraint_type` / `table` / `description`）。
- **在 `__init__.py` 注册**：新增 import 行 + 在 `__all__` 列表中加入 `"MaxLengthConstraint"`。

  > 注意：本 workspace 的 `__init__.py` 是**精简版**（只 import 了 `base` 和 `not_null`），不是真实仓库的完整版。直接在这个精简版上加一行 import 和一个 `__all__` 条目即可。

### 约束（务必遵守）

- 只改 `workspace/` 内文件。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 关注 `not_null.py` 第 153-154 行如何处理 object dtype——本题不需要这种特殊处理，但展示了 pandas 列操作的范式。
- 关注 `not_null.py` 如何遍历 `df[is_null].index` 生成多条错误——本题需要类似遍历。
- **关键决策点**：`None`/`NaN` 要跳过（不报错），不要照抄 NotNull 的空值检测逻辑。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。14 项检查详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
