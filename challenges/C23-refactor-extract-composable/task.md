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

`workspace/` 里有一个自包含的 Vue 3 单文件组件 `Counter.vue`，外加一个示例 composable
`workspace/useModal.js`。

`Counter.vue` 的 `<script setup>` 里**混着两组内聚但彼此独立的逻辑**：计数器逻辑（`count` ref +
`double` computed + `increment`/`decrement` 方法）与模态框逻辑（`isVisible` ref + `openModal`/
`closeModal`）。在真实 Precis 项目里，大型 `.vue` 组件的 `<script setup>` 常这样把多组内聚逻辑
混在一起；重构时会把每组内聚逻辑按"状态 + 操作"边界提取成 `useXxx()` 组合式函数，让 `.vue` 只负责
组合。`useModal.js` 就是这套约定的范例：`useXxx` 命名、内部 `import { ref } from 'vue'`、返回对象
暴露 `{ 状态, 方法 }`，调用方解构使用。

## 任务

把 `Counter.vue` 里的**计数器逻辑**（`count` / `double` / `increment` / `decrement` 这一组）
提取成一个独立的 `useCounter(initial = 0)` composable，照搬 `useModal.js` 的写法；`.vue` 改为
import 并使用它（**显式调用 `useCounter(0)`**——0 就是 seed 现状的初始值）。
**模态框逻辑（`isVisible` / `openModal` / `closeModal`）保留在 `.vue` 里不动**。

具体怎么建文件、`.vue` 里怎么引用、`ref`/`computed` 的 import 该怎么随之调整，**自己照着
`useModal.js` 的模式决定**——composable 拥有它用到的 `ref`/`computed` 的所有权，`.vue` 只解构
返回值。

### 规格

- **新建文件**：`workspace/useCounter.js`（导出 `useCounter()` 函数）。
- **修改文件**：`workspace/Counter.vue` 的 `<script setup>`（`<template>` 完全不改）。
- **初始值参数**：`useCounter` 的签名必须是 `useCounter(initial = 0)`——接受初始值参数、
  缺省为 0。`count` 必须初始化为 `ref(initial)`（**不是**硬编码 `ref(0)`），`double` 由
  `count` 派生（`initial` 为 5 时 `count` 为 5、`double` 为 10；verify 会**剥掉 import 后
  真实执行** `useCounter(5)` 断言这一点，参数形同虚设的实现过不了）。
- **调用点显式传 0**：`Counter.vue` 里必须是 `useCounter(0)`（显式写出初始值，与 seed 行为
  完全一致），不允许裸 `useCounter()`。
- **不可改的东西**：`<template>`、`defineExpose` 暴露的名字集合、模态框逻辑。
- **保持纯 JS `.vue`**（不要改成 TS、不要引入编译依赖）。

### 约束（务必遵守）

- 只能新建 `workspace/useCounter.js` 和编辑 `workspace/Counter.vue`。
- 不碰 `seed/useModal.js`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- `<template>` 保持原样。
- 不要把模态框逻辑也抽走（只抽计数器那一组）。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 分两层：
**静态检查**（只读源文件文本）：`useCounter.js` 存在且符合 composable 约定（含
`useCounter(initial = 0)` 签名、`count = ref(initial)`）、`Counter.vue` 引用并解构
`useCounter(0)`（import 允许跨行书写）、计数器逻辑已从 `.vue` 移除、模态框逻辑保留、
`<template>` 与 seed **逐字一致**（完全不可改）；
**动态检查**（剥掉 `import`/`export`、注入最小 `ref`/`computed` 桩后真实执行）：`useCounter(5)`
的 `count` 为 5、`double` 为 10，increment/decrement 正常工作，`useCounter()` 缺省为 0。
详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
