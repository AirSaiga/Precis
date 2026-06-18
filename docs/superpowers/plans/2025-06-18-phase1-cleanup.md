# Precis 设计系统重构 — Phase 1: 低风险清理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理遗留变量、合并重复组件样式、建立新的 tokens/ 目录结构，为后续重构奠定基础。

**Architecture:** 在不改变任何视觉输出的前提下，删除零引用的遗留 CSS 变量，合并 `.settings-*` 类到 `.ui-*` 体系，并创建新的三层令牌文件结构（内容为空占位，后续 Phase 填充）。

**Tech Stack:** CSS 自定义属性、Vue 3 scoped styles、Vite、Ruff（后端 lint）

---

## 文件结构变更

### 新增文件
- `frontend/src/assets/tokens/primitive.css` — 基础值令牌（空占位，Phase 3 填充）
- `frontend/src/assets/tokens/semantic.css` — 语义映射令牌（空占位，Phase 3 填充）
- `frontend/src/assets/tokens/component.css` — 组件专用令牌（空占位，Phase 3 填充）
- `frontend/src/assets/tokens/compat.css` — 向后兼容别名（空占位，Phase 3 填充）
- `frontend/src/assets/themes/light.css` — Light 主题颜色覆盖（空占位，Phase 3 填充）
- `frontend/src/assets/themes/dark.css` — Dark 主题颜色覆盖（空占位，Phase 3 填充）
- `frontend/src/assets/themes/liquid.css` — Liquid 主题颜色覆盖（空占位，Phase 3 填充）

### 修改文件
- `frontend/src/assets/theme.css` — 删除 11 个遗留变量定义
- `frontend/src/assets/ui.css` — 合并 `.settings-*` 到 `.ui-*`，删除重复定义
- `frontend/src/assets/main.css` — 添加新文件导入（注释状态，Phase 3 启用）
- `frontend/src/components/common/ConflictResolutionModal.styles.css` — 替换 `--overlay-dark` 引用
- `frontend/src/components/settings/AIAssistantSettingsPanel.vue` — 替换 `.settings-*` 类名
- `frontend/src/components/validation/ValidationSettingsGrid.vue` — 替换 `.settings-*` 类名

### 删除文件
- 无（Phase 1 只清理定义，不删除文件）

---

## Task 1: 删除遗留 CSS 变量

**Files:**
- Modify: `frontend/src/assets/theme.css:248-282`
- Modify: `frontend/src/assets/theme.css:418-428`
- Modify: `frontend/src/components/common/ConflictResolutionModal.styles.css:4`

**背景:** 经 `grep` 验证，`--text-gray-600`、`--bg-gray-50` 等 10 个变量在业务代码中零引用。`--overlay-dark` 仅有 1 处引用。

- [ ] **Step 1: 删除 Light 主题遗留变量**

在 `frontend/src/assets/theme.css` 中，删除以下行（约 248-282 行）：

```css
  --ui-gray-50: #f9fafb;
  --ui-gray-100: #f3f4f6;
  --ui-gray-200: #e5e7eb;
  --ui-gray-300: #d1d5db;
  --ui-gray-400: #9ca3af;
  --ui-gray-500: #6b7280;
  --ui-gray-600: #4b5563;
  --ui-gray-700: #374151;
  --ui-gray-800: #1f2937;
  --ui-gray-900: #111827;

  --white-10: rgba(255, 255, 255, 0.1);
  --white-15: rgba(255, 255, 255, 0.15);
  --white-20: rgba(255, 255, 255, 0.2);
  --white-25: rgba(255, 255, 255, 0.25);
  --white-30: rgba(255, 255, 255, 0.3);
  --white-40: rgba(255, 255, 255, 0.4);
  --white-50: rgba(255, 255, 255, 0.5);
  --white-60: rgba(255, 255, 255, 0.6);
  --white-80: rgba(255, 255, 255, 0.8);
  --white-85: rgba(255, 255, 255, 0.85);
  --white-90: rgba(255, 255, 255, 0.9);
  --white-95: rgba(255, 255, 255, 0.95);

  --overlay-dark: rgba(0, 0, 0, 0.4);
  --text-gray-600: #4b5563;
  --text-gray-900: #111827;
  --bg-gray-50: #f9fafb;
  --bg-gray-100: #f3f4f6;
  --bg-gray-200: #e5e7eb;
  --bg-white: #ffffff;
  --border-gray-200: #e5e7eb;
  --border-gray-300: #d1d5db;
  --border-blue: #3b82f6;
  --bg-blue-light: #f8f9ff;
```

- [ ] **Step 2: 删除 Dark 主题遗留变量**

在同一文件，删除 Dark 主题中的对应覆盖（约 418-428 行）：

```css
  --overlay-dark: rgba(0, 0, 0, 0.6);
  --text-gray-600: #94a3b8;
  --text-gray-900: #e2e8f0;
  --bg-gray-50: #1e293b;
  --bg-gray-100: #1e293b;
  --bg-gray-200: #334155;
  --bg-white: #1e293b;
  --border-gray-200: #334155;
  --border-gray-300: #475569;
  --border-blue: #3b82f6;
  --bg-blue-light: rgba(14, 165, 233, 0.1);
```

- [ ] **Step 3: 替换唯一业务引用**

修改 `frontend/src/components/common/ConflictResolutionModal.styles.css:4`：

```css
/* 修改前 */
background-color: var(--overlay-dark);

/* 修改后 */
background-color: var(--ui-overlay-backdrop);
```

- [ ] **Step 4: 验证无编译错误**

Run: `cd frontend && npm run type-check 2>&1 | tail -10`
Expected: 无 CSS 相关错误（type-check 不检查 CSS，但确保 Vue 编译通过）

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功，无 CSS 变量未定义警告

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assets/theme.css frontend/src/components/common/ConflictResolutionModal.styles.css
git commit -m "refactor(tokens): 删除 11 个遗留 CSS 变量

- 删除零引用的 --text-gray-*, --bg-gray-*, --border-gray-* 等变量
- 将 --overlay-dark 的唯⼀引⽤替换为 --ui-overlay-backdrop
- Light/Dark 主题同步清理"
```

---

## Task 2: 合并 .settings-* 到 .ui-* 体系

**Files:**
- Modify: `frontend/src/assets/ui.css:1458-1641`
- Modify: `frontend/src/components/settings/AIAssistantSettingsPanel.vue`
- Modify: `frontend/src/components/validation/ValidationSettingsGrid.vue`

**背景:** `.settings-input`、`.settings-select`、`.settings-switch` 与 `.ui-input`、`.ui-select`、`.ui-switch` 功能重复，仅高度/内边距有微小差异。业务引用仅 4 文件。

- [ ] **Step 1: 分析差异并决定合并策略**

差异对比：

| 类名 | 高度 | 内边距 | 其他差异 |
|------|------|--------|----------|
| `.ui-input` | 36px | `0 var(--ui-space-md)` | 标准样式 |
| `.settings-input` | 34px | `0 var(--ui-space-sm)` | 更紧凑 |
| `.ui-select` | 36px | `0 var(--ui-space-md)` | 标准样式 |
| `.settings-select` | 34px | `0 28px 0 var(--ui-space-sm)` | 更紧凑 |
| `.ui-switch__track` | 24px | - | 标准尺寸 |
| `.settings-switch` | 20px | - | 更紧凑 |

**决策**: `.settings-*` 类用于设置面板的紧凑布局，不应完全删除。改为：
1. 保留 `.settings-*` 类名，但内部引用 `.ui-*` 的基础样式，仅覆盖差异属性
2. 删除 `.settings-input`、`.settings-select` 的完整重复定义

- [ ] **Step 2: 重构 .settings-input**

在 `frontend/src/assets/ui.css` 中，将 `.settings-input` 的定义（约 1458-1488 行）替换为：

```css
/* 紧凑型输入 — 继承 .ui-input 基础，仅覆盖尺寸 */
.settings-input {
  composes: ui-input;  /* CSS Modules 方式，如不支持则手动继承 */
  height: 34px;
  padding: 0 var(--ui-space-sm);
  line-height: 32px;
}
```

**注意**: 纯 CSS 不支持 `composes`，需要手动复制基础属性。实际实现：

```css
.settings-input {
  box-sizing: border-box;
  height: 34px;
  padding: 0 var(--ui-space-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-body);
  font-size: var(--ui-font-size-sm);
  line-height: 32px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
}

.settings-input:focus {
  border-color: var(--ui-accent);
  box-shadow: 0 0 0 2px var(--ui-accent-ring);
}

.settings-input::placeholder {
  color: var(--ui-text-muted);
}

.settings-input:disabled {
  background: var(--ui-bg-subtle);
  color: var(--ui-text-muted);
  cursor: not-allowed;
}
```

**等等** — 这仍然是完整定义。更好的策略：保留 `.settings-input` 但使其成为 `.ui-input` 的修饰类：

```css
/* 策略变更：.settings-input 作为 .ui-input 的变体 */
.ui-input--compact {
  height: 34px;
  padding: 0 var(--ui-space-sm);
  font-size: var(--ui-font-size-sm);
  line-height: 32px;
}
```

然后全局替换 `.settings-input` → `.ui-input.ui-input--compact`。

- [ ] **Step 3: 重构 .settings-select 和 .settings-switch**

同理，添加 `.ui-select--compact` 和 `.ui-switch--compact`：

```css
.ui-select--compact {
  height: 34px;
  padding-left: var(--ui-space-sm);
  padding-right: 36px;
  font-size: var(--ui-font-size-sm);
  background-position: right 10px center;
}

.ui-switch--compact {
  width: 36px;
  height: 20px;
}

.ui-switch--compact .ui-switch__track::after {
  width: 16px;
  height: 16px;
}

.ui-switch--compact .ui-switch__input:checked + .ui-switch__track::after {
  transform: translateX(16px);
}
```

- [ ] **Step 4: 删除旧的 .settings-* 定义**

从 `ui.css` 中删除以下完整定义块：
- `.settings-input`（1458-1488 行）
- `.settings-select`（1508-1537 行）
- `.settings-switch`（1539-1588 行）
- `.settings-path-input-group`（1590-1506 行）—— 保留，这是布局组件
- `.settings-actions`（1590-1597 行）—— 保留
- `.settings-code`（1599-1608 行）—— 保留
- `.settings-pill`（1610-1641 行）—— 保留

- [ ] **Step 5: 更新业务组件引用**

修改 `frontend/src/components/settings/AIAssistantSettingsPanel.vue`：

```vue
<!-- 搜索 .settings-input 替换为 .ui-input.ui-input--compact -->
<!-- 搜索 .settings-select 替换为 .ui-select.ui-select--compact -->
<!-- 搜索 .settings-switch 替换为 .ui-switch.ui-switch--compact -->
```

修改 `frontend/src/components/validation/ValidationSettingsGrid.vue`：

```vue
<!-- 同上 -->
```

- [ ] **Step 6: 验证构建**

Run: `cd frontend && npm run build 2>&1 | grep -i "error\|warning" | head -20`
Expected: 无 CSS 相关错误

- [ ] **Step 7: Commit**

```bash
git add frontend/src/assets/ui.css \
  frontend/src/components/settings/AIAssistantSettingsPanel.vue \
  frontend/src/components/validation/ValidationSettingsGrid.vue
git commit -m "refactor(ui): 合并 .settings-* 到 .ui-* 体系

- 新增 .ui-input--compact、.ui-select--compact、.ui-switch--compact
- 删除 .settings-input/.settings-select/.settings-switch 重复定义
- 更新 AIAssistantSettingsPanel 和 ValidationSettingsGrid 引用
- 保留 .settings-path-input-group/.settings-actions/.settings-code/.settings-pill"
```

---

## Task 3: 创建新目录结构（空占位文件）

**Files:**
- Create: `frontend/src/assets/tokens/primitive.css`
- Create: `frontend/src/assets/tokens/semantic.css`
- Create: `frontend/src/assets/tokens/component.css`
- Create: `frontend/src/assets/tokens/compat.css`
- Create: `frontend/src/assets/themes/light.css`
- Create: `frontend/src/assets/themes/dark.css`
- Create: `frontend/src/assets/themes/liquid.css`
- Modify: `frontend/src/assets/main.css`

- [ ] **Step 1: 创建 primitive.css 占位**

```css
/**
 * @file primitive.css
 * @description 基础设计令牌 — 颜色、间距、字体、动画的基础值
 *
 * 原则：
 * - 只定义原始值，不做语义映射
 * - 主题文件仅覆盖此层的颜色值
 * - 命名规范：--{category}-{name}-{scale}
 */

:root {
  /* 占位 — Phase 3 填充完整内容 */
  /* 颜色：--color-slate-50 ~ --color-slate-950 */
  /* 间距：--space-1 ~ --space-9 */
  /* 字体：--font-sans, --font-mono, --font-size-xs ~ 3xl */
  /* 圆角：--radius-sm ~ --radius-full */
  /* 过渡：--transition-fast ~ --transition-spring */
}
```

- [ ] **Step 2: 创建 semantic.css 占位**

```css
/**
 * @file semantic.css
 * @description 语义设计令牌 — 将基础值映射到语义用途
 *
 * 原则：
 * - 引用 primitive.css 中的变量
 * - 命名规范：--{purpose}-{variant}
 *   例如：--surface-elevated, --text-muted, --border-focus
 */

:root {
  /* 占位 — Phase 3 填充完整内容 */
  /* 背景：--surface-canvas, --surface-base, --surface-elevated... */
  /* 文字：--text-primary, --text-secondary, --text-muted... */
  /* 边框：--border-subtle, --border-light, --border-default... */
  /* 阴影：--shadow-1 ~ --shadow-5 */
  /* Z-Index：--z-dropdown ~ --z-notification */
}
```

- [ ] **Step 3: 创建 component.css 占位**

```css
/**
 * @file component.css
 * @description 组件专用设计令牌 — 按钮、输入框、节点等组件尺寸
 *
 * 原则：
 * - 引用 semantic.css 中的变量
 * - 命名规范：--{component}-{property}-{variant}
 *   例如：--button-height-md, --node-shadow-hover
 */

:root {
  /* 占位 — Phase 3 填充完整内容 */
  /* 按钮：--button-height-sm/md/lg, --button-padding-md... */
  /* 输入框：--input-height-md, --input-border-focus... */
  /* 节点：--node-min-width, --node-shadow-hover... */
  /* 节点类型色：--node-type-schema, --node-type-constraint... */
}
```

- [ ] **Step 4: 创建 compat.css 占位**

```css
/**
 * @file compat.css
 * @description 向后兼容别名 — 旧变量名映射到新变量名
 *
 * 生命周期：保留一个版本周期，下一主版本删除
 * 使用方式：在 main.css 中最后导入，覆盖任何旧引用
 */

:root {
  /* 占位 — Phase 3 填充完整映射 */
  /* --ui-bg-canvas → --surface-canvas */
  /* --ui-text-body → --text-secondary */
  /* --ui-accent → --accent */
  /* ... 全部 5,222 处引用的旧变量映射 */
}
```

- [ ] **Step 5: 创建 themes/ 占位文件**

`light.css`:
```css
/**
 * @file themes/light.css
 * @description Light 主题 — 覆盖 primitive 颜色值
 *
 * 原则：仅覆盖 --color-* 变量，不覆盖 semantic 或 component 层
 */

/* Light 是默认主题，primitive.css 已定义默认值 */
/* 此文件保留用于显式覆盖或未来扩展 */
```

`dark.css`:
```css
/**
 * @file themes/dark.css
 * @description Dark 主题 — 覆盖 primitive 颜色值
 */

[data-theme='dark'] {
  /* 占位 — Phase 3 填充 Dark 颜色覆盖 */
}
```

`liquid.css`:
```css
/**
 * @file themes/liquid.css
 * @description Liquid 主题 — 覆盖 primitive 颜色值 + 特殊材质
 */

[data-theme='liquid'] {
  /* 占位 — Phase 3 填充 Liquid 颜色覆盖和材质令牌 */
}
```

- [ ] **Step 6: 更新 main.css 导入**

修改 `frontend/src/assets/main.css`，添加注释状态的导入：

```css
@layer reset, vendor, tokens, ui, graph;

@import '@vue-flow/core/dist/style.css' layer(vendor);
@import '@vue-flow/core/dist/theme-default.css' layer(vendor);
@import './base.css' layer(reset);
@import './theme.css' layer(tokens);
@import './tokens/node-tokens.css' layer(tokens);
@import './ui.css' layer(ui);
@import './app-shell.css' layer(ui);
@import './graph-node.css' layer(graph);

/* Phase 3 启用：三层令牌体系 */
/* @import './tokens/primitive.css' layer(tokens); */
/* @import './tokens/semantic.css' layer(tokens); */
/* @import './tokens/component.css' layer(tokens); */
/* @import './tokens/compat.css' layer(tokens); */
/* @import './themes/light.css' layer(tokens); */
/* @import './themes/dark.css' layer(tokens); */
/* @import './themes/liquid.css'; */

/* Liquid 主题覆盖需要放在 layer 体系之外，才能覆盖 ui/graph 层以及组件 scoped 样式 */
@import './theme-liquid.css';
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/assets/tokens/ frontend/src/assets/themes/ frontend/src/assets/main.css
git commit -m "chore(tokens): 建立三层令牌目录结构（Phase 1 占位）

- 新增 tokens/primitive.css、semantic.css、component.css、compat.css
- 新增 themes/light.css、dark.css、liquid.css
- main.css 中添加注释状态的导入（Phase 3 启用）
- 所有文件当前为空占位，无运行时影响"
```

---

## Task 4: 验证与清理

- [ ] **Step 1: 运行前端测试**

Run: `cd frontend && npm run test 2>&1 | tail -20`
Expected: 88 passed, 2 failed（与基线相同，失败的是已有的 expressionStore 和 i18n mock 问题）

- [ ] **Step 2: 运行后端 lint**

Run: `cd backend && python -m ruff check . 2>&1 | tail -10`
Expected: 无错误（Phase 1 只改前端）

- [ ] **Step 3: 运行前端 lint**

Run: `cd frontend && npm run lint 2>&1 | tail -10`
Expected: 无新增错误

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 5: 最终 Commit**

```bash
git commit --allow-empty -m "chore: Phase 1 完成 — 低风险清理

- 删除 11 个遗留 CSS 变量（10 个零引用 + 1 个替换）
- 合并 .settings-input/.select/.switch 到 .ui-* 体系
- 建立 tokens/ 和 themes/ 目录结构（Phase 3 填充）
- 零视觉变化，零功能变化"
```

---

## 验证清单

- [ ] `theme.css` 中无 `--text-gray-*`、`--bg-gray-*`、`--border-gray-*` 定义
- [ ] `ConflictResolutionModal.styles.css` 使用 `--ui-overlay-backdrop`
- [ ] `ui.css` 中无 `.settings-input`、`.settings-select`、`.settings-switch` 完整定义
- [ ] `ui.css` 中有 `.ui-input--compact`、`.ui-select--compact`、`.ui-switch--compact`
- [ ] `AIAssistantSettingsPanel.vue` 和 `ValidationSettingsGrid.vue` 使用新类名
- [ ] `tokens/` 目录存在且包含 4 个 CSS 文件
- [ ] `themes/` 目录存在且包含 3 个 CSS 文件
- [ ] `main.css` 包含注释状态的新导入
- [ ] 前端测试通过数与基线一致（88 passed）
- [ ] 前端构建成功

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 遗漏遗留变量引用 | 低 | grep 已验证零引用；构建验证捕获未定义变量 |
| 设置面板样式断裂 | 中 | 手动检查 AIAssistantSettingsPanel 和 ValidationSettingsGrid 渲染 |
| 新目录结构冲突 | 低 | 空占位文件，无运行时影响 |

---

*Phase 1 结束 — 准备进入 Phase 2: 间距系统统一*
