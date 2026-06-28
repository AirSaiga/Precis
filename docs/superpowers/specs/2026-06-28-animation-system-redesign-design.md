# 前端动画系统重构设计

> **状态**: 设计已确认，待编写实施计划
> **日期**: 2026-06-28
> **关联**: 承接 `2026-06-28-canvas-animation-refactor-context.md`（前文提要，已完成 P0-P2 基础修复）

---

## 一、设计目标与非目标

### 目标

让 Precis 画布动画从"平淡"升级为"惊艳"，同时保持数据校验工具必需的**精确性**。核心差异化点：用动画把**校验结果**可视化到画布上——这是普通 flow 工具做不到、只有校验工具才能拥有的动画语义。

### 非目标

- 不改写布局引擎算法
- 不改 Vue Flow 桥接层（vueFlowApi.ts）的对外接口（仅新增 `findNode` 已完成）
- 不做"全层精修"（不重写所有弹窗/抽屉过渡、不做全量 CSS 去重）——采用"核心差异化优先"策略
- 不让画布常态永远在动（避免干扰精度操作）

---

## 二、核心设计决策（已与用户确认）

| 决策点 | 结论 | 依据 |
|---|---|---|
| **动画哲学** | 三层架构，非三选一 | A(质感)/B(氛围)/C(数据流) 各司其职、叠加共存 |
| **三层投入比** | 重 C / 中 A / 轻 B | C 是差异化核心；B 对惊艳贡献最低且干扰精度 |
| **C 层语义** | ②方向流动 + ③校验状态着色 | ②是 DAG 基础素养；③是 Precis 杀手锏 |
| **粒子呈现** | SVG 发光圆点沿 smoothstep 路径 | 视觉精致，n8n/Vercel 级 |
| **校验完成动效** | 粒子到达约束节点时爆裂成光环 | 最戏剧化的"哇"时刻 |
| **未校验态** | 边完全静止 | 克制；校验时刻才"活"，反差感强 |
| **B 层边界** | 节点完全静止；仅背景 aurora + 玻璃呼吸 | 连线/拖拽需像素级精度 |

---

## 三、三层架构总览

```
┌─────────────────────────────────────────────────┐
│ C 层 · 语义信息层（重投入·差异化核心）              │
│   边粒子流：方向 + 校验状态着色 + 到达爆裂光环       │
│   实现：DeletableEdge.vue + edge.data.validationStatus │
├─────────────────────────────────────────────────┤
│ A 层 · 交互语法层（中投入·全局贯穿）                │
│   spring 缓动统一：入场/选中/拖拽/整理              │
│   实现：令牌体系（--ease-spring）+ CSS transition   │
├─────────────────────────────────────────────────┤
│ B 层 · 环境氛围层（轻投入·克制）                    │
│   画布背景 aurora 漂移 + 模态玻璃呼吸               │
│   节点静止（精度优先）                              │
└─────────────────────────────────────────────────┘
   底座：全局 keyframe 注册表 + prefers-reduced-motion
```

**设计哲学**：画布常态是安静的（尊重精度），只有校验这个核心动作发生时画布才"活"过来。"静→动"的反差是惊艳感的来源，而非让画布永远在动。

---

## 四、C 层详细设计（核心）

### 4.1 数据模型扩展

在边的 `data` 上新增 `validationStatus` 字段（与节点 `data.validationStatus` 同名同义，但分属不同对象，无冲突）：

```ts
// 边的 data 形态（useConnections.ts 创建边时已有 data，此处新增字段）
edge.data = {
  status: 'pending' | 'active',        // 已有：连接生命周期状态
  validationStatus: 'idle' | 'pass' | 'error' | 'missing',  // 新增：校验状态
  // ...其余已有字段（kind、fkNodeId 等）
}
```

**值域对齐**：复用 `types/constraints.ts:151` 已定义的 `'idle' | 'pass' | 'error' | 'missing'`（注意失败态是 `'error'`，非 `'fail'`）。

### 4.2 校验状态写入链路

校验状态写入点已在 `validationRegistryCore.ts`，只需在写入节点状态的同时，把状态同步到对应边：

| 写入点（节点状态） | 文件:行 | 新增（边状态） |
|---|---|---|
| 单约束校验完成 | `validationRegistryCore.ts:382` | 同步 `updateEdgeData(edge.id, { validationStatus: result.status })` |
| Schema 批量校验 | `validationRegistryCore.ts:446` | 同上（循环内已有 edge 在作用域） |
| 内联源校验 | `validationRegistryCore.ts:753` | 同上 |
| 断开连接重置 | `disconnect/registryHandlers/*.ts` | 重置对应边为 `'idle'` |

**边的查找**：校验编排已有 `edge.target === constraintNode.id` 的映射关系（见 `orchestration/globalValidation.ts:120-131` 的 `dispatchValidation`），可直接定位要更新的边。

更新机制走 `vueFlowApi.updateEdgeData`（增量，触发边组件响应式重渲染）。

### 4.3 粒子渲染（DeletableEdge.vue 扩展）

`DeletableEdge.vue` 是几乎所有边的渲染组件（`useNodeTypeRegistry.ts:80` 注册 `smoothstep → DeletableEdge`）。它已用 `getSmoothStepPath` 计算出 `pathData.path`（line 23-34），粒子沿该路径动画。

**渲染逻辑**：

```vue
<!-- 伪代码：在现有 <BaseEdge> 之后、删除按钮之前插入 -->
<g v-if="particleStatus !== 'idle'" class="edge-particles">
  <circle
    v-for="i in particleCount"
    :key="i"
    r="3"
    :class="`particle particle--${particleStatus}`"
  >
    <animateMotion :path="pathData.path" dur="2s" repeatCount="indefinite"
      :begin="`${(i-1) * 0.5}s`" />
  </circle>
</g>
```

- `particleStatus` 从 `props.data.validationStatus` 读取（默认 `'idle'` → 不渲染粒子）
- `idle` 态：**不渲染粒子**，边保持静态线（确认的决策）
- `pass`/`error`/`missing` 态：渲染 2-3 个错峰发光圆点，沿 path 流动
- 用 SVG 原生 `<animateMotion>`（声明式，无需 rAF，性能好），或退而用 `getPointAtLength` JS 驱动（若 `animateMotion` 在 smoothstep 路径上有兼容问题）

**粒子颜色映射**（复用节点 status-dot 语义色，保持一致）：

| validationStatus | 粒子颜色 | 语义 |
|---|---|---|
| `idle` | 无粒子（静态线） | 未校验 |
| `pass` | 绿 `#4cd7a8` / `#34d399` | 通过 |
| `error` | 红 `#ff8a8a` / `#fb7185` | 失败 |
| `missing` | 橙 `#f9c66b` / `#f59e0b` | 缺失依赖 |

**方向性（②语义）**：`<animateMotion>` 默认沿 path 从 source 端流向 target 端，天然表达"数据源→约束"的方向，无需额外处理。

### 4.4 到达爆裂光环（最戏剧化时刻）

校验结果到达约束节点时，粒子在节点端爆裂成对应颜色的光环扩散。

**实现方式**：状态从 `idle` 变为 `pass`/`error`/`missing` 的瞬间，在 `DeletableEdge.vue` 的 target 端（`props.targetX, props.targetY`）触发一次性 CSS keyframe 动画：

```css
@keyframes edge-burst {
  0%   { transform: scale(0.4); opacity: 0; }
  40%  { transform: scale(1);   opacity: 0.9; }
  100% { transform: scale(2.6); opacity: 0; }
}
.edge-burst--pass  { /* 绿光环，box-shadow 发光 */ }
.edge-burst--error { /* 红光环 */ }
.edge-burst--missing { /* 橙光环 */ }
```

**触发条件**：监听 `props.data.validationStatus` 的变化（Vue `watch`），从 `idle` 跳变到非 idle 时触发，`animationend` 后移除。用 `key` 重置确保每次校验都能重新触发。

### 4.5 与现有边动画的关系

| 现有动画 | 处理方式 |
|---|---|
| `canvasDashMove`（拖拽连线时的虚线） | 保留，与粒子互斥（拖拽时无粒子） |
| `fkDisplayDash` + `fkDisplayPulse`（外键展示边） | 保留，fk-display 边走单独 type，不经粒子逻辑 |
| `edge-draw`（新建边渐入） | 保留，与粒子可叠加（先渐入，后流动） |
| Vue Flow 内置 `animated: true`（默认行军蚁） | **移除或降级**，避免与粒子视觉冲突 |

---

## 五、A 层详细设计（全局语法贯穿）

### 5.1 现状（已完成的基线）

- 节点入场：`node-enter` keyframe，`--ease-spring`（已做）
- 整理：`--ease-spring` + 质心错峰 `--organize-stagger`（已做）
- 令牌：`--dur-*` / `--ease-*` 原子层（已做）

### 5.2 本次补齐

| 场景 | 现状 | 改为 |
|---|---|---|
| 节点 hover | `--node-transition-fast`（已用令牌） | 保持 |
| 节点选中 | 无独立动效 | 选中时 spring 光环吸附（复用 `--ease-spring`） |
| 节点拖拽 | 无独立动效 | 拖拽时 `scale(1.02)` + 加深阴影（复用已有 `--node-shadow-dragging` token） |
| 模态框/抽屉 | 各处硬编码 `0.2s ease` | 统一引用 `--transition-*` 令牌（不全量重写，仅触及高频弹窗） |

A 层不追求极致，只把 spring 语法"补齐到位"，让产品处处有质感即可。

---

## 六、B 层详细设计（克制氛围）

### 6.1 画布背景 aurora 缓慢漂移（liquid 主题）

延续 liquid 主题已有的三层 aurora 径向光晕（`liquid/tokens.css:34-48`），给 `.canvas-area::before` 加极缓慢的 `background-position` 漂移动画（18-24s 周期），让背景"活着"但不抢眼。

```css
@keyframes aurora-drift {
  0%, 100% { background-position: 0% 0%, 100% 100%, 50% 50%; }
  50%      { background-position: 30% 20%, 70% 80%, 40% 60%; }
}
.canvas-area::before {
  animation: aurora-drift 22s ease-in-out infinite;
}
```

**仅 liquid 主题生效**（light/dark 无此背景层）。

### 6.2 模态框玻璃呼吸（可选，轻量）

非交互区的玻璃模糊层做极弱呼吸（`backdrop-filter` 数值微变），频率慢、幅度小。此项为可选，若观感多余则省略。

### 6.3 明确不做

- **节点静止时漂浮**：明确排除。连线/点击/拖拽需精度，节点本体只在被操作或数据流经时才动。
- 任何让节点 handle（连接点）位移的动效。

---

## 七、底座：基础设施

### 7.1 全局 keyframe 注册表

新建 `src/assets/animations.css`，集中定义被多处重复的 keyframe，消除冗余：

| keyframe | 现状重复 | 处理 |
|---|---|---|
| `spin` | 9 处重复定义 | 统一一份，各处引用 |
| `pulse` | 4 处（含义不同） | 拆分为语义化命名（`status-pulse` / `ring-pulse`） |
| `fadeIn` / `slideIn` / `modal-slide-in` | 多处重复 | 统一 |
| 新增 `edge-burst` / `aurora-drift` | — | 本设计新增，放此处 |

各组件文件删除本地重复定义，改为 `@import` 或直接引用全局。

### 7.2 prefers-reduced-motion 支持（无障碍，必做）

当前项目**完全没有** `prefers-reduced-motion` 支持（探查确认零匹配），这是最大的可访问性缺口。新增全局兜底：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

对校验粒子：reduced-motion 下粒子**停止流动**（`animation` 被上面规则禁用），但仍渲染为**静态着色点**——因为粒子颜色由 CSS class（`.particle--pass`/`.particle--error`，决定 `fill`/`box-shadow`）驱动，与 `animation` 解耦，不依赖动画即可显示颜色。这样状态信息（通过/失败/缺失）在无障碍模式下依然可读，只是不再流动。

---

## 八、技术约束与可行性（已验证）

| 约束 | 验证结论 |
|---|---|
| 边能否携带校验状态 | ✅ 边已有 `data` 字段，`updateEdgeData` 增量更新 |
| 校验状态来源 | ✅ 节点 `data.validationStatus` 已存在，写入点 `validationRegistryCore.ts:382/446/753` |
| 边→约束映射 | ✅ `edge.target === constraintNode.id`，编排层已有 |
| 粒子渲染载体 | ✅ `DeletableEdge.vue` 已有 `pathData.path`，可直接加 SVG 粒子 |
| 状态值域 | ✅ `'idle'\|'pass'\|'error'\|'missing'`，与节点一致 |
| Vue Flow 操作规范 | 遵守 AGENTS.md：状态写入走 `updateEdgeData`（增量），不碰数组替换 |

无需新增 Pinia store、无需注册新边类型、无需架构改动。

---

## 九、实施策略：核心差异化优先

分批实施，每批独立可验证：

| 批次 | 内容 | 层 | 风险 |
|---|---|---|---|
| **C1 数据链路** | 边 `data.validationStatus` + 校验写入同步 + 断开重置 | C | 低（增量字段） |
| **C2 粒子渲染** | `DeletableEdge.vue` 状态粒子 + 颜色映射 | C | 中（SVG 动画） |
| **C3 到达爆裂** | 状态跳变触发的光环扩散 keyframe | C | 中 |
| **A 语法补齐** | 选中/拖拽 spring + 高频弹窗令牌化 | A | 低 |
| **B 氛围** | liquid aurora 漂移（+ 可选玻璃呼吸） | B | 低 |
| **底座** | 全局 keyframe 注册表 + reduced-motion | — | 低-中（去重需回归） |

C1→C2→C3 是核心价值链，优先完成；A/B/底座为支撑。

---

## 十、测试策略（遵循 AGENTS.md）

**E2E（Playwright，主验证）**：
- 校验后边出现带色粒子（断言 SVG circle 存在 + class 正确）
- pass→绿、error→红、idle→无粒子
- 校验完成瞬间爆裂光环出现后消失
- reduced-motion 下粒子不流动但边仍着色

**单元测试（vitest，纯逻辑）**：
- 校验状态写入边的逻辑（mock updateEdgeData）
- 粒子颜色映射纯函数
- reduced-motion 状态读取

**手动验证**：`npm run dev` 实际运行校验，观察三层融合观感。

---

## 十一、风险与缓解

| 风险 | 缓解 |
|---|---|
| `<animateMotion>` 在 smoothstep 路径兼容性 | 退路：`getPointAtLength` + rAF；先小范围验证 |
| 大量边同时校验，粒子性能 | 限制每边粒子数（2-3 个）；reduced-motion 兜底；视口外边不渲染粒子 |
| 粒子与删除按钮/标签视觉冲突 | 粒子层 z-index 低于交互层；hover 删除按钮时粒子可淡化 |
| aurora 漂移在低端机卡顿 | 仅 liquid 主题；周期长（22s）；transform/opacity 友好 |
| 状态同步竞态（校验快速重跑） | 爆裂用 `key` 重置；粒子状态以最新 `validationStatus` 为准 |

---

## 十二、关键文件清单

**新增**：
- `frontend/src/assets/animations.css` — 全局 keyframe 注册表
- `frontend/src/composables/.../useEdgeParticles.ts`（可选，若粒子逻辑复杂则抽取）

**修改**：
- `frontend/src/components/canvas/edges/DeletableEdge.vue` — 粒子渲染 + 爆裂（C2/C3 核心）
- `frontend/src/services/constraints/validationRegistryCore.ts` — 校验状态同步到边（C1）
- `frontend/src/services/disconnect/registryHandlers/*.ts` — 断开重置边状态（C1）
- `frontend/src/composables/nodes/useConnections.ts` — 边创建时初始化 `validationStatus: 'idle'`（C1）
- `frontend/src/assets/tokens/primitive.css` — 新增 aurora/burst 语义令牌（如需）
- `frontend/src/assets/themes/liquid/tokens.css` 或对应 css — aurora 漂移（B）
- `frontend/src/assets/graph-node.css` — 选中/拖拽 spring（A）
- 各重复 keyframe 的组件文件 — 引用全局注册表（底座）
- `frontend/src/assets/base.css` — 全局 reduced-motion（底座）

---

## 十三、成功标准

1. 运行校验后，画布上的边按结果着色流动（绿/红），用户一眼看出哪条校验过/挂
2. 校验完成瞬间有光环爆裂的"哇"时刻
3. 未校验时画布安静精确，操作不受干扰
4. liquid 主题背景有缓慢氛围漂移
5. 动画尊重 `prefers-reduced-motion`
6. 现有 1459 单测全绿，新增 C 层单测覆盖
