# 前端视觉统一与面板修缮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛前端散乱的圆角/间距/字号/控件尺寸到统一令牌阶梯，统一各面板结构（header/body/footer），消除"不统一、不对齐"的视觉瑕疵。

**Architecture:** 分 4 批推进（P0 地基 → P1 核心面板 → P2 高频弹层 → P3 辅助面板）。P0 改 radius 令牌值触发全局收敛；P1-P3 按面板闭环，每个面板内按 header→圆角→间距→字号顺序处理。纯 CSS 改动，不改功能逻辑，E2E 测试守护回归。

**Tech Stack:** Vue 3 + CSS 自定义属性（令牌体系）+ Vite。令牌三层：`tokens/primitive.css`（基础值）→ `tokens/semantic.css`（语义）→ `tokens/component.css`（组件）→ `tokens/compat.css`（`--ui-*` 兼容映射）。

**Spec:** `docs/superpowers/specs/2026-06-26-frontend-visual-unification-design.md`

---

## 关键约定（所有任务通用）

1. **令牌引用优先**：改样式时，值若已存在令牌则用 `var(--xxx)`，否则按碎值映射表处理（见 spec 3.4）。
2. **拒绝无效占位**：若硬编码值已等于令牌值且无统一诉求，不强行套令牌（如 `padding: 16px` 在非面板上下文可保留）。
3. **控件圆角统一**：所有控件（按钮/输入框/选择器）圆角用 `var(--ui-radius-sm)`（8px），不用 `--ui-radius-md`。
4. **每批结束做视觉验证**：`npm run dev` 后在 light/dark/liquid 三主题切换检查（设置中心切换主题）。
5. **commit 风格**：`style(visual): <描述>`（纯 CSS 改动用 style 类型）。

---

## P0：地基（令牌层 + 控件基类 + 壳体）

### Task 1: Radius 令牌值调整

**Files:**
- Modify: `frontend/src/assets/tokens/primitive.css:193-196`

- [ ] **Step 1: 修改 radius 基础令牌值**

将 `frontend/src/assets/tokens/primitive.css` 第 193-196 行：

```css
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
```

改为：

```css
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
```

> `--radius-full: 9999px`（第 197 行）不变。

- [ ] **Step 2: 检查主题文件无 radius 覆盖**

运行：`grep -rn '\-\-radius' frontend/src/assets/themes/`

预期：仅可能返回 liquid 子模块中对 `--crystal-*` 的引用，**不应有 `--radius-sm/md/lg/xl` 的覆盖定义**（已预先确认 dark.css/liquid.css 均无覆盖）。若有则需一并调整。

- [ ] **Step 3: 构建验证**

运行：`cd frontend && npm run build`

预期：构建成功（CSS 令牌值改动不影响编译）。

- [ ] **Step 4: 视觉验证（关键检查点）**

运行：`cd frontend && npm run dev`，打开应用，在设置中心分别切换 light/dark/liquid 三主题，重点检查：
- 按钮圆角（应从 10px 变为 12px，略圆润）
- 卡片/面板圆角（14→16px）
- 模态框圆角（20→24px）

若某主题下圆角异常（过大/过小），记录现象。这是预期的全局收敛，只要无明显破即可继续。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assets/tokens/primitive.css
git commit -m "style(visual): radius 令牌值统一到 8/12/16/24 阶梯

--radius-md/lg/xl: 10/14/20 → 12/16/24,触发全局圆角收敛"
```

---

### Task 2: 新增 header 高度令牌 + 控件圆角统一

**Files:**
- Modify: `frontend/src/assets/tokens/component.css:21,47,66`
- Modify: `frontend/src/assets/tokens/component.css`（新增令牌）

- [ ] **Step 1: 新增 `--ui-header-height` 令牌**

在 `frontend/src/assets/tokens/component.css` 的 `:root` 块开头（第 11 行 `:root {` 之后）插入：

```css
  /* ============================================================
     面板结构
     ============================================================ */
  --ui-header-height: 56px;

```

- [ ] **Step 2: 控件圆角从 radius-md 改为 radius-sm**

在 `frontend/src/assets/tokens/component.css` 中，将以下 3 处 `var(--radius-md)` 改为 `var(--radius-sm)`：

第 21 行：
```css
  --button-radius: var(--radius-sm);
```

第 47 行：
```css
  --input-radius: var(--radius-sm);
```

第 66 行：
```css
  --select-radius: var(--radius-sm);
```

- [ ] **Step 3: 调整控件高度令牌到规范阶梯**

在 `frontend/src/assets/tokens/component.css` 中：

第 15-17 行（按钮高度 28/36/44 → 32/36/40）：
```css
  --button-height-sm: 32px;
  --button-height-md: 36px;
  --button-height-lg: 40px;
```

第 43-44 行（输入框：compact 34→32）：
```css
  --input-height-md: 36px;
  --input-height-compact: 32px;
```

第 62-63 行（选择框：compact 34→32）：
```css
  --select-height-md: 36px;
  --select-height-compact: 32px;
```

- [ ] **Step 4: 构建验证**

运行：`cd frontend && npm run build`

预期：成功。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assets/tokens/component.css
git commit -m "style(visual): 新增 --ui-header-height,控件圆角统一 sm/高度阶梯 32-36-40"
```

---

### Task 3: ui.css 控件基类圆角统一

**Files:**
- Modify: `frontend/src/assets/ui.css`（`.ui-btn`、`.ui-input`、`.ui-select`、`.ui-textarea` 的 border-radius）

- [ ] **Step 1: 定位所有 `--ui-radius-md` 用于控件的位置**

运行：`grep -n 'border-radius: var(--ui-radius-md)' frontend/src/assets/ui.css`

预期：返回 `.ui-btn`、`.ui-input`、`.ui-select`、`.ui-textarea` 等控件类的多处行号。

- [ ] **Step 2: 将控件圆角改为 `--ui-radius-sm`**

把上一步定位到的、**控件类**（`.ui-btn`、`.ui-btn--*`、`.ui-input`、`.ui-select`、`.ui-textarea`、`.ui-switch`、`.ui-checkbox` 等表单控件）的 `border-radius: var(--ui-radius-md)` 改为 `border-radius: var(--ui-radius-sm)`。

> 注意：**非控件类**（如 `.ui-card`、`.ui-panel` 等容器）的 `--ui-radius-md`/`--ui-radius-lg` 保持不变，它们应使用更大圆角。

- [ ] **Step 3: 构建验证**

运行：`cd frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/assets/ui.css
git commit -m "style(visual): ui.css 控件基类圆角统一到 --ui-radius-sm(8px)"
```

---

### Task 4: P0 整体视觉验证（检查点）

- [ ] **Step 1: 三主题完整验证**

运行：`cd frontend && npm run dev`，切换 light/dark/liquid 三主题，确认：
- 控件（按钮/输入框）圆角为 8px，高度 36px（默认）
- 各处圆角无破损伤眼的情况
- 三栏面板（activity-bar/sidebar/panel）顶部基本对齐

- [ ] **Step 2: E2E 回归测试**

运行：`cd e2e && npx playwright test`（需后端运行：另开终端 `npm run backend:dev`）

预期：全部通过。若有失败，分析是否与本批改动相关——CSS 改动理论上不应影响功能测试，失败可能是 selector 变化（本次不改 class 名，应无影响）。

- [ ] **Step 3: 记录验证结果**

在终端总结 P0 验证结论。若三主题均无明显问题，继续 P1；若有破损，回滚对应 Task。

---

## P1：核心面板（主工作区）

### Task 5: InspectorPanel 结构统一

**Files:**
- Modify: `frontend/src/components/layout/InspectorPanel.styles.css`（`.panel-header` 及相关）

**当前状态**：`.panel-header` 的 `height: 53px`、`padding: 0 16px`、`h3 font-size: 14px`。

- [ ] **Step 1: 统一 header 高度与内边距**

在 `frontend/src/components/layout/InspectorPanel.styles.css` 中，将 `.panel-header` 块：

```css
.panel-header {
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 53px;
  background: var(--ui-bg-elevated);
  border-bottom: 1px solid var(--ui-border-light);
  position: relative;
}
```

改为：

```css
.panel-header {
  display: flex;
  align-items: center;
  padding: 0 var(--ui-space-xl);
  height: var(--ui-header-height);
  background: var(--ui-bg-elevated);
  border-bottom: 1px solid var(--ui-border-light);
  position: relative;
}
```

- [ ] **Step 2: 统一标题字号与图标间距**

将 `.panel-header h3` 块中的 `gap: 8px` 改为 `gap: var(--ui-space-sm)`，`font-size: 14px` 改为 `font-size: var(--ui-font-size-md)`：

```css
.panel-header h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--ui-space-sm);
  font-size: var(--ui-font-size-md);
  font-weight: 600;
  color: var(--ui-text-title);
}
```

- [ ] **Step 3: 扫描并收敛文件内其余碎值**

运行：`grep -nE '(padding|margin|gap|height|width):\s*[0-9]+px' frontend/src/components/layout/InspectorPanel.styles.css`

对返回的每处硬编码，按碎值映射表（spec 3.4）处理：5/6/7px→8px、9/10px→12px、14/18px→16px。值已等于令牌值且无统一诉求的可保留。

- [ ] **Step 4: 视觉验证**

`npm run dev`，选中一个画布节点查看 Inspector 面板，确认 header 高度 56px、标题与图标间距统一。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/InspectorPanel.styles.css
git commit -m "style(visual): InspectorPanel header 统一到规范(56px/令牌化)"
```

---

### Task 6: DataLibrary 结构统一

**Files:**
- Modify: `frontend/src/components/library/DataLibrary.styles.css`

**当前状态**：39 处硬编码魔数（密度最高之一），header 区域 `padding: 16px 20px`、`font-size: 16px` 等。

- [ ] **Step 1: 定位 header/title 区域**

运行：`grep -nE 'header|title|toolbar' frontend/src/components/library/DataLibrary.styles.css | head -20`

阅读相关块，找到面板 header 或标题区（DataLibrary 可能无标准 `.panel-header`，需找到实际承担 header 角色的类）。

- [ ] **Step 2: 统一 header 区域**

将 DataLibrary 的 header/标题区高度对齐到 `var(--ui-header-height)`（56px），padding 改为 `0 var(--ui-space-xl)`，字号改 `var(--ui-font-size-md)`。具体类名依据 Step 1 结果确定。

> 若 DataLibrary header 是 `padding: 16px 20px` 这种"内边距撑高度"模式（无显式 height），改为显式 `height: var(--ui-header-height)` + `padding: 0 var(--ui-space-xl)` 以保证与其他面板对齐。

- [ ] **Step 3: 批量收敛碎值**

运行：`grep -nE '(padding|margin|gap|border-radius|font-size|height|width):\s*[0-9]+px' frontend/src/components/library/DataLibrary.styles.css`

逐处按映射表处理。border-radius 碎值映射：控件用 `var(--ui-radius-sm)`、卡片用 `var(--ui-radius-md)`、面板容器用 `var(--ui-radius-lg)`。

- [ ] **Step 4: 视觉验证 + Commit**

验证 DataLibrary 面板 header 与相邻面板顶部对齐。

```bash
git add frontend/src/components/library/DataLibrary.styles.css
git commit -m "style(visual): DataLibrary 结构统一(header 56px/碎值收敛)"
```

---

### Task 7: ResourceTree 结构统一

**Files:**
- Modify: `frontend/src/components/library/ResourceTree.styles.css`
- Modify: `frontend/src/components/library/ResourceTreeItem.styles.css`

**当前状态**：28 处魔数；`.tree-row:hover` 已在前次重构中改用 `var(--shadow-color)`。

- [ ] **Step 1: 统一树行高度与内边距**

在 `ResourceTree.styles.css` 和 `ResourceTreeItem.styles.css` 中，找到 `.tree-row` 定义，将行高统一（树行通常 32-36px，按控件 sm/md 阶梯选 32px 或 36px——树行偏紧凑用 32px），padding 改为 `0 var(--ui-space-md)`。

- [ ] **Step 2: 收敛其余碎值**

运行：`grep -nE '(padding|margin|gap|font-size|height):\s*[0-9]+px' frontend/src/components/library/ResourceTree.styles.css frontend/src/components/library/ResourceTreeItem.styles.css`

按映射表逐处处理。

- [ ] **Step 3: 视觉验证 + Commit**

```bash
git add frontend/src/components/library/ResourceTree.styles.css frontend/src/components/library/ResourceTreeItem.styles.css
git commit -m "style(visual): ResourceTree 行高统一/碎值收敛"
```

---

### Task 8: ToolboxPanel 结构统一

**Files:**
- Modify: `frontend/src/components/library/ToolboxPanel.styles.css`
- Modify: `frontend/src/components/library/ToolboxTile.styles.css`

**当前状态**：12 + 5 处魔数。

- [ ] **Step 1: 统一 ToolboxPanel header**

找到 header/title 区，高度对齐 `var(--ui-header-height)`，padding `0 var(--ui-space-xl)`，字号 `var(--ui-font-size-md)`。

- [ ] **Step 2: 统一 ToolboxTile 磁贴**

ToolboxTile 是工具磁贴，圆角用 `var(--ui-radius-md)`（12px，卡片级），内边距用 `var(--ui-space-md)` 或 `var(--ui-space-lg)`。

- [ ] **Step 3: 收敛碎值 + 验证 + Commit**

```bash
git add frontend/src/components/library/ToolboxPanel.styles.css frontend/src/components/library/ToolboxTile.styles.css
git commit -m "style(visual): ToolboxPanel/Tile 结构统一"
```

---

### Task 9: P1 整体验证（检查点）

- [ ] **Step 1: 四面板对齐验证**

`npm run dev`，确认 Inspector / DataLibrary / ResourceTree / Toolbox 四个核心面板的 header 顶部严格对齐到同一水平线（56px）。

- [ ] **Step 2: E2E 回归**

`cd e2e && npx playwright test`

预期：全通过。

---

## P2：高频弹层

### Task 10: SettingsModal 统一

**Files:**
- Modify: `frontend/src/common/SettingsModal.styles.css`（24 处魔数）

- [ ] **Step 1: 统一模态框圆角与内边距**

模态框容器圆角用 `var(--ui-radius-xl)`（24px），header 区高度 `var(--ui-header-height)`，body padding `var(--ui-space-lg)`。

- [ ] **Step 2: 收敛碎值**

逐处处理 24 处魔数。模态框内控件遵循控件规范（高度 36px、圆角 sm）。

- [ ] **Step 3: 验证 + Commit**

```bash
git add frontend/src/components/common/SettingsModal.styles.css
git commit -m "style(visual): SettingsModal 结构统一"
```

---

### Task 11: ProjectManagementModal 统一

**Files:**
- Modify: `frontend/src/components/common/ProjectManagementModal.styles.css`（7 处魔数）

- [ ] **Step 1: 同 Task 10 模式统一**

模态框容器 `var(--ui-radius-xl)`，header `var(--ui-header-height)`，收敛 7 处碎值。

- [ ] **Step 2: 验证 + Commit**

```bash
git add frontend/src/components/common/ProjectManagementModal.styles.css
git commit -m "style(visual): ProjectManagementModal 结构统一"
```

---

### Task 12: AssetLibraryNav 统一

**Files:**
- Modify: `frontend/src/components/layout/AssetLibraryNav.styles.css`（20 处魔数）

- [ ] **Step 1: 统一导航项高度与圆角**

导航项高度按控件阶梯（活动导航条目通常 36-40px），圆角 `var(--ui-radius-sm)`，收敛 20 处碎值。

- [ ] **Step 2: 验证 + Commit**

```bash
git add frontend/src/components/layout/AssetLibraryNav.styles.css
git commit -m "style(visual): AssetLibraryNav 结构统一"
```

---

### Task 13: P2 整体验证（检查点）

- [ ] **Step 1: 弹层验证**

打开 SettingsModal、ProjectManagementModal，确认圆角 24px、header 对齐、控件统一。

- [ ] **Step 2: E2E 回归**

`cd e2e && npx playwright test`

---

## P3：辅助面板

### Task 14: AIChatPanel 统一

**Files:**
- Modify: `frontend/src/components/ai/AIChatPanel.styles.css`（53 处魔数，密度最高）

- [ ] **Step 1: 统一面板结构**

header `var(--ui-header-height)`，消息区间距 `var(--ui-space-md)`，输入框遵循控件规范。

- [ ] **Step 2: 批量收敛 53 处碎值**

这是最大单文件，分批处理：先 header、再消息列表、再输入区。每处理一个区域做一次中间验证。

- [ ] **Step 3: 验证 + Commit**

```bash
git add frontend/src/components/ai/AIChatPanel.styles.css
git commit -m "style(visual): AIChatPanel 结构统一(53处碎值收敛)"
```

---

### Task 15: ResourceExplorerPanel + 其余 inspector 统一

**Files:**
- Modify: `frontend/src/components/library/ResourceExplorerPanel.styles.css`（4 处）
- Modify: `frontend/src/components/layout/inspectors/` 下其余单点问题文件

- [ ] **Step 1: 处理 ResourceExplorerPanel**

收敛 4 处碎值，header 区域对齐规范。

- [ ] **Step 2: 扫描 inspector 子组件**

运行：`grep -lE '(height|padding|margin|gap|font-size|border-radius):\s*(5|6|9|10|14|18|34|44|53|56)px' frontend/src/components/layout/inspectors/*.styles.css`

对命中的文件逐个收敛碎值。inspector 子组件多遵循 BaseInspector 模式，改动应趋同。

- [ ] **Step 3: 验证 + Commit**

```bash
git add frontend/src/components/library/ResourceExplorerPanel.styles.css frontend/src/components/layout/inspectors/
git commit -m "style(visual): ResourceExplorerPanel + inspector 子组件碎值收敛"
```

---

### Task 16: 全局最终验证

- [ ] **Step 1: 全应用三主题扫描**

`npm run dev`，light/dark/liquid 三主题下完整走查：面板对齐、控件统一、圆角一致、无残留明显碎值。

- [ ] **Step 2: E2E 全量回归**

`cd e2e && npx playwright test`

预期：全通过（130+ 用例）。

- [ ] **Step 3: 前端构建**

`cd frontend && npm run build`

预期：成功。

- [ ] **Step 4: 总结收尾**

在终端总结本批改动（文件数、收敛碎值数），确认无遗留问题。

---

## Self-Review 记录

（计划撰写后自检填入）

- **Spec 覆盖**：spec 第 3 节（令牌）→ Task 1-3；第 4 节（面板结构）→ Task 5-15；第 5 节（控件）→ Task 2-3 + 各面板任务；第 6 节（分批）→ P0-P3 对应 Task 1-16。✓
- **Placeholder**：无 TBD/TODO，每个 Step 都有具体操作或命令。✓
- **类型一致**：令牌名 `--ui-header-height`、`--radius-*`、`--ui-radius-*`、`--ui-space-*` 全文一致。✓
