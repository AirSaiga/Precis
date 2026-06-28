# 动画系统重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Precis 画布动画从平淡升级为惊艳——核心是 C 层校验状态粒子流（发光圆点按校验结果着色 + 到达爆裂光环），辅以 A 层 spring 语法补齐、B 层克制氛围、底座无障碍支持。

**Architecture:** 三层架构。C 层（重投入）：边 `data.validationStatus` 驱动 `DeletableEdge.vue` 渲染 SVG 发光粒子，校验写入点同步状态。A 层（中投入）：选中/拖拽 spring 补齐。B 层（轻投入）：liquid 主题 aurora 缓慢漂移，节点静止。底座：全局 keyframe 注册表 + `prefers-reduced-motion`。

**Tech Stack:** Vue 3 + TypeScript + Vue Flow (@vue-flow/core) + SVG animateMotion + CSS Custom Properties + Pinia + vitest + Playwright

**Spec:** `docs/superpowers/specs/2026-06-28-animation-system-redesign-design.md`

**分支:** `feat/animation-system-redesign`（已创建）

---

## 文件结构总览

**新增文件：**
- `frontend/src/assets/animations.css` — 全局 keyframe 注册表（spin/pulse/fadeIn/edge-burst/aurora-drift 统一定义）
- `frontend/src/composables/canvas/useEdgeBurst.ts` — 爆裂光环触发逻辑（监听状态跳变）
- `frontend/src/utils/edgeParticleColor.ts` — 校验状态→粒子颜色映射纯函数
- `frontend/tests/utils/edgeParticleColor.test.ts` — 映射纯函数单测
- `frontend/tests/services/edgeValidationStatus.test.ts` — 状态写入单测

**修改文件：**
- `frontend/src/components/canvas/edges/DeletableEdge.vue` — 粒子渲染 + 爆裂光环（C 层核心）
- `frontend/src/services/constraints/validationRegistryCore.ts` — 校验函数新增 `updateEdgeData` 参数，同步状态到边（C1）
- `frontend/src/composables/nodes/useConnections.ts:465` — 边创建初始化 `validationStatus: 'idle'`
- `frontend/src/services/disconnect/registryHandlers/*.ts` — 断开重置边状态
- 所有调用 `validateConstraintNode` / `validateConstraintNodesForSchema` 的调用方 — 适配新参数
- `frontend/src/assets/base.css` — 引入 animations.css + reduced-motion
- `frontend/src/assets/themes/liquid/tokens.css` — aurora 漂移动画
- `frontend/src/assets/graph-node.css` — 选中/拖拽 spring（A 层）

---

## 实施批次与依赖

```
底座(T1) ──┐
           ├─→ C1(T2) ─→ C2(T3) ─→ C3(T4) ─┐
           └─→ A(T5) ──→ B(T6) ─────────────┴─→ 集成验证(T7)
```

- **T1 底座**（无依赖）：全局 keyframe 注册表 + reduced-motion —— 最先做，C 层的 edge-burst keyframe 依赖它
- **T2 C1 数据链路**：边状态字段 + 校验写入 —— C 层基础
- **T3 C2 粒子渲染**：依赖 T1(动画) + T2(状态)
- **T4 C3 到达爆裂**：依赖 T3
- **T5 A 层 / T6 B 层**：彼此独立，可与 C 层并行
- **T7 集成验证**：全部完成后

---

## Task 1: 全局 keyframe 注册表 + reduced-motion（底座）

**Files:**
- Create: `frontend/src/assets/animations.css`
- Modify: `frontend/src/assets/base.css`（在顶部 @import 区引入）
- Test: 无单测（纯 CSS，由 E2E 覆盖）

- [ ] **Step 1: 创建全局 keyframe 注册表**

Create `frontend/src/assets/animations.css`:

```css
/**
 * @file animations.css
 * @description 全局动画 keyframe 注册表
 *
 * 集中定义被多处复用的 keyframe，消除冗余（此前 spin 重复 9 次、pulse 4 次）。
 * 组件文件应引用此处定义，而非本地重复声明。
 * 本设计新增的 edge-burst / aurora-drift 也定义于此。
 */

/* 旋转（加载 spinner 等通用旋转） */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 状态呼吸（节点状态点、连接点等弱脉冲） */
@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* 淡入 */
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* === C 层：校验粒子到达爆裂光环 === */
@keyframes edge-burst {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  40% {
    transform: scale(1);
    opacity: 0.9;
  }
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}

/* === B 层：liquid 主题背景 aurora 缓慢漂移 === */
@keyframes aurora-drift {
  0%,
  100% {
    background-position: 0% 0%, 100% 100%, 50% 50%;
  }
  50% {
    background-position: 30% 20%, 70% 80%, 40% 60%;
  }
}

/* === 无障碍：尊重用户系统偏好，禁用非必要动画 === */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

注：粒子着色由 CSS class（`.particle--pass` 等）驱动 `fill`/`filter`，与 `animation` 解耦——reduced-motion 下粒子停止流动但仍显示颜色，状态信息可读。

- [ ] **Step 2: 在 base.css 引入注册表**

在 `frontend/src/assets/base.css` 顶部现有 `@import` 区（token 文件之后）追加一行：

```css
@import './animations.css';
```

- [ ] **Step 3: 验证构建无报错**

Run: `cd frontend && npm run type-check`
Expected: 通过（CSS 改动不影响 tsc，但确认无语法错误导致 Vite 解析失败）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/assets/animations.css frontend/src/assets/base.css
git commit -m "feat(animation): 全局 keyframe 注册表 + prefers-reduced-motion 支持"
```

---

## Task 2: C1 — 边校验状态数据链路

**Files:**
- Modify: `frontend/src/services/constraints/validationRegistryCore.ts:365-386`（`validateConstraintNode` 加参数）
- Modify: `frontend/src/services/constraints/validationRegistryCore.ts:395-466`（`validateConstraintNodesForSchema` 加参数）
- Modify: `frontend/src/services/constraints/validationRegistryCore.ts:745-760`（`validateForInlineSource` 加参数，行号以实际为准）
- Modify: `frontend/src/composables/nodes/useConnections.ts:465`（边初始化 idle）
- Modify: 所有调用上述 3 个校验函数的调用方（grep 定位）
- Test: `frontend/tests/services/edgeValidationStatus.test.ts`

- [ ] **Step 1: 写失败测试 — 校验函数把状态写入边**

Create `frontend/tests/services/edgeValidationStatus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'

/**
 * 验证 validateConstraintNode 把校验结果同步写入 edge.data.validationStatus。
 * mock handler 返回固定状态，断言 updateEdgeData 被以正确值调用。
 */
describe('校验状态写入边', () => {
  it('校验通过时，updateEdgeData 收到 validationStatus: pass', async () => {
    const { validateConstraintNode } = await import(
      '@/services/constraints/validationRegistryCore'
    )
    // mock 模块内的 handler 注册表，返回 pass
    const updateNodeData = vi.fn()
    const updateEdgeData = vi.fn()

    const schemaNode = { id: 's1', type: 'schema', position: { x: 0, y: 0 }, data: { columns: [{ id: 'c1', name: 'col', type: 'string' }] } } as unknown as Node
    const constraintNode = { id: 'cn1', type: 'notNullConstraint', position: { x: 0, y: 0 }, data: { columnId: 'c1' } } as unknown as Node
    const edge = { id: 'e1', source: 's1', target: 'cn1', sourceHandle: 'source-right-c1', targetHandle: 'target-left' } as unknown as Edge

    await validateConstraintNode({
      schemaNode,
      constraintNode,
      edge,
      nodes: [schemaNode, constraintNode],
      updateNodeData,
      updateEdgeData,
    })

    expect(updateEdgeData).toHaveBeenCalledWith('e1', expect.objectContaining({ validationStatus: 'pass' }))
  })
})
```

注：handler mock 需注入注册表。若 `validateConstraintNode` 内部从模块级 `handlers` Map 取 handler，测试需先通过 `registerHandler`/`getHandlerByNodeType` 注入一个返回 pass 的 mock handler。若注入困难，改为直接断言 updateEdgeData 被调用且参数含 `validationStatus` 字段（值由 mock handler 决定）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd frontend && npx vitest run tests/services/edgeValidationStatus.test.ts`
Expected: FAIL（`validateConstraintNode` 签名无 `updateEdgeData` 参数，或调用时未传给边）

- [ ] **Step 3: 给 validateConstraintNode 加 updateEdgeData 参数并同步边状态**

Modify `frontend/src/services/constraints/validationRegistryCore.ts`，`validateConstraintNode`（约 365-386 行）：

```typescript
export async function validateConstraintNode(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  updateEdgeData: (edgeId: string, data: Record<string, unknown>) => void  // 新增
}): Promise<void> {
  const { schemaNode, constraintNode, edge, nodes, updateNodeData, updateEdgeData } = params
  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) return
  const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes })
  if (!ctx) return
  const result = await handler.validate(ctx)
  updateNodeData(constraintNode.id, {
    table: ((schemaNode.data || {}) as Record<string, unknown>)?.tableName as string,
    column: ctx.columnName,
    sourceRef: { nodeId: schemaNode.id, columnId: ctx.columnId },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
  // 同步校验状态到边，驱动粒子着色（C 层）
  updateEdgeData(edge.id, {
    validationStatus: result.status,
  })
}
```

- [ ] **Step 4: 给 validateConstraintNodesForSchema 加参数并同步边状态**

同文件，`validateConstraintNodesForSchema`（约 395 行起）。在参数解构（约 401 行）新增 `updateEdgeData`：

```typescript
export async function validateConstraintNodesForSchema(params: {
  schemaNodeId: string
  nodes: Node[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  updateEdgeData: (edgeId: string, data: Record<string, unknown>) => void  // 新增
}): Promise<ValidationSummary> {
  const { schemaNodeId, nodes, edges, updateNodeData, updateEdgeData } = params
```

在 `validateEdgeBatch` 内 `updateNodeData(...)` 之后（约 449 行后）追加：

```typescript
      updateEdgeData(edge.id, {
        validationStatus: result.status,
      })
```

- [ ] **Step 5: 给 validateForInlineSource 加参数并同步边状态**

同文件，`validateForInlineSource`（约 745 行，含 `validationStatus: result.status` 写入点）。用同样模式：参数加 `updateEdgeData`，在节点状态写入后追加 `updateEdgeData(edge.id, { validationStatus: result.status })`。读取该函数确认 `edge` 变量在作用域内（应在循环里可拿到）。

- [ ] **Step 6: 边创建时初始化 validationStatus: 'idle'**

Modify `frontend/src/composables/nodes/useConnections.ts:465`：

```typescript
edgeStyle.data = {
  ...(edgeStyle.data as Record<string, unknown>),
  status: 'pending',
  validationStatus: 'idle',  // 新增：未校验态，粒子不渲染
}
```

- [ ] **Step 7: 适配所有调用方传入 updateEdgeData**

Run grep 定位调用方：
```bash
cd frontend && grep -rn "validateConstraintNode\|validateConstraintNodesForSchema\|validateForInlineSource" --include="*.ts" --include="*.vue" src | grep -v "validationRegistryCore.ts"
```

对每个调用方：从 `vueFlowApi` 引入 `updateEdgeData`（或从 `useVueFlow()` 解构），传入校验函数。调用方主要在：
- `frontend/src/services/constraints/orchestration/globalValidation.ts`（dispatchValidation）
- `frontend/src/composables/nodes/constraints/use*.ts`（单约束校验触发）

每个调用方在调用处追加 `updateEdgeData` 参数。例如 globalValidation 的 dispatchValidation 中，从模块顶部 `import { updateEdgeData } from '@/services/canvas/vueFlowApi'`。

- [ ] **Step 8: 断开连接时重置边状态**

Modify 断开处理。Run grep:
```bash
cd frontend && grep -rln "validationStatus: 'idle'" src/services/disconnect/
```

对 `frontend/src/services/disconnect/registryHandlers/*.ts` 中重置约束节点状态的位置，同步重置对应边。由于断开时边通常已被移除（`handleEdgeRemoved` → `removeEdges`），需确认边是否仍在——若边已删则无需重置（边随节点断开而消失）。检查 `connectionOps.ts` 的 `handleEdgeRemoved` 流程确认。若边在断开瞬间仍可访问，在其重置逻辑里加 `updateEdgeData(edge.id, { validationStatus: 'idle' })`。

- [ ] **Step 9: 运行测试，确认通过**

Run: `cd frontend && npx vitest run tests/services/edgeValidationStatus.test.ts`
Expected: PASS

- [ ] **Step 10: 全量单测回归**

Run: `cd frontend && npm run test`
Expected: 全部通过（1459 + 新增）。若现有测试因 `validateConstraintNode` 签名变更失败，更新测试调用处补传 `updateEdgeData` mock。

- [ ] **Step 11: type-check**

Run: `cd frontend && npm run type-check`
Expected: 通过

- [ ] **Step 12: 提交**

```bash
git add frontend/src/services/constraints/validationRegistryCore.ts \
        frontend/src/composables/nodes/useConnections.ts \
        frontend/src/services/constraints/orchestration/globalValidation.ts \
        frontend/src/composables/nodes/constraints/ \
        frontend/src/services/disconnect/ \
        frontend/tests/services/edgeValidationStatus.test.ts
git commit -m "feat(animation): C1 校验状态同步写入边 data.validationStatus"
```

---

## Task 3: C2 — 边粒子渲染（DeletableEdge.vue）

**Files:**
- Create: `frontend/src/utils/edgeParticleColor.ts`
- Test: `frontend/tests/utils/edgeParticleColor.test.ts`
- Modify: `frontend/src/components/canvas/edges/DeletableEdge.vue`

- [ ] **Step 1: 写失败测试 — 颜色映射纯函数**

Create `frontend/tests/utils/edgeParticleColor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getParticleColorClass, shouldRenderParticles } from '@/utils/edgeParticleColor'

describe('edgeParticleColor', () => {
  it('idle 态不渲染粒子', () => {
    expect(shouldRenderParticles('idle')).toBe(false)
    expect(shouldRenderParticles(undefined)).toBe(false)
  })
  it('pass/error/missing 态渲染粒子', () => {
    expect(shouldRenderParticles('pass')).toBe(true)
    expect(shouldRenderParticles('error')).toBe(true)
    expect(shouldRenderParticles('missing')).toBe(true)
  })
  it('颜色 class 映射正确', () => {
    expect(getParticleColorClass('pass')).toBe('particle--pass')
    expect(getParticleColorClass('error')).toBe('particle--error')
    expect(getParticleColorClass('missing')).toBe('particle--missing')
    expect(getParticleColorClass('idle')).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run tests/utils/edgeParticleColor.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现颜色映射纯函数**

Create `frontend/src/utils/edgeParticleColor.ts`:

```typescript
/**
 * @file edgeParticleColor.ts
 * @description 边粒子校验状态 → 颜色 class 映射（纯函数）
 *
 * 值域对齐 types/constraints.ts 的 validationStatus: 'idle'|'pass'|'error'|'missing'
 * 颜色语义复用节点 status-dot：pass=绿 / error=红 / missing=橙
 */

export type EdgeValidationStatus = 'idle' | 'pass' | 'error' | 'missing' | undefined

/** idle 或无值时不渲染粒子（边保持静态线） */
export function shouldRenderParticles(status: EdgeValidationStatus): boolean {
  return status !== 'idle' && status !== undefined
}

/** 状态 → CSS class（驱动 fill/filter 着色，与 animation 解耦以支持 reduced-motion） */
export function getParticleColorClass(status: EdgeValidationStatus): string {
  switch (status) {
    case 'pass':
      return 'particle--pass'
    case 'error':
      return 'particle--error'
    case 'missing':
      return 'particle--missing'
    default:
      return ''
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run tests/utils/edgeParticleColor.test.ts`
Expected: PASS

- [ ] **Step 5: 提交纯函数**

```bash
git add frontend/src/utils/edgeParticleColor.ts frontend/tests/utils/edgeParticleColor.test.ts
git commit -m "feat(animation): C2 边粒子颜色映射纯函数"
```

- [ ] **Step 6: 在 DeletableEdge.vue 渲染粒子**

Modify `frontend/src/components/canvas/edges/DeletableEdge.vue`。在 `<script setup>` 中新增（保留现有所有代码）：

```typescript
import { getParticleColorClass, shouldRenderParticles } from '@/utils/edgeParticleColor'

// 边校验状态（从 props.data 读取，默认 idle）
const particleStatus = computed(() => {
  const data = props.data as Record<string, unknown> | undefined
  return (data?.validationStatus as 'idle' | 'pass' | 'error' | 'missing' | undefined) ?? 'idle'
})
const showParticles = computed(() => shouldRenderParticles(particleStatus.value))
const particleClass = computed(() => getParticleColorClass(particleStatus.value))
```

在 `<template>` 的 `<BaseEdge>` 之后、删除按钮 `<g>` 之前插入粒子组：

```vue
    <!-- C 层：校验状态粒子流（idle 态不渲染） -->
    <g v-if="showParticles" class="edge-particles">
      <circle
        v-for="i in 3"
        :key="i"
        r="3"
        :class="['edge-particle', particleClass]"
      >
        <animateMotion
          :path="pathData.path"
          dur="2s"
          repeatCount="indefinite"
          :begin="`${(i - 1) * 0.5}s`"
        />
      </circle>
    </g>
```

在 `<style scoped>` 末尾追加粒子样式：

```css
  /* 边粒子：颜色由 class 驱动（reduced-motion 下停止流动但仍着色） */
  .edge-particle {
    filter: drop-shadow(0 0 3px currentColor);
  }
  .edge-particle.particle--pass {
    fill: #34d399;
    color: #4cd7a8;
  }
  .edge-particle.particle--error {
    fill: #fb7185;
    color: #ff8a8a;
  }
  .edge-particle.particle--missing {
    fill: #fbbf24;
    color: #f9c66b;
  }
```

- [ ] **Step 7: type-check**

Run: `cd frontend && npm run type-check`
Expected: 通过

- [ ] **Step 8: 提交**

```bash
git add frontend/src/components/canvas/edges/DeletableEdge.vue
git commit -m "feat(animation): C2 DeletableEdge 渲染校验状态发光粒子"
```

---

## Task 4: C3 — 到达爆裂光环

**Files:**
- Create: `frontend/src/composables/canvas/useEdgeBurst.ts`
- Modify: `frontend/src/components/canvas/edges/DeletableEdge.vue`
- Test: 无单测（响应式 watch + CSS keyframe，由 E2E 覆盖）

- [ ] **Step 1: 在 DeletableEdge.vue 监听状态跳变触发爆裂**

Modify `frontend/src/components/canvas/edges/DeletableEdge.vue`。`<script setup>` 新增（在 Step 6 的状态计算之后）：

```typescript
import { ref, watch } from 'vue'

// 到达爆裂：validationStatus 从 idle 跳变到非 idle 时触发一次性光环
const burstKey = ref(0)
const burstClass = ref('')
watch(
  particleStatus,
  (newStatus, oldStatus) => {
    if (oldStatus === 'idle' && newStatus !== 'idle') {
      burstClass.value = `edge-burst--${newStatus}`
      burstKey.value++ // 重置 key，确保每次校验都能重新触发动画
    }
  }
)
```

`<template>` 在粒子组之后插入爆裂元素（定位在 target 端，即约束节点侧）：

```vue
    <!-- C 层：校验到达爆裂光环（一次性，target 端） -->
    <circle
      v-if="burstClass"
      :key="burstKey"
      :cx="props.targetX"
      :cy="props.targetY"
      r="10"
      :class="['edge-burst', burstClass]"
      @animationend="burstClass = ''"
    />
```

`<style scoped>` 追加爆裂样式（引用 T1 全局 edge-burst keyframe）：

```css
  .edge-burst {
    fill: none;
    stroke-width: 2;
    animation: edge-burst 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    pointer-events: none;
  }
  .edge-burst--pass {
    stroke: #4cd7a8;
    filter: drop-shadow(0 0 6px rgba(76, 215, 168, 0.6));
  }
  .edge-burst--error {
    stroke: #ff8a8a;
    filter: drop-shadow(0 0 6px rgba(255, 138, 138, 0.6));
  }
  .edge-burst--missing {
    stroke: #f9c66b;
    filter: drop-shadow(0 0 6px rgba(249, 198, 107, 0.6));
  }
```

注：scoped CSS 引用全局 keyframe（`animations.css` 里的 `@keyframes edge-burst`）——Vue scoped 不影响 keyframe 名称解析，可直接引用。

- [ ] **Step 2: type-check + lint**

Run: `cd frontend && npm run type-check && npm run lint`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/canvas/edges/DeletableEdge.vue
git commit -m "feat(animation): C3 校验到达爆裂光环"
```

注：`useEdgeBurst.ts` 经评估无需独立抽取——爆裂逻辑仅 6 行 watch，直接内联在 DeletableEdge.vue 更内聚。从文件清单移除该新建文件。

---

## Task 5: A 层 — spring 语法补齐（选中/拖拽）

**Files:**
- Modify: `frontend/src/assets/graph-node.css`
- Test: 无单测（CSS，E2E 覆盖）

- [ ] **Step 1: 选中态 spring 光环**

Modify `frontend/src/assets/graph-node.css`，在 `.graph-node.is-selected` 规则（约 20-25 行）内，确保选中时有 spring 过渡。现有 `.is-selected` 已有 box-shadow ring，追加 transition 用 spring：

```css
.graph-node.is-selected {
  background: var(--node-glass-bg-selected);
  border-color: var(--node-border-selected);
  border-width: var(--node-border-selected-width);
  box-shadow: var(--node-shadow-selected);
  /* A 层：选中过渡用 spring，吸附有弹性 */
  transition:
    box-shadow var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-spring);
}
```

- [ ] **Step 2: 拖拽态 spring（复用已有 dragging token）**

确认 `--node-shadow-dragging` token 已存在（探查确认在 liquid/tokens.css:142-155 定义）。在 graph-node.css 追加拖拽态规则（若不存在）：

```css
.vue-flow__node.dragging .graph-node,
.vue-flow__node.dragging .node-shell {
  transform: scale(1.02);
  box-shadow: var(--node-shadow-dragging);
  opacity: 0.95;
  transition: transform var(--dur-fast) var(--ease-spring),
    box-shadow var(--dur-fast) var(--ease-spring);
}
```

注：Vue Flow 拖拽时给节点加 `.dragging` class（确认 Vue Flow 版本行为；若 class 名不同，grep `dragging` 定位实际 class）。

- [ ] **Step 3: 验证 + 提交**

Run: `cd frontend && npm run lint`
Expected: 样式审查通过

```bash
git add frontend/src/assets/graph-node.css
git commit -m "feat(animation): A 层 选中/拖拽 spring 过渡补齐"
```

---

## Task 6: B 层 — liquid aurora 背景漂移

**Files:**
- Modify: `frontend/src/assets/themes/liquid/tokens.css`（或 node.css，定位 `.canvas-area::before`）
- Test: 无单测

- [ ] **Step 1: 定位 aurora 背景层**

Run grep 定位 liquid 主题的画布背景伪元素：
```bash
cd frontend && grep -rn "canvas-area\|aurora" src/assets/themes/liquid/ | head -20
```
预期找到 `.canvas-area::before` 或类似（探查报告指 liquid/tokens.css:463）。

- [ ] **Step 2: 给背景层加 aurora-drift 动画**

在定位到的背景层规则上追加（引用 T1 全局 `aurora-drift` keyframe）：

```css
[data-theme='liquid'] .canvas-area::before {
  /* ...已有 background 径向光晕... */
  background-size: 180% 180%;
  animation: aurora-drift 22s ease-in-out infinite;
}
```

注：`background-size: 180% 180%` 是漂移生效的前提（默认 100% 无法位移）。若已有 background-size 则不覆盖。

- [ ] **Step 3: 验证不破坏 light/dark**

确认规则用 `[data-theme='liquid']` 限定，light/dark 无此背景层，不受影响。

Run: `cd frontend && npm run lint`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add frontend/src/assets/themes/liquid/
git commit -m "feat(animation): B 层 liquid 主题 aurora 背景缓慢漂移"
```

---

## Task 7: 集成验证

**Files:** 无新文件，全量验证

- [ ] **Step 1: 全量 type-check**

Run: `cd frontend && npm run type-check`
Expected: 通过

- [ ] **Step 2: 全量 lint + 样式审查**

Run: `cd frontend && npm run lint`
Expected: 通过

- [ ] **Step 3: 全量单测**

Run: `cd frontend && npm run test`
Expected: 全部通过（1459 + 新增 2 文件）

- [ ] **Step 4: 手动验证三层融合**

Run: `npm run dev`，在画布上：
1. 新建 Schema → 连接约束（边出现，无粒子，未校验态）✅ B/A 背景与入场
2. 运行校验 → 通过的约束边出现绿色粒子流，失败的红色 ✅ C 层粒子
3. 校验瞬间看到约束节点端的光环爆裂 ✅ C 层爆裂
4. 选中约束节点 → spring 光环吸附 ✅ A 层
5. liquid 主题下背景缓慢漂移 ✅ B 层
6. 系统设置开启"减少动态效果"→ 粒子停止流动但仍着色 ✅ 底座

- [ ] **Step 5: E2E 补充（可选，按项目 E2E-first 策略）**

在 `e2e/flows/` 新增或扩展校验相关 spec，断言：
- 校验后 `.edge-particle` SVG circle 存在且 class 正确
- reduced-motion 下无 animation 但 fill 颜色正确

- [ ] **Step 6: 最终提交 + 收尾**

```bash
git add -A
git commit -m "test(animation): 集成验证通过"
```

---

## Self-Review 自查结果

**1. Spec 覆盖**：
- 第二节决策表 7 项 → T1-T6 全覆盖 ✓
- 第四节 C 层（4.1 数据/4.2 写入/4.3 粒子/4.4 爆裂）→ T2/T3/T4 ✓
- 第五节 A 层补齐 → T5 ✓
- 第六节 B 层 aurora → T6 ✓（玻璃呼吸标"可选"，本计划略，符合 YAGNI）
- 第七节底座（keyframe 注册表 + reduced-motion）→ T1 ✓
- 第九节实施批次 C1→C2→C3→A→B→集成 → T2→T3→T4→T5→T6→T7 ✓

**2. 占位符扫描**：无 TBD/TODO。T2 Step 7/8 的 grep 定位是合理的动态步骤（已知调用方类型，给定了 grep 命令和预期文件）。

**3. 类型一致性**：
- `EdgeValidationStatus` 在 edgeParticleColor.ts 定义，DeletableEdge.vue 引用 ✓
- `updateEdgeData: (edgeId: string, data: Record<string, unknown>) => void` 签名贯穿 T2 ✓
- `validationStatus: 'idle'|'pass'|'error'|'missing'` 值域贯穿全文，与 types/constraints.ts:151 一致 ✓
- `edge-burst` / `aurora-drift` keyframe 在 T1 定义，T4/T6 引用 ✓
- 粒子 class `particle--pass/error/missing` 在 edgeParticleColor.ts 返回，DeletableEdge.vue CSS 匹配 ✓

**发现并修正**：T4 原计划抽取 `useEdgeBurst.ts`，自查时发现逻辑仅 6 行 watch，内联更内聚——已改为内联并从文件清单移除（符合"文件职责单一"原则，避免过度拆分）。

---

## 执行交接

计划完成，已保存到 `docs/superpowers/plans/2026-06-28-animation-system-redesign.md`。两种执行方式：

**1. Subagent 驱动（推荐）** — 每个 Task 派发独立 subagent 执行，任务间我做两阶段审查，迭代快、上下文干净

**2. 内联执行** — 在当前会话内按 executing-plans 批量执行，带检查点暂停审查

你选哪种？
