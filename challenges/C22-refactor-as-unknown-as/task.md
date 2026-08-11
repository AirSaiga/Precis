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

本 `workspace/` 里有一个自包含的 TypeScript 文件 `workspace/code.ts`，定义了 3 个导出函数。每个函数里都有一处 `as unknown as` 双重断言——这是 TypeScript 里绕过类型检查的"逃生舱"。

在真实的 Precis 项目里，前端用 ESLint 规则 `no-restricted-syntax`（selector `TSAsExpression[expression.type="TSAsExpression"]`，warn 级）追踪这种双重断言，`frontend/package.json` 的 `lint:check` 用 `--max-warnings=312` 做增量门控。目标是逐步清零。

**先读 `workspace/code.ts`**，理解三种模式：

- **模式 1**（`getCrystalStores`）：把 `window` 双重断言成 `Record<string, unknown>` 再读 `__CRYSTAL_STORES__`。对应真实代码 `frontend/src/main.ts:58`。
- **模式 2**（`getDataAsString`）：把 discriminated union 节点的 `data: unknown` 双重断言成 `Record<string, unknown>` 再取 `.value`。对应 `frontend/src/components/layout/InspectorPanel.vue:49`。
- **模式 3**（`makeNode`）：把一个具体组件类型双重断言成通用组件类型。对应 `frontend/src/components/canvas/SubCanvasModal.vue:107`。

## 任务

把 `workspace/code.ts` 里**全部 3 处** `as unknown as` 双重断言替换为正确的类型守卫（`typeof`、`in`）或类型声明（`declare global` / 单层 `as` / 直接删除冗余断言）。**只有 `as unknown as` 被禁止；单层 `as X` 是允许的。**

### 规格

- **文件**：`workspace/code.ts`（只改这一个文件）
- **三个导出函数必须保留**，名字与签名不变：
  - `export function getCrystalStores(): Record<string, unknown> | null`
  - `export function getDataAsString(node: AnyNode): string`
  - `export function makeNode(): { component: GenericComponent }`
- **行为约束**：这是 refactor，不是改行为。三个函数的输入→输出映射应保持等价（`getDataAsString` 对 `{ value: 'hi' }` 仍返回 `'hi'`，对其它情况仍返回 `'[empty]'`；以此类推）。
- **类型守卫**：至少引入 2 处真正的类型守卫（`typeof x === ...`、`'key' in obj`、或自定义 `isXxx` 谓词函数）。仅把 `as unknown as` 换成单层 `as` 而不引入守卫，不算合格重构。

### 约束（务必遵守）

- 只改 `workspace/code.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入新的 `import`（保持文件自包含）。
- 不用 `as any as` 之类的变体绕过。

### 提示

- **模式 1（window）**：`window`/`globalThis` 的类型不带字符串索引签名，所以单层 `as Record<...>` 编译不过——这正是当初用双重断言的原因。解法二选一：(a) `declare global { interface Window { __CRYSTAL_STORES__?: ... } }` 增强类型后直接访问；(b) 先 `const w: unknown = globalThis`，再用 `typeof w === 'object' && w !== null && '__CRYSTAL_STORES__' in w` 守卫收窄，最后单层 `as`。
- **模式 2（node.data）**：`data` 是 `unknown`。先 `typeof data === 'object' && data !== null && 'value' in data` 把它收窄成对象，再单层 `as { value: unknown }` 标注，最后 `typeof obj.value === 'string'` 判断。注意：守卫版反而比 seed 更健壮（seed 在 `data` 为 `null` 时会抛错）。
- **模式 3（component）**：`SpecificComponent`（`{ type; render }`）结构上已满足 `GenericComponent`（`{ render }`），双重断言纯属冗余——直接 `return { component: myComponent }` 即可，无需任何 `as`。
- **关键决策点**：单层 `as X` 允许，只有 `as unknown as` 被禁。但仅靠单层 `as` 不算"用类型守卫替换"——verify 会同时检查"`as unknown as` 归零"和"≥2 处类型守卫"。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。8 项静态检查（不跑 tsc、不执行代码）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
