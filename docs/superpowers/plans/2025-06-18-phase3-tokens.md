# Precis 设计系统重构 — Phase 3: 三层令牌架构

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立完整的三层令牌体系（Primitive → Semantic → Component），将现有 `theme.css` 中的变量迁移到新架构，同时保持向后兼容。

**Architecture:** 
- **Primitive 层**: 基础颜色、间距、字体、圆角、动画的原始值（参考 Tailwind CSS 命名）
- **Semantic 层**: 将 primitive 映射到语义用途（surface、text、border、shadow、z-index）
- **Component 层**: 组件专用令牌（button、input、node 等）
- **Compat 层**: 旧变量名 → 新变量名的映射，保证一个版本周期的向后兼容
- **Theme 层**: light/dark/liquid 三个主题，仅覆盖 primitive 颜色值

**Tech Stack:** CSS 自定义属性、CSS @layer、Vite

---

## 文件结构变更

### 新增/修改文件
- `frontend/src/assets/tokens/primitive.css` — 填充完整内容
- `frontend/src/assets/tokens/semantic.css` — 填充完整内容
- `frontend/src/assets/tokens/component.css` — 填充完整内容
- `frontend/src/assets/tokens/compat.css` — 填充完整旧→新映射
- `frontend/src/assets/themes/light.css` — 填充 Light 主题颜色覆盖
- `frontend/src/assets/themes/dark.css` — 填充 Dark 主题颜色覆盖
- `frontend/src/assets/themes/liquid.css` — 填充 Liquid 主题颜色覆盖
- `frontend/src/assets/main.css` — 启用新导入，注释旧导入

### 保留文件（Phase 4 后删除）
- `frontend/src/assets/theme.css` — 保留但标记为 deprecated

---

## Task 1: 填充 Primitive 层

**Files:**
- Modify: `frontend/src/assets/tokens/primitive.css`

**背景:** Primitive 层定义基础值，命名规范 `--{category}-{name}-{scale}`。颜色使用 Slate 色系（与 Tailwind 一致），间距使用 4px 基准。

- [ ] **Step 1: 定义颜色 primitive**

```css
:root {
  /* 颜色 — Slate 色系 */
  --color-slate-50: #f8fafc;
  --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;
  --color-slate-300: #cbd5e1;
  --color-slate-400: #94a3b8;
  --color-slate-500: #64748b;
  --color-slate-600: #475569;
  --color-slate-700: #334155;
  --color-slate-800: #1e293b;
  --color-slate-900: #0f172a;
  --color-slate-950: #020617;

  /* 强调色 — Sky */
  --color-sky-50: #f0f9ff;
  --color-sky-100: #e0f2fe;
  --color-sky-200: #bae6fd;
  --color-sky-300: #7dd3fc;
  --color-sky-400: #38bdf8;
  --color-sky-500: #0ea5e9;
  --color-sky-600: #0284c7;
  --color-sky-700: #0369a1;
  --color-sky-800: #075985;
  --color-sky-900: #0c4a6e;

  /* 语义色 — Emerald (success), Amber (warning), Rose (danger), Blue (info) */
  --color-emerald-50: #ecfdf5;
  --color-emerald-100: #d1fae5;
  --color-emerald-400: #34d399;
  --color-emerald-500: #10b981;
  --color-emerald-600: #059669;
  --color-emerald-700: #047857;

  --color-amber-50: #fffbeb;
  --color-amber-100: #fef3c7;
  --color-amber-400: #fbbf24;
  --color-amber-500: #f59e0b;
  --color-amber-600: #d97706;

  --color-rose-50: #fff1f2;
  --color-rose-100: #ffe4e6;
  --color-rose-400: #fb7185;
  --color-rose-500: #f43f5e;
  --color-rose-600: #e11d48;

  --color-blue-50: #eff6ff;
  --color-blue-100: #dbeafe;
  --color-blue-400: #60a5fa;
  --color-blue-500: #3b82f6;
  --color-blue-600: #2563eb;

  /* 白色透明度 */
  --color-white-10: rgba(255, 255, 255, 0.1);
  --color-white-15: rgba(255, 255, 255, 0.15);
  --color-white-20: rgba(255, 255, 255, 0.2);
  --color-white-30: rgba(255, 255, 255, 0.3);
  --color-white-40: rgba(255, 255, 255, 0.4);
  --color-white-50: rgba(255, 255, 255, 0.5);
  --color-white-60: rgba(255, 255, 255, 0.6);
  --color-white-80: rgba(255, 255, 255, 0.8);
  --color-white-90: rgba(255, 255, 255, 0.9);
  --color-white-95: rgba(255, 255, 255, 0.95);

  /* 黑色透明度 */
  --color-black-10: rgba(0, 0, 0, 0.1);
  --color-black-15: rgba(0, 0, 0, 0.15);
  --color-black-20: rgba(0, 0, 0, 0.2);
  --color-black-30: rgba(0, 0, 0, 0.3);
  --color-black-40: rgba(0, 0, 0, 0.4);
  --color-black-50: rgba(0, 0, 0, 0.5);
  --color-black-60: rgba(0, 0, 0, 0.6);
  --color-black-80: rgba(0, 0, 0, 0.8);
  --color-black-90: rgba(0, 0, 0, 0.9);
  --color-black-95: rgba(0, 0, 0, 0.95);

  /* 间距 — 4px 基准 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;
  --space-9: 36px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* 字体 */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;

  /* 字体大小 */
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  --font-size-3xl: 30px;

  /* 字重 */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* 行高 */
  --line-height-tight: 1.25;
  --line-height-normal: 1.6;
  --line-height-relaxed: 1.75;

  /* 圆角 */
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* 过渡 */
  --transition-fast: 0.15s ease-out;
  --transition-normal: 0.2s ease-out;
  --transition-slow: 0.3s ease-out;
  --transition-spring: 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/assets/tokens/primitive.css
git commit -m "feat(tokens): 填充 primitive 层 — 颜色、间距、字体、圆角、动画基础值

- 颜色：Slate 灰阶 + Sky 强调 + Emerald/Amber/Rose/Blue 语义色
- 间距：4px 基准，--space-1 到 --space-16
- 字体：Inter + JetBrains Mono，6 级字号
- 圆角：sm/md/lg/xl/full
- 过渡：fast/normal/slow/spring"
```

---

## Task 2: 填充 Semantic 层

**Files:**
- Modify: `frontend/src/assets/tokens/semantic.css`

**背景:** Semantic 层将 primitive 映射到语义用途。所有变量引用 primitive.css 中的变量。

- [ ] **Step 1: 定义语义令牌**

```css
:root {
  /* 背景 — 画布到表面 */
  --surface-canvas: var(--color-slate-100);
  --surface-base: var(--color-slate-100);
  --surface-elevated: rgba(255, 255, 255, 0.95);
  --surface-panel: rgba(255, 255, 255, 0.9);
  --surface-subtle: rgba(248, 250, 252, 0.8);
  --surface-muted: var(--color-slate-200);
  --surface-hover: rgba(241, 245, 249, 0.9);
  --surface-active: var(--color-slate-300);

  /* 文字 — 主到次 */
  --text-primary: var(--color-slate-900);
  --text-secondary: var(--color-slate-700);
  --text-tertiary: var(--color-slate-600);
  --text-quaternary: var(--color-slate-500);
  --text-muted: var(--color-slate-500);
  --text-subtle: var(--color-slate-400);
  --text-placeholder: var(--color-slate-300);
  --text-on-accent: #ffffff;
  --text-on-success: #ffffff;
  --text-on-warning: #ffffff;
  --text-on-danger: #ffffff;
  --text-on-info: #ffffff;

  /* 边框 */
  --border-subtle: rgba(241, 245, 249, 0.8);
  --border-light: rgba(226, 232, 240, 0.8);
  --border-default: var(--color-slate-300);
  --border-strong: var(--color-slate-400);
  --border-focus: var(--color-sky-400);
  --border-error: #fca5a5;
  --border-success: #6ee7b7;
  --border-warning: #fcd34d;
  --border-danger: #fca5a5;
  --border-info: #93c5fd;

  /* 强调色 */
  --accent: var(--color-sky-500);
  --accent-hover: var(--color-sky-600);
  --accent-light: var(--color-sky-400);
  --accent-strong: var(--color-sky-700);
  --accent-weak: rgba(14, 165, 233, 0.12);
  --accent-ring: rgba(14, 165, 233, 0.2);
  --accent-gradient: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%);

  /* 语义状态色 */
  --success: var(--color-emerald-400);
  --success-light: var(--color-emerald-100);
  --success-strong: var(--color-emerald-500);
  --success-weak: rgba(52, 211, 153, 0.12);
  --success-ring: rgba(52, 211, 153, 0.2);
  --success-bg: var(--color-emerald-50);
  --success-gradient: linear-gradient(135deg, #10b981 0%, #34d399 100%);

  --warning: var(--color-amber-400);
  --warning-light: var(--color-amber-100);
  --warning-strong: var(--color-amber-500);
  --warning-text: var(--color-amber-600);
  --warning-weak: rgba(251, 191, 36, 0.12);
  --warning-ring: rgba(251, 191, 36, 0.2);
  --warning-bg: var(--color-amber-50);
  --warning-gradient: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);

  --danger: #f87171;
  --danger-light: #fca5a5;
  --danger-strong: #ef4444;
  --danger-weak: rgba(248, 113, 113, 0.12);
  --danger-soft: rgba(248, 113, 113, 0.18);
  --danger-ring: rgba(248, 113, 113, 0.2);
  --danger-bg: #fef2f2;
  --danger-gradient: linear-gradient(135deg, #ef4444 0%, #f87171 100%);

  --info: #60a5fa;
  --info-light: #93c5fd;
  --info-strong: #3b82f6;
  --info-weak: rgba(96, 165, 250, 0.12);
  --info-ring: rgba(96, 165, 250, 0.2);
  --info-bg: #eff6ff;
  --info-gradient: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);

  /* 阴影 */
  --shadow-xs: 0 1px 2px rgba(45, 42, 38, 0.03);
  --shadow-sm: 0 1px 3px rgba(45, 42, 38, 0.04), 0 1px 2px rgba(45, 42, 38, 0.02);
  --shadow-md: 0 4px 8px -1px rgba(45, 42, 38, 0.05), 0 2px 4px -2px rgba(45, 42, 38, 0.03);
  --shadow-lg: 0 10px 20px -3px rgba(45, 42, 38, 0.06), 0 4px 8px -4px rgba(45, 42, 38, 0.04);
  --shadow-xl: 0 20px 30px -5px rgba(45, 42, 38, 0.06), 0 8px 12px -6px rgba(45, 42, 38, 0.04);
  --shadow-2xl: 0 25px 50px -12px rgba(45, 42, 38, 0.1);
  --shadow-hover: 0 12px 24px -5px rgba(45, 42, 38, 0.08), 0 6px 12px -4px rgba(45, 42, 38, 0.05);
  --shadow-focus: 0 0 0 3px var(--accent-ring);
  --shadow-glow: 0 0 0 4px rgba(90, 155, 199, 0.12);

  /* 遮罩 */
  --overlay-backdrop-soft: rgba(45, 42, 38, 0.24);
  --overlay-backdrop: rgba(45, 42, 38, 0.4);
  --overlay-backdrop-strong: rgba(45, 42, 38, 0.56);

  /* Z-Index */
  --z-dropdown: 100;
  --z-sidebar: 200;
  --z-sticky: 300;
  --z-fixed: 400;
  --z-loading: 450;
  --z-modal-backdrop: 500;
  --z-modal: 600;
  --z-popover: 700;
  --z-tooltip: 800;
  --z-notification: 900;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/assets/tokens/semantic.css
git commit -m "feat(tokens): 填充 semantic 层 — 语义映射令牌

- 背景：surface-canvas/base/elevated/panel/subtle/muted/hover/active
- 文字：text-primary/secondary/tertiary/muted/subtle/placeholder
- 边框：border-subtle/light/default/strong/focus + 状态色
- 强调色：accent + hover/light/strong/weak/ring/gradient
- 语义状态：success/warning/danger/info 完整色阶
- 阴影：xs/sm/md/lg/xl/2xl/hover/focus/glow
- 遮罩：backdrop-soft/backdrop/backdrop-strong
- Z-Index：dropdown 到 notification"
```

---

## Task 3: 填充 Component 层

**Files:**
- Modify: `frontend/src/assets/tokens/component.css`

**背景:** Component 层定义组件专用尺寸和样式，引用 semantic 层变量。

- [ ] **Step 1: 定义组件令牌**

```css
:root {
  /* 按钮 */
  --button-height-sm: 28px;
  --button-height-md: 36px;
  --button-height-lg: 44px;
  --button-padding-sm: 0 var(--space-3);
  --button-padding-md: 0 var(--space-4);
  --button-padding-lg: 0 var(--space-6);
  --button-radius: var(--radius-md);
  --button-font-size-sm: var(--font-size-xs);
  --button-font-size-md: var(--font-size-sm);
  --button-font-size-lg: var(--font-size-md);

  /* 输入框 */
  --input-height-md: 36px;
  --input-height-compact: 34px;
  --input-padding: 0 var(--space-3);
  --input-padding-compact: 0 var(--space-2);
  --input-radius: var(--radius-md);
  --input-border: var(--border-default);
  --input-border-focus: var(--border-focus);
  --input-bg: var(--surface-elevated);
  --input-bg-disabled: var(--surface-subtle);
  --input-font-size: var(--font-size-sm);
  --input-font-size-compact: var(--font-size-sm);

  /* 节点 */
  --node-min-width: 240px;
  --node-radius: var(--radius-lg);
  --node-border: var(--border-light);
  --node-border-hover: var(--border-default);
  --node-border-selected: var(--accent);
  --node-bg: var(--surface-elevated);
  --node-bg-hover: rgba(255, 255, 255, 0.98);
  --node-bg-selected: rgba(255, 255, 255, 1);
  --node-shadow: var(--shadow-md);
  --node-shadow-hover: var(--shadow-hover);
  --node-shadow-selected: 0 0 0 3px var(--accent-ring), var(--shadow-lg);

  /* 节点类型色 */
  --node-type-schema: var(--accent);
  --node-type-schema-bg: var(--accent-weak);
  --node-type-source: var(--success);
  --node-type-source-bg: var(--success-weak);
  --node-type-constraint: var(--warning);
  --node-type-constraint-bg: var(--warning-weak);
  --node-type-regex: #a78bfa;
  --node-type-regex-bg: rgba(167, 139, 250, 0.1);
  --node-type-transform: var(--info);
  --node-type-transform-bg: var(--info-weak);
  --node-type-manual: var(--danger);
  --node-type-manual-bg: var(--danger-weak);

  /* 设置面板 */
  --settings-overlay: color-mix(in srgb, var(--overlay-backdrop-strong) 88%, transparent);
  --settings-shell-bg: color-mix(in srgb, var(--surface-elevated) 96%, var(--surface-base));
  --settings-card-bg: color-mix(in srgb, var(--surface-elevated) 94%, var(--surface-base));
  --settings-card-border: color-mix(in srgb, var(--border-light) 92%, transparent);

  /* 画布 */
  --canvas-grid-color: var(--color-slate-500);
  --canvas-grid-opacity: 0.6;
  --canvas-grid-size: 32px;
  --canvas-grid-dot-size: 2px;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/assets/tokens/component.css
git commit -m "feat(tokens): 填充 component 层 — 组件专用令牌

- 按钮：height/padding/radius/font-size（sm/md/lg）
- 输入框：height/padding/radius/border/bg（标准 + compact）
- 节点：min-width/radius/border/bg/shadow + 类型色
- 设置面板：overlay/shell-bg/card-bg/card-border
- 画布：grid-color/opacity/size/dot-size"
```

---

## Task 4: 填充 Compat 层

**Files:**
- Modify: `frontend/src/assets/tokens/compat.css`

**背景:** Compat 层将旧变量名映射到新变量名，保证一个版本周期的向后兼容。所有 5,222 处 `var(--ui-*)` 引用通过此层继续工作。

- [ ] **Step 1: 定义兼容映射**

```css
/**
 * @file compat.css
 * @description 向后兼容别名 — 旧变量名映射到新变量名
 *
 * 生命周期：保留一个版本周期，下一主版本删除
 * 使用方式：在 main.css 中最后导入，覆盖任何旧引用
 */

:root {
  /* 背景 → surface */
  --ui-bg-canvas: var(--surface-canvas);
  --ui-bg-base: var(--surface-base);
  --ui-bg-elevated: var(--surface-elevated);
  --ui-bg-panel: var(--surface-panel);
  --ui-bg-surface: var(--surface-elevated);
  --ui-bg-subtle: var(--surface-subtle);
  --ui-bg-muted: var(--surface-muted);
  --ui-bg-hover: var(--surface-hover);
  --ui-bg-active: var(--surface-active);
  --ui-bg-node-header: var(--surface-elevated);

  /* 文字 → text */
  --ui-text-primary: var(--text-primary);
  --ui-text-secondary: var(--text-secondary);
  --ui-text-tertiary: var(--text-tertiary);
  --ui-text-quaternary: var(--text-quaternary);
  --ui-text-title: var(--text-primary);
  --ui-text-strong: var(--text-primary);
  --ui-text-body: var(--text-secondary);
  --ui-text: var(--text-secondary);
  --ui-text-muted: var(--text-muted);
  --ui-text-subtle: var(--text-subtle);
  --ui-text-placeholder: var(--text-placeholder);
  --ui-text-on-accent: var(--text-on-accent);
  --ui-text-on-success: var(--text-on-success);
  --ui-text-on-warning: var(--text-on-warning);
  --ui-text-on-danger: var(--text-on-danger);
  --ui-text-on-info: var(--text-on-info);

  /* 边框 → border */
  --ui-border-subtle: var(--border-subtle);
  --ui-border-light: var(--border-light);
  --ui-border: var(--border-default);
  --ui-border-strong: var(--border-strong);
  --ui-border-focus: var(--border-focus);
  --ui-border-error: var(--border-error);
  --ui-border-success: var(--border-success);
  --ui-border-warning: var(--border-warning);
  --ui-border-danger: var(--border-danger);
  --ui-border-info: var(--border-info);

  /* 强调色 → accent */
  --ui-accent: var(--accent);
  --ui-accent-primary: var(--accent);
  --ui-accent-hover: var(--accent-hover);
  --ui-accent-light: var(--accent-light);
  --ui-accent-strong: var(--accent-strong);
  --ui-accent-weak: var(--accent-weak);
  --ui-accent-ring: var(--accent-ring);
  --ui-accent-gradient: var(--accent-gradient);

  /* 语义状态色 */
  --ui-success: var(--success);
  --ui-success-light: var(--success-light);
  --ui-success-strong: var(--success-strong);
  --ui-success-weak: var(--success-weak);
  --ui-success-ring: var(--success-ring);
  --ui-success-bg: var(--success-bg);
  --ui-success-gradient: var(--success-gradient);

  --ui-warning: var(--warning);
  --ui-warning-light: var(--warning-light);
  --ui-warning-strong: var(--warning-strong);
  --ui-warning-text: var(--warning-text);
  --ui-warning-weak: var(--warning-weak);
  --ui-warning-ring: var(--warning-ring);
  --ui-warning-bg: var(--warning-bg);
  --ui-warning-gradient: var(--warning-gradient);

  --ui-danger: var(--danger);
  --ui-danger-light: var(--danger-light);
  --ui-danger-strong: var(--danger-strong);
  --ui-danger-weak: var(--danger-weak);
  --ui-danger-soft: var(--danger-soft);
  --ui-danger-ring: var(--danger-ring);
  --ui-danger-bg: var(--danger-bg);
  --ui-danger-gradient: var(--danger-gradient);

  --ui-info: var(--info);
  --ui-info-light: var(--info-light);
  --ui-info-strong: var(--info-strong);
  --ui-info-weak: var(--info-weak);
  --ui-info-ring: var(--info-ring);
  --ui-info-bg: var(--info-bg);
  --ui-info-gradient: var(--info-gradient);

  /* 阴影 → shadow */
  --ui-shadow-xs: var(--shadow-xs);
  --ui-shadow-sm: var(--shadow-sm);
  --ui-shadow-md: var(--shadow-md);
  --ui-shadow-lg: var(--shadow-lg);
  --ui-shadow-xl: var(--shadow-xl);
  --ui-shadow-2xl: var(--shadow-2xl);
  --ui-shadow-hover: var(--shadow-hover);
  --ui-shadow-focus: var(--shadow-focus);
  --ui-shadow-glow: var(--shadow-glow);
  --ui-focus-ring: var(--shadow-focus);

  /* 遮罩 → overlay */
  --ui-overlay-backdrop-soft: var(--overlay-backdrop-soft);
  --ui-overlay-backdrop: var(--overlay-backdrop);
  --ui-overlay-backdrop-strong: var(--overlay-backdrop-strong);

  /* Z-Index → z */
  --ui-z-dropdown: var(--z-dropdown);
  --ui-z-sidebar: var(--z-sidebar);
  --ui-z-sticky: var(--z-sticky);
  --ui-z-fixed: var(--z-fixed);
  --ui-z-loading: var(--z-loading);
  --ui-z-modal-backdrop: var(--z-modal-backdrop);
  --ui-z-modal: var(--z-modal);
  --ui-z-popover: var(--z-popover);
  --ui-z-tooltip: var(--z-tooltip);
  --ui-z-notification: var(--z-notification);

  /* 间距 → space */
  --ui-space-xs: var(--space-1);
  --ui-space-sm: var(--space-2);
  --ui-space-md: var(--space-3);
  --ui-space-lg: var(--space-4);
  --ui-space-xl: var(--space-6);
  --ui-space-2xl: var(--space-8);
  --ui-space-3xl: var(--space-10);

  /* 圆角 → radius */
  --ui-radius-sm: var(--radius-sm);
  --ui-radius-md: var(--radius-md);
  --ui-radius-lg: var(--radius-lg);
  --ui-radius-xl: var(--radius-xl);
  --ui-radius-full: var(--radius-full);

  /* 字体 → font */
  --ui-font-family: var(--font-sans);
  --ui-font-mono: var(--font-mono);
  --ui-font-size-xs: var(--font-size-xs);
  --ui-font-size-sm: var(--font-size-sm);
  --ui-font-size-md: var(--font-size-md);
  --ui-font-size-lg: var(--font-size-lg);
  --ui-font-size-xl: var(--font-size-xl);
  --ui-font-size-2xl: var(--font-size-2xl);
  --ui-font-size-3xl: var(--font-size-3xl);
  --ui-font-weight-normal: var(--font-weight-normal);
  --ui-font-weight-medium: var(--font-weight-medium);
  --ui-font-weight-semibold: var(--font-weight-semibold);
  --ui-font-weight-bold: var(--font-weight-bold);
  --ui-line-height-tight: var(--line-height-tight);
  --ui-line-height-normal: var(--line-height-normal);
  --ui-line-height-relaxed: var(--line-height-relaxed);

  /* 过渡 → transition */
  --ui-transition-fast: var(--transition-fast);
  --ui-transition-normal: var(--transition-normal);
  --ui-transition-slow: var(--transition-slow);
  --ui-transition-spring: var(--transition-spring);

  /* 画布网格 → canvas */
  --ui-grid-color: var(--canvas-grid-color);
  --ui-grid-opacity: var(--canvas-grid-opacity);
  --ui-grid-size: var(--canvas-grid-size);
  --ui-grid-dot-size: var(--canvas-grid-dot-size);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/assets/tokens/compat.css
git commit -m "feat(tokens): 填充 compat 层 — 完整旧→新变量映射

- 覆盖全部 5,222 处 --ui-* 引用的映射关系
- 背景/文字/边框/强调色/语义状态/阴影/遮罩/Z-Index/间距/圆角/字体/过渡/画布
- 保留一个版本周期，下一主版本删除"
```

---

## Task 5: 填充 Theme 层

**Files:**
- Modify: `frontend/src/assets/themes/light.css`
- Modify: `frontend/src/assets/themes/dark.css`
- Modify: `frontend/src/assets/themes/liquid.css`

**背景:** Theme 层仅覆盖 primitive 颜色值。Light 主题使用默认值（无需覆盖），Dark 和 Liquid 覆盖对应颜色。

- [ ] **Step 1: 填充 light.css**

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

- [ ] **Step 2: 填充 dark.css**

```css
/**
 * @file themes/dark.css
 * @description Dark 主题 — 覆盖 primitive 颜色值
 */

[data-theme='dark'] {
  /* Slate 暗色 */
  --color-slate-50: #0f172a;
  --color-slate-100: #1e293b;
  --color-slate-200: #334155;
  --color-slate-300: #475569;
  --color-slate-400: #64748b;
  --color-slate-500: #94a3b8;
  --color-slate-600: #cbd5e1;
  --color-slate-700: #e2e8f0;
  --color-slate-800: #f1f5f9;
  --color-slate-900: #f8fafc;
  --color-slate-950: #ffffff;

  /* Sky 暗色 */
  --color-sky-50: rgba(14, 165, 233, 0.15);
  --color-sky-100: rgba(14, 165, 233, 0.1);
  --color-sky-200: rgba(14, 165, 233, 0.2);
  --color-sky-400: #38bdf8;
  --color-sky-500: #0ea5e9;
  --color-sky-600: #38bdf8;
  --color-sky-700: #7dd3fc;

  /* 语义色暗色 */
  --color-emerald-50: rgba(52, 211, 153, 0.14);
  --color-emerald-100: rgba(52, 211, 153, 0.1);
  --color-emerald-400: #34d399;
  --color-emerald-500: #10b981;

  --color-amber-50: rgba(251, 191, 36, 0.14);
  --color-amber-100: rgba(251, 191, 36, 0.1);
  --color-amber-400: #fbbf24;
  --color-amber-500: #f59e0b;

  --color-rose-50: rgba(248, 113, 113, 0.14);
  --color-rose-100: rgba(248, 113, 113, 0.1);
  --color-rose-400: #f87171;
  --color-rose-500: #ef4444;

  --color-blue-50: rgba(56, 189, 248, 0.14);
  --color-blue-100: rgba(56, 189, 248, 0.1);
  --color-blue-400: #38bdf8;
  --color-blue-500: #60a5fa;

  /* 白色透明度（暗色主题反转为黑色透明度） */
  --color-white-10: rgba(0, 0, 0, 0.1);
  --color-white-15: rgba(0, 0, 0, 0.15);
  --color-white-20: rgba(0, 0, 0, 0.2);
  --color-white-30: rgba(0, 0, 0, 0.3);
  --color-white-40: rgba(0, 0, 0, 0.4);
  --color-white-50: rgba(0, 0, 0, 0.5);
  --color-white-60: rgba(0, 0, 0, 0.6);
  --color-white-80: rgba(0, 0, 0, 0.8);
  --color-white-90: rgba(0, 0, 0, 0.9);
  --color-white-95: rgba(0, 0, 0, 0.95);
}
```

- [ ] **Step 3: 填充 liquid.css**

```css
/**
 * @file themes/liquid.css
 * @description Liquid 主题 — 覆盖 primitive 颜色值 + 特殊材质
 */

[data-theme='liquid'] {
  /* Slate → 带蓝调的柔和灰 */
  --color-slate-50: #f7f9fc;
  --color-slate-100: #eef2f7;
  --color-slate-200: #e1e8f0;
  --color-slate-300: #cdd6e3;
  --color-slate-400: #a6b3c4;
  --color-slate-500: #7a8ba1;
  --color-slate-600: #5c6b80;
  --color-slate-700: #3d4a5f;
  --color-slate-800: #232d3d;
  --color-slate-900: #111827;

  /* Sky → 极光蓝 */
  --color-sky-400: #6bb8ff;
  --color-sky-500: #3aa0ff;
  --color-sky-600: #268df0;
  --color-sky-700: #1d7ad9;

  /* 语义色 → 柔和 pastel */
  --color-emerald-400: #4cd7a8;
  --color-emerald-500: #2db88a;

  --color-amber-400: #f9c66b;
  --color-amber-500: #e5ad3d;

  --color-rose-400: #ff8a8a;
  --color-rose-500: #e85d5d;

  --color-blue-400: #72b8ff;
  --color-blue-500: #4a9df0;

  /* 特殊材质令牌（Liquid 独有） */
  --material-glass-bg: rgba(255, 255, 255, 0.78);
  --material-glass-border: rgba(255, 255, 255, 0.72);
  --material-aurora-1: radial-gradient(ellipse at 10% 10%, rgba(120, 180, 255, 0.22) 0%, transparent 50%);
  --material-aurora-2: radial-gradient(ellipse at 90% 20%, rgba(180, 160, 255, 0.18) 0%, transparent 45%);
  --material-aurora-3: radial-gradient(ellipse at 80% 90%, rgba(130, 220, 200, 0.16) 0%, transparent 45%);
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/assets/themes/
git commit -m "feat(tokens): 填充 Theme 层 — Light/Dark/Liquid 颜色覆盖

- light.css: 默认主题，保留扩展位置
- dark.css: 覆盖 Slate 灰阶、Sky 强调色、语义色为暗色值
- liquid.css: 覆盖为柔和 pastel 色 + 玻璃材质令牌（aurora/glass）"
```

---

## Task 6: 启用新架构

**Files:**
- Modify: `frontend/src/assets/main.css`

**背景:** 启用新的三层令牌导入，同时保留 `theme.css` 的导入（通过 compat 层保证兼容）。

- [ ] **Step 1: 更新 main.css 导入顺序**

修改 `frontend/src/assets/main.css`：

```css
@layer reset, vendor, tokens, ui, graph;

@import '@vue-flow/core/dist/style.css' layer(vendor);
@import '@vue-flow/core/dist/theme-default.css' layer(vendor);
@import './base.css' layer(reset);

/* 三层令牌体系 — Phase 3 启用 */
@import './tokens/primitive.css' layer(tokens);
@import './tokens/semantic.css' layer(tokens);
@import './tokens/component.css' layer(tokens);
@import './themes/light.css' layer(tokens);
@import './themes/dark.css' layer(tokens);

/* 向后兼容 — 将旧 --ui-* 映射到新令牌 */
@import './tokens/compat.css' layer(tokens);

/* 旧 theme.css — 保留但仅提供未被 compat 覆盖的变量 */
/* @import './theme.css' layer(tokens); */

@import './tokens/node-tokens.css' layer(tokens);
@import './ui.css' layer(ui);
@import './app-shell.css' layer(ui);
@import './graph-node.css' layer(graph);

/* Liquid 主题覆盖 — 放在 layer 外以覆盖所有层 */
@import './themes/liquid.css';
@import './theme-liquid.css';
```

**注意**: `theme.css` 被注释掉，因为 compat 层已经覆盖了所有 `--ui-*` 变量。但保留注释以便快速回滚。

- [ ] **Step 2: 验证构建**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 3: 运行测试**

Run: `cd frontend && npm run test 2>&1 | tail -10`
Expected: 88 passed, 2 failed（与基线一致）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/assets/main.css
git commit -m "feat(tokens): 启用三层令牌架构

- main.css 启用 primitive/semantic/component/compat/theme 导入
- 注释 theme.css 导入（compat 层已覆盖所有 --ui-* 变量）
- 保留 theme.css 注释以便快速回滚"
```

---

## Task 7: 验证与清理

- [ ] **Step 1: 检查关键变量映射**

Run: `grep -n "var(--ui-bg-canvas)" frontend/src/components/**/*.vue | head -5`
Expected: 文件存在且变量可解析（通过 compat 层映射到 --surface-canvas）

- [ ] **Step 2: 检查构建产物**

Run: `cd frontend && npm run build 2>&1 | grep -i "error" | head -10`
Expected: 无 CSS 相关错误

- [ ] **Step 3: 最终验证**

Run: `cd frontend && npm run test 2>&1 | tail -5`
Expected: 88 passed, 2 failed

- [ ] **Step 4: 最终 Commit**

```bash
git commit --allow-empty -m "chore: Phase 3 完成 — 三层令牌架构

- 建立 Primitive → Semantic → Component 三层令牌体系
- 填充完整颜色、间距、字体、圆角、动画基础值
- 建立完整语义映射（surface/text/border/shadow/overlay/z-index）
- 建立组件专用令牌（button/input/node/settings/canvas）
- 建立完整 compat 映射，保证 5,222 处旧引用继续工作
- 建立 Light/Dark/Liquid 主题覆盖层
- 启用新架构，注释旧 theme.css 导入
- 测试基线：88 passed, 2 failed"
```

---

## 验证清单

- [ ] `primitive.css` 包含完整颜色、间距、字体、圆角、动画定义
- [ ] `semantic.css` 包含完整 surface/text/border/shadow/overlay/z-index 映射
- [ ] `component.css` 包含 button/input/node/settings/canvas 组件令牌
- [ ] `compat.css` 包含所有 `--ui-*` → 新令牌的映射
- [ ] `themes/dark.css` 覆盖 Slate 灰阶为暗色值
- [ ] `themes/liquid.css` 覆盖为 pastel 色 + 玻璃材质
- [ ] `main.css` 启用新导入，注释 `theme.css`
- [ ] 前端构建成功
- [ ] 前端测试通过数与基线一致（88 passed）

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Compat 映射遗漏 | 中 | 通过 grep 统计所有 `--ui-*` 定义，确保每个都有映射 |
| 变量循环引用 | 低 | 检查 compat 层只引用 semantic，不引用自身 |
| 主题覆盖优先级错误 | 低 | Liquid 放在 layer 外，Dark 在 layer 内，确保正确覆盖 |
| 构建失败 | 低 | 每步构建验证，快速回滚机制（取消注释 theme.css） |

---

*Phase 3 结束 — 准备进入 Phase 4: 视觉改进*
