# C10-inc-add-constraint-node — 加新约束节点 NotBlank（多文件注册）

| 项 | 值 |
|----|-----|
| ID | C10 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | TS |
| 难度 | ★☆☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

workspace 里有 5 个自包含的 TypeScript 文件，对应真实 Precis 约束系统的多个注册位点。现有约束 **NotNull** 已经在全部 5 个文件里登记完毕，作为模板。这些文件彼此独立（无 import 依赖），但通过同一个 `kind` 标识符和三层命名约定（`nodeType` / `kind` / `v2Type`）串成一个完整的约束类型。

新增一个约束类型必须同时改动这些注册处，缺一不可。**先读全部 5 个文件**，理解 NotNull 是怎么在每处登记的、三层命名是怎么对齐的。

## 任务

新增一个约束 **NotBlank**——校验字符串列**不能为空或纯空白**（`''`、`'   '`、`'\t\n'` 等都算不通过）。它和 NotNull 不同：NotNull 只拒绝 `null`/`undefined`，NotBlank 额外拒绝空串与纯空白串。

- **约束名**：NotBlank
- 在全部 5 个文件里，照 NotNull 的模式把 NotBlank 登记齐全——每处该怎么注册、命名怎么对齐，**自己从 NotNull 的现有登记里归纳**。verify 只做静态文本检查，确认 NotBlank 在该出现的地方都出现了、命名一致、且没破坏 NotNull。

## 约束

- 只改 `workspace/` 内的 5 个文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。
- 改动是 **additive**：保留 NotNull 的全部登记，只新增 NotBlank。

## 验证

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 只读源文件文本做正则匹配，不跑 tsc、不执行 agent 代码。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
