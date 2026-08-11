# C23-refactor-extract-composable — 提取 useCounter 组合式函数

| 项 | 值 |
|----|-----|
| ID | C23 |
| 维度 | refactor（重构与代码质量） |
| 栈 | TS（JS `.vue`） |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

`workspace/` 里有一个自包含的 Vue 3 单文件组件 `Counter.vue` 和一个示例 composable `useModal.js`。

`Counter.vue` 的 `<script setup>` 里**混着两组内聚但彼此独立的逻辑**：

- **计数器逻辑**（`count` ref + `double` computed + `increment`/`decrement` 方法）
- **模态框逻辑**（`isVisible` ref + `openModal`/`closeModal`）

在真实的 Precis 项目里，大型 `.vue` 组件的 `<script setup>` 常常把多组内聚逻辑混在一起（见 `frontend/src/components/` 下诸多组件）。重构时会把每组内聚逻辑按"状态 + 操作"的边界提取成 `useXxx()` 组合式函数（composable），让 `.vue` 只负责把它们组合起来。`useModal.js` 就是这套约定的范例：`useXxx` 命名、内部 `import { ref } from 'vue'`、返回对象暴露 `{ 状态, 方法 }`，调用方解构使用。

本题的任务：把 `Counter.vue` 里的**计数器逻辑**提取成一个独立的 `useCounter()` composable，照搬 `useModal` 的模式；**模态框逻辑保留在 `.vue` 里不动**。

**先读 `workspace/useModal.js` 和 `workspace/Counter.vue`**，理解 composable 的写法和待提取的逻辑。

## 任务（处方式 / PRESCRIPTIVE）

> 本题是**处方式抽取**（不是自由重构）：下面精确规定了要建什么文件、抽哪些符号、`.vue` 如何引用。这样 verify 才能做客观静态检查。自由重构无法客观评分。

### 1. 新建 `workspace/useCounter.js`

导出一个 `useCounter()` 函数，内部：

- `import { ref, computed } from 'vue'`
- 创建 `const count = ref(0)`
- 创建 `const double = computed(() => count.value * 2)`
- 定义 `function increment() { count.value++ }`
- 定义 `function decrement() { count.value-- }`
- `return { count, double, increment, decrement }`

（完全照搬 `useModal.js` 的骨架：`export function useXxx() { ... return { ... } }`。）

### 2. 修改 `workspace/Counter.vue` 的 `<script setup>`

- **删除**计数器逻辑的 4 个定义（`count` / `double` / `increment` / `decrement`）。
- **新增** `import { useCounter } from './useCounter'`。
- **解构**调用：`const { count, double, increment, decrement } = useCounter()`。
- **保留**模态框逻辑（`isVisible` / `openModal` / `closeModal`）原样不动。
- **保留** `defineExpose({ count, double, increment, decrement, isVisible, openModal, closeModal })` 不变（解构出来的 `count` 等仍是合法引用，可直接 expose）。
- **更新** `import { ref, computed } from 'vue'` 这一行：`.vue` 里只剩模态框逻辑用到 `ref`（`ref(false)`），`computed` 已随 `double` 迁出，应从该 import 中去掉。

### 3. `<template>` 完全不改

`<template>` 里继续用 `{{ count }}` / `{{ double }}` / `increment` / `decrement` / `isVisible` / `openModal` / `closeModal`——解构出来的变量在模板里照常可见。

## 约束（务必遵守）

- 只能新建 `workspace/useCounter.js` 和编辑 `workspace/Counter.vue`。
- 不碰 `seed/useModal.js`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- `<template>` 保持原样。
- 保持纯 JS `.vue`（不要改成 TS、不要引入编译依赖）。

## 提示

- 先看 `workspace/useModal.js`：函数名 `useXxx`、内部 `import`、`return` 一个对象暴露状态 + 方法——`useCounter` 照着这个骨架写即可。
- composable 拥有 `ref`/`computed` 的**所有权**；`.vue` 只解构它的返回值，不要在 `.vue` 里再 `ref`/`computed` 一遍。
- **关键决策点**：抽取后 `Counter.vue` 的 `import from 'vue'` 只该留模态框逻辑还需要的。模态框用 `ref(false)`，所以保留 `ref`；`computed` 已经跟着 `double` 搬走了，`.vue` 不再需要它，应从 import 中去掉（否则就是无用 import）。
- `defineExpose` 不用动：解构出的 `count`/`double`/`increment`/`decrement` 仍是 `.vue` 作用域里的合法标识符，可以继续 expose。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。16 项静态检查（只读源文件文本，不跑 tsc、不渲染 Vue）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
