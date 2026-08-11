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

`workspace/formatters.py` 里有 4 个私有格式化/校验辅助函数——它们的函数体逻辑完整、能正常运行，
但全部缺少类型注解（参数和返回值都没标）。这是脱敏自真实文件
`backend/app/shared/services/validation/service.py` 的自包含纯逻辑版本。

## 任务

给 `workspace/formatters.py` 里**全部 4 个函数**补上完整的类型注解：每个参数 + 返回值都要标注。
函数名、函数体逻辑、签名形状都不许改——只加注解。

具体要标什么类型、返回值是什么，**自己读函数体倒推**（看它访问了哪些属性、return 了什么字面量）。

### 规格

- **文件**：`workspace/formatters.py`（只改这一个文件）
- **顶部必须加** `from __future__ import annotations`（以及必要的 `typing` 导入）。
- **4 个函数**的名字、参数顺序、函数体逻辑均不可改，只加注解。
- **行为必须保持不变**：verify 会跑行为测试，改了函数体逻辑会失败。

### 约束（务必遵守）

- 只改 `workspace/` 内文件（本题只有 `workspace/formatters.py` 一个文件）。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入任何第三方依赖（不要 `import pandas`——参数用鸭子类型，`typing.Any` 足够）。
- 不要过度设计（无需为鸭子类型参数专门定义 `Protocol`）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 既检查"每个函数都有完整注解"，也跑行为测试确保功能不变。
详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
