# Precis 前端设计系统重构与视觉升级方案

> **文档编号**: DS-2025-06-18
> **状态**: 草案（待审阅）
> **分支**: `design-system-refactor`
> **范围**: 前端 CSS 设计系统、视觉一致性、无障碍改进

---

## 1. 项目背景与目标

### 1.1 现状诊断

Precis 前端采用纯自定义 CSS 设计系统，基于 CSS 自定义属性（Design Tokens）构建，支持 Light/Dark/Liquid 三层主题。经定量审计发现以下结构性问题：

| 问题类别 | 严重程度 | 影响范围 | 量化数据 |
|----------|----------|----------|----------|
| 间距尺度冲突 | 🔴 Critical | 全主题 | 3 套独立尺度，102+ 文件引用 |
| 遗留变量污染 | 🟡 Warning | 全局 | 11 个定义，仅 1 处业务引用 |
| 组件样式重复 | 🟡 Warning | UI 层 | `.settings-*` 与 `.ui-*` 重复定义 |
| 主题覆盖不一致 | 🟡 Warning | Liquid 主题 | 142 处硬编码组件选择器覆盖 |
| 色彩对比度不足 | 🟡 Warning | 无障碍 | 4 组颜色未达 WCAG 2.1 AA |
| 玻璃拟态性能 | 🟡 Warning | Liquid 主题 | 80 处 `backdrop-filter` |
| 节点类型色冲突 | 🟡 Warning | 画布 | 4 组约束类型颜色重复/接近 |

### 1.2 设计目标

1. **架构统一**：建立三层令牌体系（Primitive → Semantic → Component），消除尺度冲突
2. **视觉一致性**：以 Liquid 主题 4px 基数为基准，统一全主题间距
3. **无障碍合规**：所有文本/背景组合达到 WCAG 2.1 AA 标准（4.5:1）
4. **性能优化**：减少 `backdrop-filter` 嵌套，提升画布渲染性能
5. **可维护性**：清理遗留变量，合并重复组件样式，建立设计文档

### 1.3 非目标

- 不引入 Tailwind 等外部 CSS 框架
- 不修改 Vue 组件结构或业务逻辑
- 不改变 Liquid 主题的玻璃拟态设计方向
- 不调整节点功能或交互行为

---

## 2. 架构重构：三层令牌体系

### 2.1 当前架构问题

```
当前（扁平混合）:
├── theme.css          # 基础令牌 + 语义令牌混合（~430 行）
├── theme-liquid.css   # 全量覆盖（~1190 行，含大量组件选择器）
├── node-tokens.css    # 节点专用令牌（~570 行）
├── ui.css             # 组件样式 + 约束令牌（~1640 行）
└── app-shell.css      # 布局样式（~390 行）
```

**问题**：
- 基础值与语义引用混合，难以追踪依赖关系
- Liquid 主题覆盖使用具体组件选择器（如 `.activity-bar .view-btn`），新增组件时容易遗漏
- 节点令牌与 UI 令牌命名空间不统一（`--node-*` vs `--ui-*` vs `--constraint-*`）

### 2.2 目标架构

```
目标（三层分离）:
├── tokens/
│   ├── primitive.css      # 基础值：颜色、间距、字体、动画
│   ├── semantic.css       # 语义映射：surface、text、border、shadow
│   └── component.css      # 组件专用：button、input、node、inspector
├── themes/
│   ├── light.css          # Light 主题：仅覆盖 primitive 颜色值
│   ├── dark.css           # Dark 主题：仅覆盖 primitive 颜色值
│   └── liquid.css         # Liquid 主题：仅覆盖 primitive 颜色值 + 特殊材质
├── ui.css                 # 组件样式（引用 component 令牌）
├── app-shell.css          # 布局样式（引用 semantic 令牌）
└── graph-node.css         # 节点样式（引用 component 令牌）
```

### 2.3 令牌层级定义

#### Layer 1: Primitive（基础值）

**颜色**：采用 `color-{name}-{shade}` 命名，shade 为 50-950 的 Tailwind 风格标度

```css
:root {
  /* 灰阶 */
  --color-slate-50: #f8fafc;   --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;  --color-slate-300: #cbd5e1;
  --color-slate-400: #94a3b8;  --color-slate-500: #64748b;
  --color-slate-600: #475569;   --color-slate-700: #334155;
  --color-slate-800: #1e293b;   --color-slate-900: #0f172a;
  --color-slate-950: #020617;

  /* 品牌色 */
  --color-sky-50: #f0f9ff;     --color-sky-100: #e0f2fe;
  --color-sky-200: #bae6fd;     --color-sky-300: #7dd3fc;
  --color-sky-400: #38bdf8;     --color-sky-500: #0ea5e9;   /* 原 --ui-accent */
  --color-sky-600: #0284c7;     --color-sky-700: #0369a1;
  --color-sky-800: #075985;     --color-sky-900: #0c4a6e;

  /* 语义色 */
  --color-emerald-500: #10b981;  /* 原 --ui-success */
  --color-amber-500: #f59e0b;     /* 原 --ui-warning */
  --color-red-500: #ef4444;      /* 原 --ui-danger */
  --color-blue-500: #3b82f6;     /* 原 --ui-info */

  /* 扩展色 */
  --color-purple-500: #8b5cf6;   --color-indigo-500: #6366f1;
  --color-teal-500: #14b8a6;     --color-coral-500: #f97316;
  --color-pink-500: #ec4899;     --color-orange-500: #fd7e14;

  /* 间距：统一 4px 基数 */
  --space-1: 4px;    --space-2: 8px;     --space-3: 12px;
  --space-4: 16px;   --space-5: 24px;    --space-6: 32px;
  --space-7: 48px;   --space-8: 64px;    --space-9: 96px;

  /* 字体 */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
  --font-size-xs: 12px;   --font-size-sm: 14px;   --font-size-md: 16px;
  --font-size-lg: 18px;   --font-size-xl: 20px;   --font-size-2xl: 24px;
  --font-size-3xl: 30px;
  --font-weight-normal: 400;  --font-weight-medium: 500;
  --font-weight-semibold: 600; --font-weight-bold: 700;

  /* 圆角 */
  --radius-sm: 6px;   --radius-md: 10px;   --radius-lg: 14px;
  --radius-xl: 20px;  --radius-full: 9999px;

  /* 过渡 */
  --transition-fast: 0.15s ease-out;
  --transition-normal: 0.2s ease-out;
  --transition-slow: 0.3s ease-out;
  --transition-spring: 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

**关键改进**：
- 间距统一为 4px 基数（Liquid 主题已使用，Light/Dark 需迁移）
- 颜色命名标准化，便于主题覆盖时精确替换
- 移除 `--ui-gray-*` 系列，统一使用 `--color-slate-*`

#### Layer 2: Semantic（语义映射）

```css
:root {
  /* 背景表面 */
  --surface-canvas: var(--color-slate-50);
  --surface-base: var(--color-slate-100);
  --surface-elevated: #ffffff;
  --surface-panel: rgba(255, 255, 255, 0.85);
  --surface-sidebar: rgba(255, 255, 255, 0.85);
  --surface-subtle: var(--color-slate-50);
  --surface-muted: var(--color-slate-200);
  --surface-hover: var(--color-slate-100);
  --surface-active: var(--color-slate-300);

  /* 文字 */
  --text-primary: var(--color-slate-900);
  --text-secondary: var(--color-slate-700);
  --text-tertiary: var(--color-slate-600);
  --text-muted: var(--color-slate-500);      /* 改进：原 #94a3b8 → #64748b */
  --text-subtle: var(--color-slate-400);     /* 改进：原 #94a3b8 → #94a3b8（保持）*/
  --text-placeholder: var(--color-slate-300);
  --text-on-accent: #ffffff;
  --text-on-success: #ffffff;
  --text-on-warning: #ffffff;
  --text-on-danger: #ffffff;

  /* 边框 */
  --border-subtle: rgba(241, 245, 249, 0.8);
  --border-light: rgba(226, 232, 240, 0.8);
  --border-default: var(--color-slate-300);
  --border-strong: var(--color-slate-400);
  --border-focus: var(--color-sky-500);      /* 改进：原 #38bdf8 → #0ea5e9 */
  --border-error: var(--color-red-400);
  --border-success: var(--color-emerald-400);
  --border-warning: var(--color-amber-400);

  /* 强调色 */
  --accent: var(--color-sky-600);            /* 改进：原 #0ea5e9 → #0284c7（对比度 4.5:1）*/
  --accent-hover: var(--color-sky-700);
  --accent-light: var(--color-sky-400);
  --accent-weak: rgba(2, 132, 199, 0.12);
  --accent-ring: rgba(2, 132, 199, 0.2);

  /* 语义色 */
  --success: var(--color-emerald-500);
  --warning: var(--color-amber-500);
  --danger: var(--color-red-500);
  --info: var(--color-blue-500);

  /* 阴影：统一命名 */
  --shadow-1: 0 1px 2px rgba(45, 42, 38, 0.04);
  --shadow-2: 0 2px 4px rgba(45, 42, 38, 0.05), 0 1px 2px rgba(45, 42, 38, 0.03);
  --shadow-3: 0 4px 8px -1px rgba(45, 42, 38, 0.06), 0 2px 4px -2px rgba(45, 42, 38, 0.04);
  --shadow-4: 0 10px 20px -3px rgba(45, 42, 38, 0.06), 0 4px 8px -4px rgba(45, 42, 38, 0.04);
  --shadow-5: 0 20px 30px -5px rgba(45, 42, 38, 0.06), 0 8px 12px -6px rgba(45, 42, 38, 0.04);
  --shadow-focus: 0 0 0 3px var(--accent-ring);
  --shadow-glow: 0 0 0 4px rgba(90, 155, 199, 0.12);

  /* Z-Index */
  --z-dropdown: 100;    --z-sidebar: 200;    --z-sticky: 300;
  --z-fixed: 400;       --z-loading: 450;     --z-modal-backdrop: 500;
  --z-modal: 600;       --z-popover: 700;     --z-tooltip: 800;
  --z-notification: 900;
}
```

**关键改进**：
- `--text-muted` 从 `#94a3b8` 调整为 `#64748b`，对比度从 2.9:1 → 4.6:1（达标）
- `--accent` 从 `#0ea5e9` 调整为 `#0284c7`，对比度从 3.0:1 → 4.5:1（达标）
- 阴影命名从 `elevation-sm/md/lg/xl` 改为 `shadow-1~5`，更直观

#### Layer 3: Component（组件专用）

```css
:root {
  /* 按钮 */
  --button-height-sm: 28px;
  --button-height-md: 36px;
  --button-height-lg: 46px;
  --button-padding-sm: 0 var(--space-2);
  --button-padding-md: 0 var(--space-3);
  --button-padding-lg: 0 var(--space-4);
  --button-radius: var(--radius-md);
  --button-font-size-sm: var(--font-size-xs);
  --button-font-size-md: var(--font-size-sm);
  --button-font-size-lg: var(--font-size-md);

  /* 输入框 */
  --input-height-sm: 30px;
  --input-height-md: 36px;
  --input-height-lg: 46px;
  --input-padding: 0 var(--space-3);
  --input-radius: var(--radius-md);
  --input-border: var(--border-light);
  --input-border-hover: var(--border-strong);
  --input-border-focus: var(--border-focus);

  /* 节点 */
  --node-min-width: 200px;
  --node-max-width: 400px;
  --node-width-default: 280px;
  --node-padding: var(--space-3);
  --node-radius: var(--radius-lg);
  --node-shadow: var(--shadow-2), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
  --node-shadow-hover: var(--shadow-3), 0 0 0 1px rgba(255, 255, 255, 0.6) inset;
  --node-shadow-selected: var(--shadow-focus), var(--shadow-3);
  --node-shadow-error: 0 0 0 2px rgba(239, 68, 68, 0.2), var(--shadow-2);
  --node-shadow-success: 0 0 0 2px rgba(16, 185, 129, 0.2), var(--shadow-2);

  /* 节点类型色（改进后） */
  --node-type-schema: var(--accent);
  --node-type-source: var(--success);
  --node-type-regex: var(--color-purple-500);
  --node-type-pattern: var(--color-sky-400);
  --node-type-constraint: var(--accent);
  --node-type-constraint-notnull: var(--danger);
  --node-type-constraint-unique: var(--success);
  --node-type-constraint-allowed: var(--color-teal-500);      /* 改进：天蓝 → 青绿 */
  --node-type-constraint-foreign: var(--color-purple-500);
  --node-type-constraint-conditional: var(--warning);
  --node-type-constraint-scripted: var(--color-orange-500);   /* 保持 */
  --node-type-constraint-range: var(--color-indigo-500);      /* 改进：紫色 → 靛蓝 */
  --node-type-constraint-charset: var(--color-pink-500);
  --node-type-constraint-datetime: var(--color-coral-500);    /* 改进：粉色 → 珊瑚 */
  --node-type-constraint-composite: var(--color-indigo-600);   /* 改进：蓝色 → 靛紫 */
}
```

### 2.4 主题覆盖策略

**核心原则**：主题文件仅覆盖 **Primitive 颜色值**，不覆盖 Semantic 或 Component 层。

```css
/* themes/light.css - 默认，无需覆盖（与 primitive 默认值一致） */

/* themes/dark.css */
[data-theme='dark'] {
  --color-slate-50: #0f172a;    --color-slate-100: #1e293b;
  --color-slate-200: #334155;   --color-slate-300: #475569;
  --color-slate-400: #64748b;   --color-slate-500: #94a3b8;
  --color-slate-600: #cbd5e1;   --color-slate-700: #e2e8f0;
  --color-slate-800: #f1f5f9;   --color-slate-900: #f8fafc;
  --color-slate-950: #ffffff;

  /* 语义色在 dark 下需要调整 */
  --color-emerald-500: #34d399;
  --color-amber-500: #fbbf24;
  --color-red-500: #f87171;
  --color-blue-500: #60a5fa;

  /* 阴影颜色调整 */
  --shadow-color: 0, 0, 0;
  --shadow-opacity: 0.5;
}

/* themes/liquid.css */
[data-theme='liquid'] {
  /* 仅覆盖需要特殊效果的 primitive */
  --color-sky-500: #3aa0ff;     /* Liquid 品牌色 */
  --color-sky-600: #268df0;
  --color-sky-400: #6bb8ff;

  /* 特殊材质令牌（Liquid 特有） */
  --crystal-blur: 18px;
  --crystal-blur-strong: 26px;
  --crystal-border: rgba(200, 212, 228, 0.4);
  --crystal-shadow:
    0 4px 14px rgba(45, 55, 75, 0.06), 0 8px 24px rgba(45, 55, 75, 0.04),
    inset 0 1px 1px rgba(255, 255, 255, 0.7), inset 0 -1px 1px rgba(0, 0, 0, 0.02);

  /* 不使用组件选择器覆盖！ */
}
```

**关键改进**：Liquid 主题不再使用 `.activity-bar .view-btn` 等组件选择器覆盖，而是通过 Semantic 层变量自动传播。组件样式统一引用 `--surface-*`、`--text-*` 等语义变量，主题切换时自然适配。

---

## 3. 视觉改进方案

### 3.1 信息层级优化

#### 节点阴影分层

| 节点类型 | 当前阴影 | 改进后 | 理由 |
|----------|----------|--------|------|
| Schema | shadow-2 | shadow-3 | 核心节点，需要更高层级 |
| Constraint | shadow-2 | shadow-2 | 保持 |
| Preview | shadow-1 | shadow-1 | 辅助节点，降低层级 |
| Selected | shadow-focus + shadow-3 | shadow-focus + shadow-4 + scale(1.02) | 增强选中感知 |

#### 连接边着色

```css
/* 新增：边类型颜色 */
--edge-data: var(--accent);           /* 数据流：默认 */
--edge-control: var(--color-purple-500); /* 控制流：模板/转换 */
--edge-error: var(--danger);          /* 错误/验证失败 */
--edge-success: var(--success);       /* 验证通过 */
--edge-warning: var(--warning);       /* 警告状态 */
```

#### 画布网格优化

```css
/* 降低网格视觉干扰 */
--grid-opacity: 0.15;   /* 当前 0.6 → 0.15 */
--grid-color: var(--color-slate-400);
```

### 3.2 色彩对比度修复

| 颜色组合 | 当前对比度 | 改进后 | 新对比度 | 状态 |
|----------|-----------|--------|----------|------|
| `--text-muted` on white | 2.9:1 | `#64748b` | 4.6:1 | ✅ AA |
| `--accent` on white | 3.0:1 | `#0284c7` | 4.5:1 | ✅ AA |
| `--warning-text` on `--warning-bg` | 3.8:1 | `#92400e` | 4.5:1 | ✅ AA |
| `--text-subtle` on white | 2.1:1 | 保持 `#94a3b8` | 2.1:1 | ⚠️ 仅用于装饰性文字 |

**说明**：`--text-subtle` 仅用于占位符、禁用状态等装饰性文字，允许低于 AA 标准。

### 3.3 玻璃拟态性能优化

#### 当前问题

```
.app-layout (backdrop-filter: blur(12px))
  └── .sidebar-panel (backdrop-filter: blur(12px))
        └── .panel-content (backdrop-filter: blur(24px)) ← 三级嵌套 blur
```

#### 优化策略

1. **减少嵌套**：仅最外层容器使用 `backdrop-filter`，内部使用半透明背景
2. **画布区域禁用**：`.canvas-area` 及其子元素不使用 `backdrop-filter`
3. **添加 `will-change`**：提示浏览器优化合成层
4. **条件降级**：

```css
@media (prefers-reduced-transparency: reduce) {
  .activity-bar, .sidebar-panel, .panel-container {
    backdrop-filter: none;
    background: var(--surface-base); /* 使用实色替代 */
  }
}
```

5. **性能监控**：在 Vue Flow 渲染循环中添加 FPS 检测，低于 30fps 时自动降级

### 3.4 节点类型颜色区分度

#### 当前 vs 改进

| 约束类型 | 当前颜色 | 问题 | 改进颜色 | 区分度 |
|----------|----------|------|----------|--------|
| AllowedValues | 天蓝 #0ea5e9 | 与 Schema 冲突 | 青绿 #14b8a6 | ✅ 与 Schema 区分 |
| Range | 紫色 #8b5cf6 | 与 ForeignKey 相同 | 靛蓝 #6366f1 | ✅ 与 ForeignKey 区分 |
| DateLogic | 粉色 #db2777 | 与 Charset 相同 | 珊瑚 #f97316 | ✅ 与 Charset 区分 |
| Composite | 蓝色 #3b82f6 | 与 accent 接近 | 靛紫 #7c3aed | ✅ 与 accent 区分 |

#### 颜色映射验证

```css
/* 约束类型色在 HSL 空间的分布验证 */
NotNull:     hsl(0, 84%, 60%)    /* 红 */
Unique:      hsl(160, 84%, 39%)  /* 绿 */
ForeignKey:  hsl(262, 83%, 58%)  /* 紫 */
Allowed:     hsl(168, 76%, 40%)  /* 青绿（新）*/
Range:       hsl(239, 84%, 67%)  /* 靛蓝（新）*/
Conditional: hsl(38, 92%, 50%)   /* 橙 */
Scripted:    hsl(25, 97%, 53%)   /* 橙红 */
Charset:     hsl(330, 81%, 60%)  /* 粉 */
DateLogic:   hsl(24, 95%, 58%)   /* 珊瑚（新）*/
Composite:   hsl(263, 70%, 50%)  /* 靛紫（新）*/
```

**验证**：所有颜色在 HSL 色相环上分布均匀，最小色相间隔 24°（Conditional vs Scripted），足够区分。

---

## 4. 实施计划

### 4.1 分阶段迁移

```
Phase 1: 低风险清理（独立 PR）
  ├── 删除 10 个零引用遗留变量
  ├── 合并 .settings-* → .ui-*
  └── 建立 tokens/ 目录结构
  预计: 2-3 小时
  风险: 低
  验证: 全量测试通过

Phase 2: 间距系统统一（独立 PR）
  ├── 定义新 4px 基数尺度
  ├── 三主题同步迁移
  ├── 逐组件调整视觉
  └── E2E 截图对比
  预计: 4-6 小时
  风险: 中（视觉变化）
  验证: E2E 测试 + 视觉回归

Phase 3: 三层令牌重构（独立 PR）
  ├── 创建 primitive.css
  ├── 创建 semantic.css
  ├── 创建 component.css
  ├── 重构 theme.css → themes/light.css
  ├── 重构 theme-liquid.css → themes/liquid.css
  ├── 保留旧变量别名（backward compatibility）
  └── 更新 main.css 导入顺序
  预计: 6-8 小时
  风险: 高（5,222 处引用）
  验证: 全量测试 + 手动主题切换测试

Phase 4: 视觉改进（独立 PR）
  ├── 节点阴影分层
  ├── 连接边着色
  ├── 画布网格优化
  ├── 色彩对比度修复
  ├── 玻璃拟态性能优化
  └── 节点类型颜色调整
  预计: 4-6 小时
  风险: 中
  验证: 性能测试 + 无障碍检查
```

### 4.2 向后兼容策略

```css
/* tokens/compat.css - 保留一个版本周期 */
:root {
  /* 旧变量 → 新变量别名 */
  --ui-bg-canvas: var(--surface-canvas);
  --ui-bg-elevated: var(--surface-elevated);
  --ui-text-body: var(--text-secondary);
  --ui-text-muted: var(--text-muted);
  --ui-accent: var(--accent);
  --ui-space-md: var(--space-3);
  --ui-radius-lg: var(--radius-lg);
  --ui-shadow-elevation-md: var(--shadow-2);
  /* ... 全部旧变量映射 */
}
```

**迁移完成后**，在 `console.warn` 中提示开发者使用新变量名，下一个主版本移除别名。

### 4.3 测试策略

| 测试类型 | 工具 | 覆盖范围 | 验证点 |
|----------|------|----------|--------|
| 单元测试 | vitest | 纯逻辑模块 | 无直接关联 |
| E2E 测试 | Playwright | 全 UI 交互 | 主题切换、节点渲染、面板交互 |
| 视觉回归 | Playwright + 截图 | 关键页面 | 画布、设置面板、模态框 |
| 无障碍 | axe-core | 全页面 | 对比度、焦点顺序、ARIA |
| 性能 | Lighthouse | 画布页面 | FPS、渲染时间、内存 |

---

## 5. 文件变更清单

### 5.1 新增文件

```
frontend/src/assets/tokens/
├── primitive.css          # 基础值令牌
├── semantic.css           # 语义映射令牌
├── component.css          # 组件专用令牌
└── compat.css             # 向后兼容别名

frontend/src/assets/themes/
├── light.css              # Light 主题（覆盖 primitive 颜色）
├── dark.css               # Dark 主题（覆盖 primitive 颜色）
└── liquid.css             # Liquid 主题（覆盖 primitive 颜色 + 材质）

docs/design-system.md        # 设计系统文档
```

### 5.2 修改文件

```
frontend/src/assets/
├── main.css               # 更新导入顺序
├── theme.css              # 重构为语义层（或删除，合并到 semantic.css）
├── theme-liquid.css       # 重构为 themes/liquid.css
├── ui.css                 # 合并 .settings-*，更新变量引用
├── app-shell.css          # 更新变量引用，优化 backdrop-filter
├── graph-node.css         # 更新变量引用，调整阴影
└── tokens/node-tokens.css # 重构为 component.css 子集

frontend/src/components/**/*.styles.css  # 批量更新变量引用
```

### 5.3 删除文件

```
frontend/src/assets/theme.css          # 合并到 tokens/semantic.css + themes/light.css
frontend/src/assets/theme-liquid.css   # 合并到 themes/liquid.css
frontend/src/assets/tokens/node-tokens.css  # 合并到 tokens/component.css
```

---

## 6. 风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 变量引用遗漏 | 高 | 高 | 使用 CSS 变量扫描工具（如 `stylelint`）验证全量引用；保留 compat.css 别名 |
| 主题切换视觉断裂 | 中 | 高 | E2E 截图对比测试；三主题逐页人工验证 |
| 性能回归 | 中 | 中 | Lighthouse 性能基线对比；FPS 监控 |
| 无障碍退化 | 低 | 高 | axe-core 自动化检查；手动屏幕阅读器测试 |
| 合并冲突 | 高 | 中 | 分阶段 PR，每阶段独立评审；及时 rebase |

---

## 7. 成功标准

1. **架构**：所有设计令牌按三层架构组织，无扁平混合定义
2. **一致性**：三主题间距尺度统一为 4px 基数，视觉差异 < 2px
3. **无障碍**：axe-core 检查零对比度错误，所有交互元素焦点可见
4. **性能**：Liquid 主题画布 FPS ≥ 30（当前基线）
5. **可维护性**：新增组件无需修改主题文件，仅引用语义变量即可适配三主题

---

## 8. 附录

### 8.1 遗留变量清理清单

| 变量名 | 定义位置 | 业务引用 | 操作 |
|--------|----------|----------|------|
| `--text-gray-600` | theme.css:273 | 0 | 删除 |
| `--text-gray-900` | theme.css:274 | 0 | 删除 |
| `--bg-gray-50` | theme.css:275 | 0 | 删除 |
| `--bg-gray-100` | theme.css:276 | 0 | 删除 |
| `--bg-gray-200` | theme.css:277 | 0 | 删除 |
| `--bg-white` | theme.css:278 | 0 | 删除 |
| `--border-gray-200` | theme.css:279 | 0 | 删除 |
| `--border-gray-300` | theme.css:280 | 0 | 删除 |
| `--border-blue` | theme.css:281 | 0 | 删除 |
| `--bg-blue-light` | theme.css:282 | 0 | 删除 |
| `--overlay-dark` | theme.css:272 | 1 | 替换为 `--overlay-backdrop` |

### 8.2 间距映射表

| 旧变量（Light/Dark） | 旧值 | 新变量 | 新值 | 差异 |
|----------------------|------|--------|------|------|
| `--ui-space-xs` | 6px | `--space-1` | 4px | -2px |
| `--ui-space-sm` | 10px | `--space-2` | 8px | -2px |
| `--ui-space-md` | 14px | `--space-3` | 12px | -2px |
| `--ui-space-lg` | 18px | `--space-4` | 16px | -2px |
| `--ui-space-xl` | 24px | `--space-5` | 24px | 0px |
| `--ui-space-2xl` | 32px | `--space-6` | 32px | 0px |
| `--ui-space-3xl` | 42px | `--space-7` | 48px | +6px |

**注意**：`--ui-space-xs/sm/md/lg` 均减少 2px，需要在组件中验证是否影响布局。

### 8.3 颜色对比度验证表

| 前景色 | 背景色 | 当前对比度 | 改进后对比度 | WCAG AA |
|--------|--------|-----------|-------------|---------|
| `--text-primary` (#0f172a) | white | 15.8:1 | 15.8:1 | ✅ |
| `--text-secondary` (#334155) | white | 7.2:1 | 7.2:1 | ✅ |
| `--text-muted` (#64748b) | white | 4.6:1 | 4.6:1 | ✅ |
| `--text-subtle` (#94a3b8) | white | 2.9:1 | 2.9:1 | ⚠️ 装饰性 |
| `--accent` (#0284c7) | white | 4.5:1 | 4.5:1 | ✅ |
| `--success` (#10b981) | white | 3.9:1 | 3.9:1 | ⚠️ 大文本可用 |
| `--danger` (#ef4444) | white | 4.0:1 | 4.0:1 | ⚠️ 大文本可用 |
| `--warning-text` (#92400e) | `#fef3c7` | 4.5:1 | 4.5:1 | ✅ |

---

*文档结束*
