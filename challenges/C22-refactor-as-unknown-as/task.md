# C22-refactor-as-unknown-as — 清理 `as unknown as` 双重断言

| 项 | 值 |
|----|-----|
| ID | C22 |
| 维度 | refactor（重构与代码质量） |
| 栈 | TS |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

`workspace/code.ts` 是一个自包含的 TypeScript 文件，里面散布着 **`as unknown as` 双重断言**——
TypeScript 里绕过类型检查的"逃生舱"。在真实的 Precis 项目里，前端用 ESLint 规则 `no-restricted-syntax`
追踪这种双重断言，目标是逐步清零（详见 [AGENTS.md](../../../AGENTS.md) "类型安全纪律"）。

## 任务

把 `workspace/code.ts` 里**全部 3 处** `as unknown as` 双重断言替换为正确的类型守卫或类型声明。

具体每处断言该用什么手法替换（`typeof` 收窄、`in` 操作符、自定义 `isXxx` 谓词、`declare global`
增强类型、直接删除冗余断言……），**自己分析每处断言的上下文决定**——没有一刀切的答案。

### 规格

- **文件**：`workspace/code.ts`（只改这一个文件）
- **3 个导出函数必须保留**，名字与签名不变：
  - `export function getCrystalStores(): Record<string, unknown> | null`
  - `export function getDataAsString(node: AnyNode): string`
  - `export function makeNode(): { component: GenericComponent }`
- **行为约束**：这是 refactor，不是改行为。三个函数的输入→输出映射应保持等价。
- **类型守卫要求**：至少引入 2 处真正的类型守卫（`typeof x === ...`、`'key' in obj`、或自定义
  `isXxx` 谓词函数）。仅把 `as unknown as` 换成单层 `as` 而不引入守卫，不算合格重构。

### 约束（务必遵守）

- **只有 `as unknown as` 被禁止；单层 `as X` 是允许的**（`unknown as X` 永远合法）。
- 只改 `workspace/code.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入新的 `import`（保持文件自包含）。
- 不用 `as any as` 之类的变体绕过。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 做纯静态检查（读源文件文本，不跑 tsc、不执行代码）：
`as unknown as` 归零、引入 ≥2 处类型守卫、3 个导出函数仍存在、未引入新 import、未用变体绕过。
详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
