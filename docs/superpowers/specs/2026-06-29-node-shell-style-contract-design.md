# 节点外壳样式契约重构设计

> **状态**: 设计中，待用户复查
> **日期**: 2026-06-29
> **目标**: 为动画系统打牢前端根基——建立节点外壳样式的单一真相源，消除 7 套系统争夺样式的冲突。

---

## 一、背景与根因

### 问题

为画布动画系统（A 层 spring、C 层校验粒子）打基础时，A 层选中/拖拽动画反复失败（修了 4 次仍冲突）。系统性排查发现：**至少 7 套独立的样式系统争夺同一个节点的 transform / box-shadow / transition**：

| 系统 | 作用对象 | 问题 |
|---|---|---|
| A. NodeShell.styles.css | `.node-shell` | unlayered scoped，内部 4 处 transition 互相覆盖 |
| B. graph-node.css | `.graph-node` | 在 `layer(graph)`，被 unlayered 压制 |
| C. useNodeOrganizer | `.vue-flow__node` | JS 写 CSS 变量（整理动画） |
| D. ZoneGroupOverlay | `.vue-flow__node` | 直接改 inline transform（分组拖拽） |
| E1-E4. 各节点自带样式 | `.schema-node` 等 | **完全绕过 NodeShell**，各自独立阴影系统 |
| F. Vue Flow vendor | `.vue-flow__node` | 只设 translate 定位（干净） |
| G. Liquid 主题 | shadow 变量值 | 不改规则 |

### 根因

**没有单一真相源**。每个节点组件自行声明外壳的 transform/box-shadow/transition/hover/selected，导致：
- hover 和 selected 争同一个 transform（CSS 只能有一个赢家）
- NodeShell 节点和 Group2 节点行为不一致
- transition 声明互相覆盖（谁赢取决于特异性 + 源顺序，极脆弱）
- 新加的动画规则被既有 scoped 样式压制

### 已验证的解决机制

用 Playwright 在真实 layer + scoped 结构下验证：**一个放在 main.css 末尾（unlayered 区域）的全局样式文件，其 `.vue-flow__node.selected .node-shell` 规则（特异性 0,2,0）能干净赢过所有节点的 scoped 样式（`.node-shell[data-v-xxx]` 特异性同为 0,2,0，源顺序后定义者胜）**。无需 `!important`。

测试结果（修复后）：
- transform: `matrix(1.025,...)` ✓（契约赢）
- box-shadow: 契约值 ✓
- transitionDuration: `0.3s` ✓（契约赢）

---

## 二、核心架构：节点外壳样式契约

### 设计原则

**单一真相源 + 节点瘦身**：
1. 新建契约文件，统一定义所有节点外壳的 transform/box-shadow/transition
2. 各节点删除自带的重复声明，只保留内部内容样式

### 契约文件：`frontend/src/assets/node-shell-contract.css`

**位置**：main.css 末尾，unlayered（与 liquid/index.css 同区域，源顺序在其后）。这是它能赢过所有 scoped 样式的关键。

**覆盖的节点类型**（统一选择器组）：
- `.node-shell`（约束/集合节点）
- `.graph-node`（老节点基类）
- `.schema-node`、`.source-preview-node`、`.manual-data-node`、`.project-root-node`（Group2 节点）

**统一定义的状态**（所有节点共享同一行为）：

| 状态 | 触发 | 视觉 | transition |
|---|---|---|---|
| 基础态 | 默认 | `--node-shadow` | `--dur-fast --ease-out` |
| hover | 鼠标悬停 | `translateY(-2px)` + `--node-shadow-hover` | `--dur-fast --ease-out` |
| selected | Vue Flow `.selected` | `scale(1.025)` + `--node-shadow-selected` | `--dur-slow --ease-spring` |
| dragging | Vue Flow `.dragging` | `scale(1.03)` + `--node-shadow-dragging` + `opacity:0.95` | `--dur-slow --ease-spring` |
| has-error | `.has-error` | `--node-shadow-error` + 危险色边框 | `--dur-fast --ease-out` |

### hover 与 selected 的 transform 冲突解决方案

**关键设计**：selected 状态的 transform **组合** hover 的 translateY，而非替换：

```css
.vue-flow__node.selected .node-shell {
  transform: translateY(-2px) scale(1.025);  /* hover 上浮 + 选中放大 */
  box-shadow: var(--node-shadow-selected);
}
```

这样 hover+selected 共存时，节点既上浮又放大，不再互斥。dragging 同理（dragging 时优先级最高，覆盖 selected/hover）。

### 状态优先级（CSS 源顺序 + 特异性）

源顺序从低到高：基础态 → hover → has-error → selected → dragging。后定义者覆盖先定义者（同特异性下）。这保证：
- 拖拽中即使选中，也显示拖拽态
- 选中有错误，selected 的 scale 优先（error 边框通过 border-color 体现，不争 transform）

---

## 三、节点瘦身范围

各节点 CSS 文件**删除根级的 transform / box-shadow / transition / hover / selected / has-error 声明**（上交给契约），**保留**布局属性（background/border/border-radius/min-width/flex/display/position）和内部内容样式。

### 需瘦身的文件与范围

| 文件 | 删除（根级） | 保留 |
|---|---|---|
| `NodeShell.styles.css` | `.node-shell` 的 box-shadow/transition（:9-13）；`:hover`（:18-22）；`.is-selected`（:24-28）；`.has-error`（:30-33）；`:global(.vue-flow__node.selected/dragging)`（:47-63，本轮动画加的，契约接管）；`.state-selected`（:136-138） | theme-* 色彩系统、内部元素样式、徽章按钮 |
| `graph-node.css` | `.graph-node` 的 box-shadow/transition（:5-10）；`:hover`（:13-18）；`.is-selected`（:20-28） | layout-organizing、node-enter 入场动画、selection-rect |
| `SchemaNode.styles.css` | `.schema-node` 的 box-shadow/transition（:15,19-21）；`:hover`（:24-28）；`.is-selected`（:30-34）；`.has-error`（:41-44） | 布局属性、`.is-drag-over`、`.is-draft`（节点特有）、内部列样式 |
| `SourcePreviewNode.css` | `.source-preview-node` 的 box-shadow/transition（:5,12-15）；`:hover`（:24）；`.is-selected`（:29）；`.has-error` | `.is-connectable`、`.is-loading`（节点特有）、内部表格样式 |
| `ManualDataNode.css` | `.manual-data-node` 的 box-shadow/transition（:5,12-15）；`:hover`（:23）；`.is-selected`（:41） | `.is-connectable`（节点特有）、内部表格 |
| `TransformOutputNode.vue` inline | `.transform-output-node.is-selected` 的 box-shadow（:117-120） | sky 主题色覆盖 |
| `ProjectRootNode.styles.css` | `.project-root-node` 的 box-shadow/transition（:13-21）；`:hover`（:26-28）；`.is-selected`（:33-35） | 布局、内部摘要行 |
| 各约束节点 `*.styles.css`（9个） | `:hover` 的 box-shadow（每个文件:6-8） | 节点特有内容 |

### 节点特有状态保留原则

`is-drag-over`（Schema 拖入绑定）、`is-connectable`（Source/Manual 可连线）、`is-loading`（Source 加载）、`is-draft`（Schema 草稿）——这些**语义因节点类型而异**，保留在各节点 CSS，不强行统一。契约只管通用状态（hover/selected/dragging/has-error）。

---

## 四、契约文件的完整结构（草案）

```css
/**
 * @file node-shell-contract.css
 * @description 节点外壳样式契约——所有节点 transform/box-shadow/transition 的唯一真相源
 *
 * 必须在 main.css 末尾 unlayered 引入（源顺序晚于所有 scoped 样式，
 * 同特异性下后定义者胜）。各节点组件不得再声明这些属性。
 */

/* 所有节点外壳类型（统一选择器组，一处维护） */
%shell 选择器组 = .vue-flow__node .node-shell,
                   .vue-flow__node .graph-node,
                   .vue-flow__node .schema-node,
                   .vue-flow__node .source-preview-node,
                   .vue-flow__node .manual-data-node,
                   .vue-flow__node .project-root-node

/* 基础态 */
{shell} {
  box-shadow: var(--node-shadow);
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out);
}

/* hover */
.vue-flow__node:hover {shell} {
  transform: var(--node-transform-hover, translateY(-2px));
  box-shadow: var(--node-shadow-hover);
}

/* has-error（通用错误态） */
{shell}.has-error {
  border-color: var(--node-border-error, var(--ui-danger));
  box-shadow: var(--node-shadow-error);
}

/* selected（组合 hover 的上浮 + 选中放大，spring 回弹） */
.vue-flow__node.selected {shell} {
  transform: translateY(-2px) scale(1.025);
  box-shadow: var(--node-shadow-selected);
  transition: transform var(--dur-slow) var(--ease-spring),
              box-shadow var(--dur-slow) var(--ease-spring),
              border-color var(--dur-slow) var(--ease-spring);
}

/* dragging（优先级最高） */
.vue-flow__node.dragging {shell} {
  transform: scale(1.03);
  box-shadow: var(--node-shadow-dragging);
  opacity: 0.95;
  transition: transform var(--dur-slow) var(--ease-spring),
              box-shadow var(--dur-slow) var(--ease-spring);
}
```

注：CSS 无预处理器的"选择器组宏"，实际用逗号分隔列出所有节点类型，或借助 CSS 自定义属性让各节点根元素统一设 `--is-node-shell: 1` 再用属性选择器。实施时定。

---

## 五、NodeShell 的 `isDragging` 死代码清理

`NodeShell.vue:159` 的 `const isDragging = ref(false)` 从未被赋值，`is-dragging` class 永不触发。契约改用 Vue Flow 原生 `.vue-flow__node.dragging` 后，NodeShell 的 `isDragging` 和 `is-dragging` 绑定**完全无用，删除**。

---

## 六、与既有动画系统的关系

### 保留（不动）
- **入场动画** `node-enter` keyframe（graph-node.css:59-62）——作用于 `.node-entering` class，与外壳契约不冲突
- **整理动画** `layout-organizing`（graph-node.css:32-37）——作用于 `.vue-flow__node` 包装层的 transform（定位），与契约的内层 transform 不冲突
- **C 层校验粒子**（DeletableEdge.vue）——作用于边，与节点外壳无关

### 回退后重做（根基稳定后）
- **A 层 selected/dragging spring**：本轮加在 NodeShell.styles.css 的 `:global(.vue-flow__node.selected/dragging)` 规则删除，由契约统一定义（已在草案里）
- **A 层选中 scale 1.025**：融入契约的 selected 状态

### B 层（已砍）
画布 aurora 漂移已移除，本次不涉及。

---

## 七、实施策略

分批，每批独立可验证（type-check + lint + 全量单测 + Playwright 视觉验证）：

| 批次 | 内容 | 风险 |
|---|---|---|
| **R1 契约文件 + 引入** | 新建 node-shell-contract.css，main.css 末尾引入；先只定义基础态（不触动现有节点） | 低（纯加法） |
| **R2 NodeShell 瘦身** | 删除 NodeShell.styles.css 的根级 transform/shadow/transition/hover/selected；契约接管 | 中（影响所有 NodeShell 节点） |
| **R3 graph-node 瘦身** | 删除 graph-node.css 的 `.graph-node` 根级样式；保留入场/整理动画 | 中 |
| **R4 Group2 节点瘦身** | SchemaNode/SourcePreview/ManualData/TransformOutput/ProjectRoot 逐一瘦身 | 中高（5 个节点，逐个验证） |
| **R5 约束节点瘦身** | 9 个约束节点的 `:hover` box-shadow 删除 | 低 |
| **R6 死代码清理** | 删除 NodeShell 的 isDragging ref + is-dragging 绑定 | 低 |
| **R7 验证 + 动画重做** | Playwright 全面验证选中/hover/dragging 一致性；在干净基础上重做 A 层 spring | — |

---

## 八、验证标准

1. **一致性**：所有节点类型（NodeShell/Schema/Source/Manual/ProjectRoot）的 hover/selected/dragging 行为**完全相同**（Playwright 逐类型验证 computed transform/box-shadow 一致）
2. **无冲突**：hover+selected 共存时显示组合 transform（上浮+放大），不再互斥
3. **单一真相源**：grep 确认无节点组件再声明根级 transform/box-shadow/transition
4. **既有功能不破**：入场动画、整理动画、C 层粒子、节点特有状态（is-connectable 等）正常
5. **全量测试绿**：1462 单测通过
6. **动画可嵌入**：A 层 spring 在契约里干净生效（Playwright 验证 selected 状态 transitionDuration=0.3s spring）

---

## 九、风险与缓解

| 风险 | 缓解 |
|---|---|
| 瘦身时误删布局属性（background/flex）导致节点变形 | 瘦身清单明确"只删 transform/box-shadow/transition/hover/selected"，保留布局；每批后视觉验证 |
| 某节点特有状态被误归契约导致行为失真 | 特有状态（is-connectable/is-draft 等）明确保留在节点；契约只管通用状态 |
| 契约选择器漏列某节点类型 → 该节点无样式 | R1 用逗号组列全所有类型；Playwright 逐类型验证 |
| main.css 引入顺序错误导致契约失效 | 契约必须在末尾 unlayered；Playwright 验证优先级 |
| ProjectRoot 无 handle/有操作按钮，结构特殊 | 契约只管外壳视觉，不动其内部结构；ProjectRoot 保留操作按钮和摘要行 |
