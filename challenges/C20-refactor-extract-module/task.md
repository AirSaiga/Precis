# C20-refactor-extract-module — 提取 formatters 模块（处方式重构）

| 项 | 值 |
|----|-----|
| ID | C20 |
| 维度 | refactor（重构与代码质量） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

`workspace/service.py`（约 80 行）含一个 `UnifiedValidationService` 主服务类，**外加** 4 个内聚的
`_format_xxx` 私有辅助函数（错误 dict 格式化）。这复刻了真实文件
`backend/app/shared/services/validation/service.py` 的结构（同样是"一个服务类 + 一组格式化辅助 +
注册"）。这 4 个 formatters 与服务类的核心职责无关，本该住在自己的模块里。

> 为什么是"处方式（prescriptive）"题：自由形式的"把代码重构好"无法客观打分——审稿人可能
> 对"好"有不同审美。本题把可量化目标钉死为"提取恰好这 4 个具名函数到新模块"，使 verify 能机械
> 判定对错。

**先读 `workspace/service.py`**，确认：

- 4 个 `_format_xxx` 函数（`_format_not_null_error` / `_format_unique_error` /
  `_format_range_error` / `_format_foreign_key_error`）在文件顶部、互相内聚（都是错误 dict 构造器）。
- `UnifiedValidationService` 类的 `validate_not_null` / `validate_unique` 两个方法调用了其中两个
  formatter。

## 任务（PRESCRIPTIVE —— 精确到符号名）

1. **新建 `workspace/formatters.py`**，包含这 4 个函数：
   `_format_not_null_error`、`_format_unique_error`、`_format_range_error`、`_format_foreign_key_error`
   （**逐字从 `service.py` 搬过来，但改成公开——去掉前导下划线**：`format_not_null_error` 等）。
2. **修改 `workspace/service.py`**：
   - **删掉**这 4 个函数定义；
   - **import** 它们：`from formatters import format_not_null_error, format_unique_error, format_range_error, format_foreign_key_error`；
   - **更新** `UnifiedValidationService` 里的调用点，改用新的公开名。
3. **行为必须完全不变**（verify 会跑行为测试）。

### 规格

- **新建文件**：`workspace/formatters.py`（4 个公开函数，函数体逐字搬运、只去掉前导下划线）。
- **修改文件**：`workspace/service.py`（删 4 个 `def _format_*`、加 `from formatters import ...`、改 2 处调用点）。
- **不可改的东西**：
  - `UnifiedValidationService` 类名、方法名、方法签名。
  - 4 个函数的**函数体逻辑**（只允许：去前导下划线改名、搬位置；return 的 dict 字面量一字不改）。

### 约束（务必遵守）

- 只新建 `workspace/formatters.py` 和改 `workspace/service.py`，**不要动其它文件**。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不重命名 `UnifiedValidationService` 类；不改方法签名。
- 不改函数体逻辑（参数顺序、dict 的键值、f-string 文案都保持原样）。
- 不引入任何第三方依赖。

### 提示

- 这 4 个函数正好是 `service.py` 顶部以 `_format_` 开头的那些。
- 搬动时去掉前导 `_`——它们成为 `formatters.py` 的公开 API。
- 更新 `UnifiedValidationService.validate_not_null` / `.validate_unique` 里的 2 处调用点。
- **关键决策点**：函数在 `formatters.py` 里变成 `format_*`（公开），但调用点你可以直接用公开名，
  也可以别名——只要行为一致就行。verify 只看行为 + 文本特征（`from formatters import` 字样、
  `service.py` 里不再有 `def _format_*`），不关心你调用点是直呼公开名还是 `as` 别名。
- 由于 `verify.py` 把 `workspace/` 加进了 `sys.path`，`from formatters import ...` 能直接解析到
  `workspace/formatters.py`，无需建包。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。共 9 项检查（formatters 可导入 + 4 函数存在 + service 不含旧 def ×2 +
service 含 import + 服务可导入 + 行为不变 + formatters 独立可用）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
