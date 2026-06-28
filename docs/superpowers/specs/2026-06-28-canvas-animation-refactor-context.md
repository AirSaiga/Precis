# 画布动画重构 — 前文提要（新会话输入源）

> **用途**：作为新会话的输入，让 AI 无需重新调研即可直接开始动画重构设计。
> 包含完整的问题诊断、代码索引、技术约束和设计方向建议。

---

## 一、背景

Precis 是一个可视化数据校验配置工具，核心交互界面是 Vue Flow 驱动的**画布**（NodeCanvas），上面有 Schema 节点、约束节点、正则节点、转换节点等，通过边（连接线）组成 DAG。

用户反馈画布动画效果"僵硬"。经深度审查，根因是**动画体系结构性地散架**——已有引擎是死代码、令牌不完整、多处硬编码绕过体系、入场动画完全缺失。

---

## 二、核心问题诊断（10 项，按影响力降序）

### P0：节点入场零动画，直接闪现 ⚠️ 最常感知

**位置**：`frontend/src/stores/graphStore/modules/factories/createBaseNodeFactory.ts:34`
**现状**：`addNodes(newNode)` 后 VueFlow 立即渲染，无 fade-in / scale-in。
**影响**：每次新建/导入/AI 生成节点都生硬弹出。
**根因**：CSS `transition` 对元素首次挂载无效（只对状态变化有效）。需要用 `@keyframes` + `animation` 或 Vue `<Transition appear>`。

### P0：逐帧缓动引擎（含 stagger）是 100% 死代码

**位置**：`frontend/src/features/node-layout-organizer/animations/animateToPosition.ts`（整个文件）
**现状**：实现了 `easeInOutCubic`/`easeLinear`/`easeIn`/`easeOut` 缓动函数、`animateNodeToPosition`（rAF 单节点）、`animateAllNodes`（带 stagger 错峰）、`animateNodesSequentially`（链式）、`AnimationGroup`（取消/管理）。
**验证**：全局搜索确认**无任何 import 调用方**（除文件自身）。
**实际生效的是**：`useNodeOrganizer.ts:249-274` 的 `applyAnimation`——加 CSS class `layout-organizing` + `setTimeout(duration)` 干等。
**影响**：所有节点同时启动同时到达，无"涟漪"错峰感。

### P0：animateDuration 与 CSS transition 时长脱钩（实质 bug）

**位置**：`useNodeOrganizer.ts:268`（duration 只喂 setTimeout）vs `graph-node.css:29`（CSS 硬编码 `0.4s`）
**现状**：用户在设置里改 `animateDuration`（如 800ms），setTimeout 等满 800ms 才移除 class，但 CSS transition 永远是 0.4s——动画 400ms 就结束了，后 400ms 节点已停但 class 还在。
**影响**：设置项形同虚设，长时长下动画结束仍卡顿。

### P1：整理动画缓动硬编码，不走令牌，用 linear-ish 而非 spring

**位置**：`graph-node.css:29` — `transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)`
**现状**：是第 5 套独立的时长/缓动组合。项目已有 `--transition-spring: 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)`（带回弹），但从未用于整理。
**影响**：整理这种"吸附到目标"的动作用 spring/overshoot 缓动会自然得多。

### P1：fitView duration 取值混乱

| 调用点 | duration | 文件:行 |
|--------|----------|---------|
| inspection 导入聚焦 | 500 | `NodeCanvas.vue:318` |
| InspectionDrawer | 500 | `InspectionDrawer.vue:332` |
| 项目初始化 | 300 | `useCanvasLifecycle.ts:60` |
| 视口同步 | 400 | `useCanvasViewportSync.ts:35` |
| AI 建 constraint | 300 | `aiChatInstructionService.ts:366` |
| AI 建 schema | 300 | `aiChatInstructionService.ts:513,522` |
| AI 建 regex/transform | 300 | `aiChatInstructionService.ts:619,673` |
| 初始化后全量 | **无** | `useCanvasLifecycle.ts:79` |
| 键盘快捷键 | **无** | `canvasCommands.ts:97` |

**影响**：视图切换体验不一致，有的平滑有的瞬时硬切。

### P1：边创建无绘制动画，整理时边不跟随平滑过渡

**位置**：`base.css:167-170` — `.vue-flow__edge-path` 无 transition
**现状**：连接成功后 smoothstep 路径瞬间全长出现。整理时边 path 每帧重算但无缓动，节点先动、边滞后抖动。
**对比**：外键"展示边"（`NodeCanvas.styles.css:56-71`）有精致的 `fkDisplayDash` + `fkDisplayPulse` 动画。

### P2：organizeSelectedNodes 动画后又强制 applyPositions，中途打断

**位置**：`useNodeOrganizer.ts:140` — 先 `applyAnimation`，紧接着又无条件 `applyPositions`
**影响**：选中整理可能跳变。

### P2：DOM querySelector 查节点可能落空

**位置**：`useNodeOrganizer.ts:257` — `document.querySelector('.vue-flow__node[data-id=...]')`
**影响**：大批量整理时偶发个别节点不动画、直接瞬移。

### P2：.graph-node 与 .node-shell transition 重复定义

**位置**：`graph-node.css:6-11` vs `NodeShell.styles.css:9-13`
**影响**：隐性冲突，两者都监听 transform。

### P2：动画令牌体系不完整

**位置**：`primitive.css:202-205`
**现状**：
```css
--transition-fast:   0.15s ease-out;
--transition-normal: 0.2s ease-out;
--transition-slow:   0.3s ease-out;
--transition-spring: 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
```
**问题**：
- 无 0.4s / 0.5s 档位（整理/入场需要更长时长，开发者被迫硬编码）
- duration 与 easing 绑定，无法单独替换
- `--node-ease-bounce`（`node-tokens.css:187`）定义后无人使用（死令牌）
- `ANIMATION_CONSTANTS`（`constants.ts:36-42`，含 STAGGER_DELAY=30）无人引用

---

## 三、现有动画技术栈索引

### CSS 动画
- `graph-node.css:1-11` — `.graph-node` hover/selected 的 transition（用 node-transition-fast）
- `graph-node.css:28-30` — `.vue-flow__node.layout-organizing` 整理动画（硬编码 0.4s）
- `NodeShell.styles.css:9-13` — `.node-shell` transition（与 graph-node 重复）
- `NodeCanvas.styles.css:28-92` — 连接线 dash 流动 + 外键边 fkDisplayDash/fkDisplayPulse 动画

### JS 动画引擎（死代码）
- `animateToPosition.ts` — 完整的逐帧缓动引擎，4 个缓动函数 + stagger + 链式 + 取消
  - `animateNodeToPosition(element, x, y, duration)` — rAF 单节点
  - `animateAllNodes(entries, options)` — 批量带 stagger（`delay = index * stagger`）
  - `animateNodesSequentially(entries, options)` — 顺序链式
  - `AnimationGroup` — 管理取消
- `constants.ts:36-42` — `ANIMATION_CONSTANTS`（DEFAULT_DURATION=400, STAGGER_DELAY=30, MAX_STAGGER_DELAY=100）

### 实际生效的动画路径
- `useNodeOrganizer.ts:249-274` — `applyAnimation`：加 class + setTimeout
- `useNodeOrganizer.ts:149-151` — `quickOrganize`：快速整理入口
- `useNodeOrganizer.ts:112-147` — `organizeSelectedNodes`：选中节点整理（有重复 applyPositions bug）

### 布局引擎
- `node-layout-organizer/core/layoutCalculator.ts` — 核心计算器
- `node-layout-organizer/strategies/schemaCentricStrategy.ts` — 以 Schema 为中心的分区布局
- `node-layout-organizer/strategies/familyLayout.ts` — 家庭式分区

### 令牌体系
- `primitive.css:202-205` — 4 个过渡令牌（组合式 duration+easing）
- `compat.css:231-234` — `--ui-transition-*` 别名
- `node-tokens.css:181-191` — `--node-transition-*` 别名 + `--node-ease-default`/`--node-ease-bounce`（后者未使用）

### Vue Flow 相关
- `vueFlowApi.ts` — 桥接层，`addNodes`/`addEdges` 等增量 API
- `NodeCanvas.vue:218-230` — `initVueFlowApi` 在 setup 中注入
- fitView 用 d3-zoom transition（内部 ease 模式，无法定制缓动，但 duration 可控）

---

## 四、设计方向建议

### 令牌体系重构

引入**分离式令牌**（duration 与 easing 独立）：
```css
/* 纯时长 */
--dur-instant: 100ms;
--dur-fast: 150ms;
--dur-normal: 200ms;
--dur-slow: 300ms;
--dur-xslow: 400ms;
--dur-enter: 300ms;   /* 节点入场 */
--dur-organize: 400ms; /* 布局整理 */

/* 纯缓动 */
--ease-out: ease-out;
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* 带回弹 */

/* 组合（向后兼容，用上面两个组装） */
--transition-fast: var(--dur-fast) var(--ease-out);
--transition-slow: var(--dur-slow) var(--ease-out);
--transition-spring: var(--dur-xslow) var(--ease-spring);
```

### 节点入场动画

用 CSS keyframes（`animation` 而非 `transition`）：
```css
@keyframes node-enter {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.vue-flow__node.node-entering {
  animation: node-enter var(--dur-enter) var(--ease-spring);
}
```
在 `createBaseNodeFactory.ts` 创建后给节点加临时 class，`animationend` 时移除。

### 整理动画

**方案 A（接活死代码）**：用 `animateAllNodes`（带 stagger）替代 CSS class + setTimeout。
**方案 B（纯 CSS）**：用 `transition-delay: calc(var(--index) * var(--stagger-delay))` 实现错峰，动态设 `--index` 和 `--organize-duration`。
**推荐方案 B**——更轻量，不引入 rAF 复杂性，且能修复 duration 脱钩（动态 setProperty）。

### 边绘制动画

新建边时一次性 `stroke-dashoffset` 动画（用 pathLength 归一化）：
```css
@keyframes edge-draw {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}
.vue-flow__edge.edge-drawing .vue-flow__edge-path {
  stroke-dasharray: 1;
  pathLength: 1;
  animation: edge-draw var(--dur-normal) var(--ease-out);
}
```

### fitView 统一

定义 `--vf-fitview-duration: 400ms`，所有 8+ 处调用统一引用，无 duration 的补上。

---

## 五、技术约束

- 画布基于 **Vue Flow**（@vue-flow/core），节点/边通过 `v-model:nodes`/`v-model:edges` 双向同步
- 节点操作必须走 `vueFlowApi.ts` 桥接层（`addNodes`/`addEdges`），不能直接 push 数组（AGENTS.md 强制约定）
- 创建节点后、创建边之前必须 `await nextTick()`（等 handleBounds 就绪）
- d3-zoom 的 fitView 过渡无法定制缓动（只能控 duration）
- 节点 CSS transition 用 `--node-transition-*` token 体系
- 项目用 E2E-first 测试策略（.vue 组件由 Playwright 覆盖，纯逻辑 .ts 由 vitest 覆盖）
- 设计令牌在 `src/assets/tokens/` 下（primitive → compat → node-tokens 三层别名）
- 主题切换支持（liquid 主题在 `themes/liquid/` 覆盖令牌）

---

## 六、相关文件清单（绝对路径）

**CSS**：
- `frontend/src/assets/graph-node.css` — 节点动画 CSS（含 layout-organizing 硬编码）
- `frontend/src/assets/base.css:167-170` — 边样式（无 transition）
- `frontend/src/components/canvas/NodeCanvas.styles.css:28-92` — 连接线/外键边动画
- `frontend/src/components/ui/NodeShell.styles.css:9-13` — 节点外壳 transition（与 graph-node 重复）

**令牌**：
- `frontend/src/assets/tokens/primitive.css:202-205` — 基础过渡令牌
- `frontend/src/assets/tokens/node-tokens.css:181-191` — 节点过渡/缓动令牌
- `frontend/src/assets/tokens/compat.css:231-234` — ui-transition 别名
- `frontend/src/assets/themes/liquid/tokens.css:238-241` — liquid 主题覆盖

**JS 动画引擎（死代码）**：
- `frontend/src/features/node-layout-organizer/animations/animateToPosition.ts` — 完整引擎，无调用方
- `frontend/src/features/node-layout-organizer/constants.ts:36-42` — ANIMATION_CONSTANTS，无引用

**实际生效路径**：
- `frontend/src/features/node-layout-organizer/composables/useNodeOrganizer.ts:249-274` — applyAnimation
- `frontend/src/features/node-layout-organizer/composables/useNodeOrganizer.ts:112-147` — organizeSelectedNodes（有 bug）
- `frontend/src/features/node-layout-organizer/composables/useNodeOrganizer.ts:149-151` — quickOrganize

**节点创建**：
- `frontend/src/stores/graphStore/modules/factories/createBaseNodeFactory.ts:34` — addNodes 无入场动画

**fitView 调用点**：
- `frontend/src/components/canvas/NodeCanvas.vue:318`
- `frontend/src/composables/canvas/useCanvasLifecycle.ts:60,79`
- `frontend/src/composables/canvas/useCanvasViewportSync.ts:35`
- `frontend/src/services/aiChatInstructionService.ts:366,513,522,619,673`
- `frontend/src/features/keyboard/commands/canvasCommands.ts:97`

**Vue Flow 桥接**：
- `frontend/src/services/canvas/vueFlowApi.ts`
- `frontend/src/components/canvas/NodeCanvas.vue:218-230` — initVueFlowApi
