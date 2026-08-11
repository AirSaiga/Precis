/**
 * C22 seed — 含 3 处双重断言（escape-hatch cast），需用类型守卫替换。
 * 行为不能变（这是 refactor，不是改语义）。
 *
 * 三种模式对应 Precis 真实代码：
 *   模式 1 → frontend/src/main.ts:58
 *            （window 全局对象 cast）
 *   模式 2 → frontend/src/components/layout/InspectorPanel.vue:49
 *            （discriminated union 的 data cast）
 *   模式 3 → frontend/src/components/canvas/SubCanvasModal.vue:107
 *            （组件对象 cast）
 */

// ── 模式 1：window 全局对象 cast ───────────────────────────────
export function getCrystalStores(): Record<string, unknown> | null {
  const w = window as unknown as Record<string, unknown>
  return w.__CRYSTAL_STORES__ ?? null
}

// ── 模式 2：discriminated union 的 data cast ───────────────────
interface StringNode { type: 'string'; data: unknown }
interface NumberNode { type: 'number'; data: unknown }
type AnyNode = StringNode | NumberNode

export function getDataAsString(node: AnyNode): string {
  const data = node.data as unknown as Record<string, unknown>
  // 行为：data 有 .value 字符串字段就返回它，否则返回 '[empty]'
  return typeof data.value === 'string' ? data.value : '[empty]'
}

// ── 模式 3：组件对象 cast ──────────────────────────────────────
interface SpecificComponent { type: string; render: () => string }
interface GenericComponent { render: () => string }

const myComponent: SpecificComponent = { type: 'input', render: () => 'rendered' }

export function makeNode(): { component: GenericComponent } {
  // 双重断言：TS 认为 SpecificComponent 与 GenericComponent 不直接兼容（其实结构兼容）
  const c = myComponent as unknown as GenericComponent
  return { component: c }
}
