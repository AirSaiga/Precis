# C05-nav-dual-registry-barrel — 修复双注册表 barrel 缺失的 side-effect import

| 项 | 值 |
|----|-----|
| ID | C05 |
| 维度 | nav（代码库导航与理解） |
| 栈 | TS |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

本 `workspace/` 里有 4 个自包含的 TypeScript 文件，建模了一个"双自注册注册表"系统——这是真实 Precis 前端约束系统（见主仓库 `AGENTS.md` 的"前端约束系统（双注册表模式）"一节）的精简复现。

两个并行的注册表：

- `builders`：构建约束节点数据（对应真实代码 `frontend/src/services/constraints/nodeDataBuilder/registry.ts`）
- `handlers`：执行约束校验（对应真实代码 `frontend/src/services/constraints/handlerRegistry.ts`）

每个业务模块在**模块顶层**调用 `registerBuilder(...)` 或 `register(...)` 完成"自注册"；但自注册代码不会自己执行，它依赖 barrel 入口 `index.ts` 用 **side-effect import**（裸 `import './xxx'`）把这些模块"拉进来"——import 一个模块就会执行它的顶层代码，从而触发注册。真实代码里的两个 barrel 分别是 `nodeDataBuilder/index.ts` 与 `validationRegistryHandlers/index.ts`。

**先读全部 4 个文件**（`workspace/registry.ts`、`workspace/notNullBuilder.ts`、`workspace/notNullHandler.ts`、`workspace/index.ts`），理解：

- `registry.ts` 维护两个 `Map`（`builders`、`handlers`），导出 `registerBuilder` / `register` 写入函数，以及 `listBuilders` / `listHandlers` 查询函数
- `notNullBuilder.ts` 在模块顶层 `registerBuilder('notNull', ...)` 自注册
- `notNullHandler.ts` 在模块顶层 `register({ kind: 'notNull', ... })` 自注册
- `index.ts` 是 barrel，通过 `import './xxx'` 触发上述自注册

## 任务

**症状**：`notNull` 已经在 `builders` 注册表里（`listBuilders()` 返回包含 `'notNull'`），但**不在** `handlers` 注册表里（`listHandlers()` 返回空数组）。也就是说：builder 注册成功了，handler 注册失败了。

**你的任务**：读完 4 个文件，搞清楚为什么 builder 能注册而 handler 没注册，然后**修复**，使 `notNull` 同时出现在两个注册表里。

### 规格

- **行为**：修复后，逻辑上 `listBuilders()` 应包含 `'notNull'`，`listHandlers()` 也应包含 `'notNull'`（两个注册表都有）。
- **文件**：只改 `workspace/` 内的现有文件。
- **禁止新增文件**：修复就在已有的 4 个文件之一里，不要新建第 5 个文件。

### 约束（务必遵守）

- 只改 `workspace/` 内文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不新增文件（修复在现有文件内完成）。

### 提示

- 追踪执行链：`registerBuilder('notNull', ...)` 这行代码**在哪个文件里**？它是**怎么被触发执行**的（哪个 import 把它所在模块拉了进来）？对比 handler 的 `register(...)`：它在哪个文件里？它**本应**被哪个 import 触发？那个 import 现在是什么状态？
- **关键决策点**：barrel 的精髓在于"注释掉一个 import"会**静默**地禁用对应模块的自注册——没有任何报错，只是那个注册表里悄悄少了一项。找到被禁用的那个 side-effect import，把它重新启用即可。不要把注册逻辑搬到别处——注册逻辑本来就对，只是没被执行。
- 别被"handlers Map 里没有 notNull"误导去改 `registry.ts` 的 `register` 或 `handlers` 本身。问题不在注册表数据结构，而在"注册代码有没有被运行"。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。N 项静态检查（读源文件文本，不跑 tsc、不执行代码）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
