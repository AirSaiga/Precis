<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C23 SOLUTION — 提取 useCounter 组合式函数

参考实现见下方两个代码块：`workspace/useCounter.js`（新建）和 `workspace/Counter.vue`（仅 `<script setup>` 改动）。

## 关键决策

1. **为什么是处方式（PRESCRIPTIVE）抽取，而不是自由重构**：自由重构的输出形态因人而异（有人把状态放 store、有人用 `reactive` 替代 `ref`、有人改方法名），无法做客观静态检查。处方式抽取精确规定"建哪个文件、抽哪些符号、`.vue` 怎么引用"，verify 才能用正则做客观判定。这也贴近真实 Precis 重构：`useModal` 这类 composable 的命名与返回形状是项目既定约定，重构者要照约定走，而不是自创风格。

2. **模态框逻辑为什么留在 `.vue`**：composable 的提取边界是"内聚的状态 + 操作"。计数器逻辑自成一体（`count` 状态 + `increment`/`decrement` 操作 + `double` 派生），可独立成 `useCounter`。模态框逻辑（`isVisible` + `openModal`/`closeModal`）已经有一份现成的 `useModal.js` 参考，但本题的考察重点是"识别并抽出一组内聚逻辑"，不是"把所有逻辑都抽光"——保留模态框逻辑能验证 agent 不会过度抽取（把不该搬的东西也搬走）。真实项目里这组逻辑后续也常会抽成 `useModal`，但本题刻意只动计数器那一组。

3. **为什么 `.vue` 的 `import from 'vue'` 要去掉 `computed`**：抽取后 `double`（唯一用 `computed` 的地方）搬到了 `useCounter.js`，`.vue` 里只剩模态框逻辑还用 `ref`。留着 `computed` 就是无用 import（真实项目里 ESLint/Prettier 的 `no-unused-vars` 会报，Precis 的 lint-staged pre-commit 也会拦）。`useCounter.js` 那边则**需要** `ref` + `computed` 两个。这是"ref/computed 的所有权随逻辑一起迁移"的直接体现。

4. **`defineExpose` 为什么不用改**：解构出的 `const { count, double, increment, decrement } = useCounter()` 让这四个名字成为 `.vue` 作用域里的合法标识符，`defineExpose({ count, double, increment, decrement, isVisible, openModal, closeModal })` 照原样 expose 即可。expose 的是引用本身，不关心它是 `ref(0)` 还是解构来的——Vue 会照常解包。

5. **composable 拥有 ref/computed 的所有权**：`useCounter` 内部 `import { ref, computed } from 'vue'` 并创建它们，`.vue` 不再 `import`/创建这些。调用方只解构返回值。这是 composable 模式的核心：状态封装在 composable 里，组件只组合、不拥有。

## 参考实现

### `workspace/useCounter.js`（新建）

```javascript
// 计数器组合式函数：封装 count 状态 + double 派生 + increment/decrement 操作。
// 约定照搬 useModal.js：useXxx 命名，返回对象暴露 { 状态, 方法 }。
import { ref, computed } from 'vue'

export function useCounter() {
  const count = ref(0)
  const double = computed(() => count.value * 2)

  function increment() {
    count.value++
  }

  function decrement() {
    count.value--
  }

  return { count, double, increment, decrement }
}
```

### `workspace/Counter.vue`（仅 `<script setup>` 改动，`<template>` 不变）

```vue
<!--
  计数器组件（C23 解）。
  计数器逻辑已提取到 useCounter.js；模态框逻辑保留在 .vue。
-->
<script setup>
import { ref } from 'vue'
import { useCounter } from './useCounter'

// === 计数器逻辑（从 useCounter 解构）===
const { count, double, increment, decrement } = useCounter()

// === 模态框逻辑（保留，不提取）===
const isVisible = ref(false)
function openModal() {
  isVisible.value = true
}
function closeModal() {
  isVisible.value = false
}

defineExpose({ count, double, increment, decrement, isVisible, openModal, closeModal })
</script>

<template>
  <div>
    <p>{{ count }} (×2 = {{ double }})</p>
    <button @click="increment">+</button>
    <button @click="decrement">-</button>
    <button @click="openModal">Open</button>
    <div v-if="isVisible">Modal content<button @click="closeModal">×</button></div>
  </div>
</template>
```

注意 `<script setup>` 第一行从 `import { ref, computed } from 'vue'` 变成了 `import { ref } from 'vue'`——`computed` 已随 `double` 迁入 `useCounter.js`。

**verify 计数自查**：useCounter.js 8 项全过（存在 / `export function useCounter` / vue import 含 ref 且文件含 computed / `count = ref(0)` / `double = computed` / `increment` 函数 / `decrement` 函数 / return 四件套）；Counter.vue 8 项全过（import useCounter / 解构 useCounter() / 不再含 `count = ref(0)` / 不再含 `double = computed` / 仍含 isVisible / 仍含 openModal+closeModal / 仍含 defineExpose / template 仍含 count）→ 16/16 PASS。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 没建 `useCounter.js`，直接在 `.vue` 里保留计数器逻辑 | 检查 1（及所有 useCounter.js 检查）失败 |
| composable 命名不是 `useCounter`（如 `useCounterComposable`、`counter`） | 检查 2（`export function useCounter`）失败 |
| useCounter.js 忘了 `import { ref, computed } from 'vue'`（以为 `.vue` 的 import 会"渗透"过来） | 检查 3 失败——composable 是独立模块，必须自己 import |
| useCounter.js 只 import 了 `ref` 漏了 `computed` | 检查 3 失败（正则要求 import 行含 `ref` **且**文件含 `computed`） |
| useCounter.js 返回对象漏了某个键（如只 return `{ count, increment }`） | 检查 8（return 四件套按序含 count→double→increment→decrement）失败 |
| useCounter.js return 顺序错乱（如 `{ increment, count, ... }`） | 检查 8 失败——正则要求 return 体内 count 在 double 前、double 在 increment 前、increment 在 decrement 前 |
| `.vue` 里 import 路径写错（`from './useCounter.js'` 也行，但 `from './useCounter.ts'` 或缺扩展名指向不存在的文件） | 运行时报错；verify 只查文本含 `import.*useCounter.*from` 不查路径有效性，但本地跑 Vue 会挂 |
| `.vue` 里没解构，而是 `const counter = useCounter()` 然后模板用 `counter.count` | 检查 9（解构 useCounter()）失败；且模板里 `{{ count }}` 也取不到值 |
| `.vue` 里既解构了 useCounter 又保留了原 `const count = ref(0)`（"以防万一"） | 检查 10（不再含 `count = ref(0)`）失败——`count` 被重复声明，行为也会错乱 |
| 把模态框逻辑也一起抽走了（过度抽取） | 检查 12/13（仍含 isVisible / openModal / closeModal）失败 |
| 改了 `<template>`（如把 `{{ count }}` 改成 `{{ counter.count }}`） | 违反约束；检查 15（template 仍含 count）在改错时可能误中，但属违规改动 |
| `import { useCounter }` 写在 `<script setup>` 外面（普通 `<script>` 块） | `.vue` 用了 `<script setup>` 单块，多写一个 `<script>` 块会改变 SFC 结构；正确做法是 import 放在 `<script setup>` 顶部 |
| 在文件里 `console.log('PASS')` 试图影响 verify | 无效——verify 只读源文件文本做正则匹配，不执行 agent 代码 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 `workspace/`：`Counter.vue` = seed、`useModal.js` = 参考、无 `useCounter.js`）。
2. 把上方"useCounter.js（新建）"代码块写到 `workspace/useCounter.js`。
3. 把上方"Counter.vue（仅 `<script setup>` 改动）"代码块整体覆盖到 `workspace/Counter.vue`。
4. `cd C23-refactor-extract-composable && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`，16 项全 `[✓]`）。
5. 再跑 `cd .. && ./reset.sh` 复位（`workspace/Counter.vue` 回到 seed、`workspace/useCounter.js` 被删除）。
6. `cd C23-refactor-extract-composable && node verify.mjs` → 应 FAIL（`useCounter.js 存在` `[✗]`，连带 7 项 useCounter.js 检查失败；`.vue` 里 `count = ref(0)` / `double = computed` 未移除，对应检查也失败）。
7. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净（`workspace/` 不入库，由 reset 生成）。
