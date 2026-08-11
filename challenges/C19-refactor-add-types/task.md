# C19-refactor-add-types — 给未注解的辅助函数补完整类型注解

| 项 | 值 |
|----|-----|
| ID | C19 |
| 维度 | refactor（重构与代码质量） |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

Precis 后端代码规范（见 [AGENTS.md](../../../AGENTS.md) "Coding Standards / Python 后端"）强制要求：

- **类型注解必须使用**，并用 `from __future__ import annotations` 支持延迟注解
- 行宽 120、双引号、`from __future__ import annotations` 放最前

本 `workspace/formatters.py` 含 4 个私有格式化/校验辅助函数，灵感来自真实文件
`backend/app/shared/services/validation/service.py`（约第 237-292 行的同名函数），但已脱敏成
自包含、纯逻辑的版本（无 `app.*` 依赖，靠鸭子类型访问 `df.columns` / `df[col].tolist()`）。

**先读 `workspace/formatters.py`**，理解：
- 4 个函数各自的输入（`df` / `column` / `kwargs` / `err`）和返回值
- `_conditional_pre_check` 在两种情况下返回字符串，正常返回 `None` → 返回类型是 `str | None`
- 另外三个都返回 dict，且 dict 的值类型多样（字符串、dict、list、int）→ 用 `dict[str, Any]`

## 任务

给 `workspace/formatters.py` 里全部 4 个函数补上**完整的类型注解**（每个参数 + 返回值），
并在文件顶部加上 `from __future__ import annotations`（及必要的 `typing` 导入）。

### 规格

- **文件**：`workspace/formatters.py`（只改这一个文件）
- **4 个函数**（名字、行为、签名均不可改，只加注解）：
  - `_conditional_pre_check(df, column, kwargs)` → 返回 `str | None`
  - `_conditional_error_formatter(err)` → 返回 `dict[str, Any]`
  - `_fk_datasets_builder(df, column, kwargs)` → 返回 `dict[str, Any]`
  - `_scripted_error_formatter(err)` → 返回 `dict[str, Any]`
- **顶部必须加**：
  ```python
  from __future__ import annotations
  from typing import Any
  ```
- **参数类型建议**：
  - `column` → `str`
  - `kwargs` / `err` → `dict[str, Any]`
  - `df` → `Any`（鸭子类型，不要为了注解去 import pandas；也不要过度设计 Protocol，`Any` 足够）
- **行为必须保持不变**：verify 会跑行为测试，改了函数体逻辑会失败。

### 约束（务必遵守）

- 只改 `workspace/` 内文件（本题只有 `workspace/formatters.py` 一个文件）。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入任何第三方依赖（不要 `import pandas` 之类）。

### 提示

- 逐个函数看它访问了什么、返回了什么，倒推类型：
  - `df.columns`（成员访问）、`df[column].tolist()`（下标 + 方法）→ 鸭子类型，标 `Any` 最省事
  - `kwargs.get("enabled") is False` / `err.get("reason", "未知")` → 入参是 `dict[str, Any]`
- `_conditional_pre_check` 有 `return None` 也有 `return f"..."` → 返回类型是联合类型 `str | None`。
- 其余三个函数的 `return` 全是 dict 字面量 → 返回 `dict[str, Any]`。
- **关键决策点**：用 `from __future__ import annotations` 之后，`str | None` / `dict[str, Any]`
  这种写法可以直接用（PEP 604 / PEP 585），无需从 `typing` 导入 `Union` / `Dict`。`df` 标 `Any`
  即可，不要为鸭子类型专门定义 `Protocol`（过度设计）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。共 11 项检查（可导入 + 4 函数 × 2 + future 导入 + 行为不变）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
