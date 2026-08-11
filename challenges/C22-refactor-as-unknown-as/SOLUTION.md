<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C22 SOLUTION — 清理 `as unknown as` 双重断言

参考实现见下方代码块（直接覆盖 `workspace/code.ts`）。

## 关键决策

1. **只有 `as unknown as` 被禁，单层 `as X` 是允许的**。`unknown as X` 永远合法（`unknown` 是顶层类型，可单向断言到任何类型）。所以"先用类型守卫把 `unknown` 收窄成 object、再单层 `as` 成具体形状"是惯用且合规的写法。不要把单层 `as` 也一起删掉，否则反而丢失了类型标注。

2. **模式 1 用 `typeof + in` 守卫收窄 `unknown`**：`window`/`globalThis` 的类型不带字符串索引签名，单层 `as Record<...>` 编译不过——这正是当初上 `as unknown as` 的原因。参考答案先把全局对象赋给 `unknown`，再用 `typeof w === 'object' && w !== null && '__CRYSTAL_STORES__' in w` 收窄，最后单层 `as Record<string, unknown>` 读属性。行为与 seed 等价（`?? null` 的语义用显式 `!== null && !== undefined` 复刻）。

3. **模式 2 用 `typeof + in` 守卫，反而比 seed 更健壮**：seed 直接把 `null`/非对象断言成 `Record` 再取 `.value`，运行时 `data` 为 `null` 会抛 `TypeError`。守卫版先判断"是对象且含 `value` 键"再访问，`null`/非对象安全落到 `'[empty]'` 分支。对于 refactor 题这是合理的"顺手修潜在 bug"。

4. **模式 3 双重断言纯冗余，直接删**：`SpecificComponent`（`{ type; render }`）结构上已满足 `GenericComponent`（`{ render }`），TS 本就允许直接赋值。`as unknown as GenericComponent` 是历史遗留的逃生舱，删掉后 `return { component: myComponent }` 行为完全一致（`as` 在运行时本就是 no-op）。

## 参考实现

```typescript
/**
 * C22 参考答案 — 清除全部双重断言，改用类型守卫 / 单层 as / 删除冗余断言。
 * 行为与 seed 等价（refactor 不改语义；模式 2 顺手修了 null 访问的潜在抛错）。
 */

// ── 模式 1：全局对象上的属性访问 ──────────────────────────────
// 思路：把 globalThis 视为 unknown，用 typeof + in 守卫收窄后再单层 as 读属性。
export function getCrystalStores(): Record<string, unknown> | null {
  const w: unknown = globalThis
  if (typeof w === 'object' && w !== null && '__CRYSTAL_STORES__' in w) {
    const stores = (w as Record<string, unknown>).__CRYSTAL_STORES__
    // 等价于 seed 的 `?? null`：仅过滤 null/undefined
    return stores !== null && stores !== undefined
      ? (stores as Record<string, unknown>)
      : null
  }
  return null
}

// ── 模式 2：discriminated union 里 unknown 字段的收窄 ──────────
interface StringNode { type: 'string'; data: unknown }
interface NumberNode { type: 'number'; data: unknown }
type AnyNode = StringNode | NumberNode

export function getDataAsString(node: AnyNode): string {
  const data = node.data
  // 用 typeof + in 把 unknown 收窄成 { value: unknown }，再单层 as 标注
  if (data !== null && typeof data === 'object' && 'value' in data) {
    const obj = data as { value: unknown }
    return typeof obj.value === 'string' ? obj.value : '[empty]'
  }
  return '[empty]'
}

// ── 模式 3：本就兼容的类型，断言纯冗余 ─────────────────────────
interface SpecificComponent { type: string; render: () => string }
interface GenericComponent { render: () => string }

const myComponent: SpecificComponent = { type: 'input', render: () => 'rendered' }

export function makeNode(): { component: GenericComponent } {
  // SpecificComponent 结构上已满足 GenericComponent（都有 render），无需任何断言
  return { component: myComponent }
}
```

**verify 计数自查**：双重断言 = 0；类型守卫 typeof=`3`（`w`、`data`、`obj.value`）+ in=`2`（`'__CRYSTAL_STORES__'`、`'value'`）= 5 ≥ 2；3 个 export 保留；import=0；`as any as` 变体=0 → PASS。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只把 `as unknown as X` 换成单层 `as X`，不引入任何守卫 | 检查 3 失败（守卫数 0 < 2）；且模式 1 的 `globalThis as Record<...>` 编译不过（verify 不查编译，但生产代码会红） |
| 模式 1 用 `globalThis as Record<string, unknown>` 单层断言 | TS 编译报错"insufficient overlap"——这正是当初要双重断言的原因；应改用守卫或 `declare global` |
| 模式 2 直接 `node.data as { value: unknown }` 不做 null/对象守卫 | 行为偏离：seed 在 `data` 为 `null` 时抛错，这种写法把 `null.value` 变成 `undefined`（仍不抛但读不到值）。守卫版最稳。检查 3 也可能因守卫不足失败 |
| 删了导出函数或改了函数名 | 检查 4/5/6 失败 |
| 引入 `import`（如 `import type ...`） | 检查 7 失败（题目要求自包含） |
| 用 `as any as`、`as unknown as any` 等变体绕过 | 检查 8（及检查 2）失败 |
| 在文件里 `console.log('PASS')` 试图影响 verify | 无效——verify 只读源文件文本做正则匹配，不执行 agent 代码 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 `workspace/code.ts` = seed）。
2. 把上方"参考实现"代码块整体覆盖到 `workspace/code.ts`。
3. `cd C22-refactor-as-unknown-as && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`）。
4. 再跑 `cd .. && ./reset.sh` 复位（`workspace/code.ts` 回到 seed）。
5. `cd C22-refactor-as-unknown-as && node verify.mjs` → 应 FAIL（检查 2 显示 `as unknown as 当前 3`）。
6. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净。
