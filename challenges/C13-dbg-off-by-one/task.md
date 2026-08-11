# C13 — 修复校验辅助函数

| 项 | 值 |
|------|-----|
| ID | C13 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Python ≥3.12 + pandas |

## 背景

`workspace/validators.py` 里有 3 个校验辅助函数，是 Precis 后端校验代码常见缺陷模式的简化版。

## 症状

3 个函数各有缺陷 —— 每个对某些输入会产生错误结果（有的返回值恒为空、有的漏检、有的直接抛异常）。修复全部 3 个，使行为与各自 docstring 描述的契约一致，让 verify 通过。

涉及函数（签名不可改）：

- `validate_range(values, min_val, max_val) -> list[int]`
- `find_first_null(series) -> int | None`
- `count_violations(errors, severity="error") -> int`

每个函数的 docstring 写明了期望行为（契约）。对照契约与 verify 反馈，定位并修复缺陷。

## 约束

- 只改 `workspace/validators.py`。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不新增函数、不改函数签名（参数名 / 顺序 / 默认值 / 返回类型）、不引入外部依赖（只用 Python 标准库 + pandas）。
- 不要在模块顶层写 `print("PASS")` / `sys.exit(0)` 之类——verify 会重定向 import 期间的 stdout 并扫描 `PASS`/`FAIL`/`[✓]`/`[✗]` 关键字，发现即判作弊。

## 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。4 项检查（模块可导入 + 每个函数一项）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
