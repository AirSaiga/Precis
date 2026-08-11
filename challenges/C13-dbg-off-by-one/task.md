# C13-dbg-off-by-one — 修复校验辅助函数里的 3 个明显 bug

| 项 | 值 |
|----|-----|
| ID | C13 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Python ≥3.12 + pandas |

## 背景

`workspace/validators.py` 里有 3 个校验辅助函数，每个都有一个**明显且独立**的 bug。
它们是 Precis 后端校验代码里**高频缺陷模式**的简化版：

- **逻辑反转**：把越界的值 `continue` 跳过、合规的留下（validate_range）
- **循环范围 off-by-one**：`range(len(series) - 1)` 漏检最后一个元素（find_first_null）
- **缺失 None 守卫**：调用方传 `None` 时直接 `for ... in None` 崩溃（count_violations）

**先读 `workspace/validators.py`**，理解：

- 每个函数的 docstring 契约（"正确行为"段落讲的是**期望**的行为）
- 每个函数体里 `# BUG:` 注释精确指出了缺陷位置
- 3 个 bug 互相独立，逐个修即可

> 题目刻意在 seed 里把 bug 写得很显眼（docstring 和注释都标了 `BUG:`）—— 本题考的是
> **读契约 + 精确定位 + 最小修复**，不是逆向黑盒调试。别把简单问题搞复杂。

## 任务

修复 3 个函数，使其行为**严格匹配 docstring 契约**：

1. **`validate_range(values, min_val, max_val) -> list[int]`**
   - 闭区间 `[min_val, max_val]`：边界值（正好等于 min_val / max_val）合规
   - 返回**越界**值（`v < min_val` 或 `v > max_val`）的索引列表
   - 当前 bug：逻辑反了，越界值被 `continue` 跳过，返回值恒为 `[]`

2. **`find_first_null(series) -> int | None`**
   - 扫描 series 的**所有**元素（含最后一个），返回第一个空值（`pd.isna` 为真）的索引
   - 没有空值返回 `None`
   - 当前 bug：`range(len(series) - 1)` 漏掉了最后一个元素

3. **`count_violations(errors, severity="error") -> int`**
   - 统计 errors 中 `severity` 字段等于给定值的条目数
   - `errors` 为 `None` 时返回 `0`（不崩溃）
   - 当前 bug：没有 None 守卫，`for err in None` 抛 TypeError

### 规格

- **文件**：`workspace/validators.py`
- **函数签名**：3 个函数的签名（参数名、类型、默认值、返回类型）必须保持不变
- **行为**：见上方任务 1/2/3 的契约

### 约束（务必遵守）

- 只改 `workspace/validators.py`。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不新增函数、不改函数签名、不引入外部依赖（只用 Python 标准库 + pandas）。
- 不要在模块顶层写 `print("PASS")` / `sys.exit(0)` 之类的东西——verify 会重定向 import 期间的
  stdout 并扫描 `PASS`/`FAIL`/`[✓]`/`[✗]` 关键字，发现即判作弊。

### 提示

- 逐个函数修，改完一个就 `python verify.py` 看对应那项检查是否变 `[✓]`。
- **关键决策点（validate_range）**：bug 不在不等号（`v < min_val or v > max_val` 对闭区间
  已经是正确的判断），而在**分支动作**——越界时应该 `out_of_range.append(i)`，而不是
  `continue`。别去改不等号，那不是 bug。
- **关键决策点（find_first_null）**：把 `range(len(series) - 1)` 改回 `range(len(series))`
  即可，循环体里的 `pd.isna(series.iloc[i])` + `return i` 本身没问题。
- **关键决策点（count_violations）**：在函数开头加一行 `if errors is None: return 0`，
  别用 `if not errors`（空列表 `[]` 也 falsy，会被错误地当 None 处理，虽然本题 verify 没测
  空列表，但 `is None` 才是精确的判别）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。4 项检查（含模块可导入 + 每个函数一项）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
