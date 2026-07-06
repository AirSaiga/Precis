# Emoji → SVG 图标统一替换设计

- **日期**: 2026-07-06
- **状态**: 已批准，待实施
- **范围**: `frontend/src/` 用户可见的 emoji 与不统一的文本符号（×/✕/✓/✗）
- **不在范围**: logger 日志前缀的 emoji（非 UI 渲染）、现有 243 处手写内联 SVG（风格已统一且能用）

---

## 1. 背景与目标

### 1.1 现状

审计发现 `frontend/src/` 中有 **50+ 个文件** 使用 emoji 作为图标，覆盖：

- **节点头部图标**（约束/集合/转换/模板等约 25 个节点组件）— 通过 `NodeHeader` 的 `icon` prop 传入 emoji 字符串
- **节点注册表**（`ConstraintNodeLibrary.ts` 的 `icon:` 字段、`transformCategory.ts` 的 `icon:` 字段）
- **检查系统**（6 个 `inspection/*.vue` 的 `SEVERITY_ICONS`/`ACTION_ICONS` 映射、状态徽章）
- **数据源/文件类型图标**（SchemaNode 头部、SourcePreviewNode、JsonSourcePreviewNode 等）
- **i18n 翻译字符串**（zh-CN + en-US 各 7 个文件，emoji 嵌在文案前缀里）
- **UI 按钮/指示器**（✓/✗/×/✕ 等文本符号、AI 工具链、冲突解决、设置面板等）
- **CSS 伪元素**（`SourcePreviewNode.css:652` 的 `content: '⚠️'`）
- **画布拖拽预览**（`DragGhost.vue`）、**画布标签**（`canvasTabStore.ts`）

另有约 150+ 处 emoji 仅出现在 `logger.debug/warn/error` 的日志前缀里，**不在本次范围**。

### 1.2 基建缺失

当前项目：

- **无图标组件**（无 `Icon.vue`/`SvgIcon.vue`）
- **无 SVG 资源目录**（`assets/logo.svg` 是 Vue 脚手架残留，未被引用）
- **无图标库依赖**（`package.json` 中无 lucide/heroicons/fortawesome 等）
- **有 243 处手写内联 SVG**，全部遵循 Lucide/Feather 风格（`24×24`、`fill="none"`、`stroke="currentColor"`、`stroke-width="2"`、圆角 cap/join）
- 现有内联 SVG 有两种模式：模板内 `<svg>` 与 TS 字符串 + `v-html`，且存在重复（约束图标在 `useConstraintTypes.ts` 和 `ConstraintRuleTypeMenu.vue` 各定义一份）

### 1.3 目标

1. 引入 `@lucide/vue`（与现有内联 SVG 完全同风格，1600+ 图标，Vue 3 原生组件，支持 `currentColor`/`size`/tree-shake）
2. 建立轻量图标基建（`iconRegistry.ts` + `AppIcon.vue`），将业务语义与具体图标解耦
3. 替换所有用户可见的 emoji 与不统一的文本符号为 SVG
4. i18n 文案与图标分离：文案归 i18n，图标归组件
5. 不破坏现有交互行为与 E2E 测试

---

## 2. 架构设计

### 2.1 新增基建

```
frontend/src/components/icons/
├── iconRegistry.ts        # 业务图标名 → Lucide 组件 映射 + 查询函数
└── AppIcon.vue            # 通用图标组件：<AppIcon name="check" :size="16" />
```

#### `iconRegistry.ts`

```ts
import type { Component } from 'vue'
import {
  Ban, KeyRound, Link2, ListChecks, Ruler, Shuffle, ScrollText,
  Type, CalendarClock, Package, Folder, FolderOpen, FileText,
  ChartColumn, Microscope, Settings, Brush, Building2, Binary,
  Check, X, TriangleAlert, Info, CheckCircle2, Circle, PartyPopper,
  Lightbulb, Search, Trash2, Upload, PencilLine, Wrench, Puzzle,
  Keyboard, MonitorCog, Zap, Sparkles, Plus, BellOff, Clipboard,
  Database, Archive, Boxes, Filter, FileCode, FileSpreadsheet,
  ChevronDown, Save, ExternalLink, ArrowRight, Hammer, ShieldCheck,
  Wand2, ReceiptText, FolderTree,
} from '@lucide/vue'

/** 业务图标名 → Lucide 组件的核心映射（单一事实源） */
export const ICON_REGISTRY: Record<string, Component> = {
  // —— 通用状态 ——
  'check': Check,
  'x': X,
  'alert': TriangleAlert,
  'info': Info,
  'check-circle': CheckCircle2,
  'circle-danger': Circle,    // blocker 严重度，颜色由 CSS 控制
  'circle-warning': Circle,   // warning 严重度
  'circle-info': Circle,      // info 严重度
  'party': PartyPopper,
  'bulb': Lightbulb,
  'search': Search,
  'trash': Trash2,
  'upload': Upload,
  'edit': PencilLine,
  'wrench': Wrench,
  'puzzle': Puzzle,
  'keyboard': Keyboard,
  'monitor': MonitorCog,
  'zap': Zap,
  'sparkles': Sparkles,
  'plus': Plus,
  'bell-off': BellOff,
  'save': Save,
  'external-link': ExternalLink,
  'arrow-right': ArrowRight,
  'chevron-down': ChevronDown,
  'hammer': Hammer,
  'shield': ShieldCheck,
  'wand': Wand2,

  // —— 约束类型（10 个，与 ConstraintNodeLibrary 一一对应）——
  'constraint-notNull': Ban,
  'constraint-unique': KeyRound,
  'constraint-foreignKey': Link2,
  'constraint-allowedValues': ListChecks,
  'constraint-range': Ruler,
  'constraint-conditional': Shuffle,
  'constraint-scripted': ScrollText,
  'constraint-charset': Type,
  'constraint-dateLogic': CalendarClock,
  'constraint-composite': Package,

  // —— 转换分类（5 个，与 transformCategory.ts 一一对应）——
  'transform-text': FileText,
  'transform-numeric': Binary,
  'transform-cleaning': Brush,
  'transform-structure': Building2,
  'transform-date': CalendarClock,

  // —— 数据源/文件类型 ——
  'folder': Folder,
  'folder-open': FolderOpen,
  'file': FileText,
  'file-code': FileCode,
  'file-chart': FileSpreadsheet,
  'file-default': FileText,
  'database': Database,
  'archive': Archive,
  'boxes': Boxes,
  'folder-tree': FolderTree,
  'filter': Filter,
  'receipt': ReceiptText,
  'clipboard': Clipboard,

  // —— 节点类型 ——
  'project-root': Microscope,
  'gear': Settings,
  'pattern-toolbox': Wrench,
}

/** 根据业务图标名获取 Lucide 组件。找不到返回 undefined。 */
export function getIcon(name: string): Component | undefined {
  return ICON_REGISTRY[name]
}

/** 约束类型 → 图标名（供 ConstraintNodeLibrary 等数据层使用） */
export const CONSTRAINT_ICON_NAMES: Record<string, string> = {
  notNull: 'constraint-notNull',
  unique: 'constraint-unique',
  foreignKey: 'constraint-foreignKey',
  allowedValues: 'constraint-allowedValues',
  range: 'constraint-range',
  conditional: 'constraint-conditional',
  scripted: 'constraint-scripted',
  charset: 'constraint-charset',
  dateLogic: 'constraint-dateLogic',
  composite: 'constraint-composite',
}

/** 转换分类 id → 图标名（供 transformCategory.ts 等使用） */
export const TRANSFORM_CATEGORY_ICON_NAMES: Record<string, string> = {
  text: 'transform-text',
  numeric: 'transform-numeric',
  cleaning: 'transform-cleaning',
  structure: 'transform-structure',
  date: 'transform-date',
}
```

**设计要点**：

- **业务名解耦**：组件写 `name="constraint-notNull"`，未来换图标只改注册表一处。
- **数据层友好**：`ConstraintNodeLibrary.ts` 的 `icon:` 字段值从 emoji 字符串改为图标名字符串（类型仍为 `string`，注册表签名不变，最小破坏面）。
- **纯模块**：无 Vue/Pinia 依赖，符合 vitest 单元测试范围。

#### `AppIcon.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { getIcon } from './iconRegistry'

interface Props {
  /** 业务图标名（见 iconRegistry.ts） */
  name: string
  /** 图标尺寸，默认 16 */
  size?: number | string
  /** stroke-width，默认 2（与现有内联 SVG 一致） */
  strokeWidth?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
  strokeWidth: 2,
})

const comp = computed(() => getIcon(props.name))
</script>

<template>
  <component
    :is="comp"
    v-if="comp"
    :size="size"
    :stroke-width="strokeWidth"
    class="app-icon"
  />
  <!-- 找不到图标时不渲染（开发期可加 console.warn，生产期去掉） -->
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
```

### 2.2 承重变更：`NodeHeader.vue` / `NodeShell.vue`

#### `NodeHeader.vue`

当前：
```ts
icon?: string  // emoji 字符串
```
模板：`{{ icon }}`

改造后：
```ts
iconName?: string  // 业务图标名，替代 icon
icon?: string      // deprecated，保留以避免破坏现有调用，内部 console.warn
```
模板：
```html
<div v-if="iconName || $slots.icon" class="node-header__icon">
  <slot name="icon">
    <AppIcon v-if="iconName" :name="iconName" :size="16" />
  </slot>
</div>
```
- 保留 `#icon` 插槽作为完全自定义的逃生口（已有节点用它传自定义 SVG 时不破坏）。
- `icon` prop 保留但内部打印一次性 deprecation warning，便于渐进迁移。**阶段 5 清理掉所有 `icon=` 用法后删除该 prop**。

#### `NodeShell.vue`

删除按钮 `×`（L57）：
```html
<!-- 旧 -->
<button class="node-shell__delete-btn" ...>×</button>
<!-- 新 -->
<button class="node-shell__delete-btn" ...>
  <X :size="14" />
</button>
```
保存按钮 `Save/Saving...` 保持文本（那是 i18n 文案，不是图标）。
`.node-shell__delete-btn` 的 CSS（字体相关样式）需配合调整尺寸。

### 2.3 注册表/数据层改造

#### `constraintNodeRegistry.ts`

`ConstraintNodeRegistration.icon: string` 字段语义从"emoji 字符串"改为"业务图标名"。注释更新：
```ts
/** 节点图标名（对应 iconRegistry），用于工具箱和节点头部展示 */
icon: string
```

#### `ConstraintNodeLibrary.ts`

10 个 `icon:` 值改为业务名（通过 `CONSTRAINT_ICON_NAMES` 常量）：
```ts
import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'
// ...
registerConstraintNode('notNull', {
  ...
  icon: CONSTRAINT_ICON_NAMES.notNull,  // 'constraint-notNull'
  ...
})
```

#### `transformCategory.ts`

`TransformCategory.icon: string` 同样改为业务图标名：
```ts
import { TRANSFORM_CATEGORY_ICON_NAMES } from '@/components/icons/iconRegistry'
// icon: '📄' → icon: TRANSFORM_CATEGORY_ICON_NAMES.text
```
`getCategoryIcon()` 返回图标名，消费方自行用 `<AppIcon>` 渲染。

### 2.4 检查系统改造

`inspection/*.vue` 的 `SEVERITY_ICONS` / `ACTION_ICONS` 从 emoji 改为图标名：

`InspectionStatusBadge.vue`:
```ts
const SEVERITY_ICONS: Record<string, string> = {
  blocker: 'circle-danger',
  warning: 'alert',
  info: 'info',
}
// badgeIcon computed 返回图标名
```
模板：
```html
<span class="badge-icon"><AppIcon :name="badgeIcon" :size="14" /></span>
```

`InspectionIssueCard.vue` 的 `ACTION_ICONS`:
```ts
const ACTION_ICONS: Record<string, string> = {
  open_file: 'folder-open',
  copy: 'clipboard',
  dismiss: 'bell-off',
  auto_fix: 'wrench',
  navigate: 'arrow-right',
}
```

其余检查组件（`InspectionSummaryCard`、`InspectionIssueGroup`、`InspectionDrawer`、`InspectionIgnoredManager`、`ProjectRootNode` 的 `passRateIcon`）同样改造。

### 2.5 i18n 拆分

**原则**：文案归 i18n，图标归组件。

#### 需要修改的 i18n 文件（zh-CN + en-US 成对）

| 文件 | 修改内容 |
|------|---------|
| `core.ts` | `view.project: '🗃️ 项目资源视图'` → `'项目资源视图'`；`view.data` 同理 |
| `assetLibrary.ts` | 同 core.ts 的视图标签（重复定义） |
| `canvas.ts` | `createSchema: '🗄️ ...'` → 去 emoji；`createSourcePreview` 同理 |
| `ai.ts` | `noModelWarning`/`warningsTitle`/`hardwareTitle`/`successHint` 去 emoji 前缀 |
| `inspector.ts` | `connectFirst` 去 `💡` 前缀 |
| `nodes.ts` | `dataType.date: '📅'`、`dataType.expression: '✨'` 去 emoji；脚本约束描述去 `⚠️` |
| `common.ts` | `statusPass: '✓ 检测通过'` → `'检测通过'` |

#### 消费组件改造（约 10 个）

每个被改的 i18n 键，其消费组件模板需从纯文本渲染改为"图标 + 文本"：

例（视图切换组件）：
```html
<!-- 旧 -->
<span>{{ t('core.view.project') }}</span>
<!-- 新 -->
<AppIcon name="folder-tree" :size="14" />
<span>{{ t('core.view.project') }}</span>
```

特殊情况 `dataType.date`/`dataType.expression`（当前 i18n 值就是纯 emoji）：
- 改为有意义文案（如 `dataType.date: '日期'`、`dataType.expression: '表达式'`），或消费方直接用 `<AppIcon name="calendar">` 替代，i18n 键删除。
- spec 实施时按消费场景判定，倾向后者（这些"值"原本就是图标占位）。

### 2.6 CSS 伪元素处理

`SourcePreviewNode.css:652` 的 `content: '⚠️'`：
- 改为在模板内加 `<AppIcon name="alert" :size="12" />`，CSS 用 class 控制显隐与定位。
- 删除 CSS 的 `content` 规则。

### 2.7 边界情况

| 情况 | 处理 |
|------|------|
| `aiChatStore.ts:525` 把 `⚠️` 注入聊天消息内容（markdown 渲染） | **保留**。属 AI 消息流内容（非固定 UI 结构），改 markdown 渲染层识别标记成本高、收益低。标记为已知保留项。 |
| 现有 243 处手写内联 SVG | **不在范围**。风格已统一且能用，避免 scope 膨胀。未来可另立专项收敛。 |
| logger.* 日志前缀 emoji（150+ 处） | **不在范围**。非 UI 渲染。 |
| `assets/logo.svg`（Vue 脚手架残留） | 不动（未被引用，与本次无关）。 |

---

## 3. 完整图标映射清单

下表是 emoji/文本符号 → 业务图标名 → Lucide 组件 的完整映射（实施时按此对照）。

### 3.1 约束类型

| emoji | 业务图标名 | Lucide 组件 | 来源文件 |
|-------|-----------|-------------|---------|
| 🚫 | `constraint-notNull` | `Ban` | ConstraintNodeLibrary / NotNullConstraintNode.vue |
| 1️⃣ / 🔐 | `constraint-unique` | `KeyRound` | ConstraintNodeLibrary / UniqueConstraintNode.vue |
| 🔗 | `constraint-foreignKey` | `Link2` | ConstraintNodeLibrary / ForeignKeyConstraintNode.vue |
| ⬜ / 📋 | `constraint-allowedValues` | `ListChecks` | ConstraintNodeLibrary / AllowedValuesConstraintNode.vue |
| 📏 | `constraint-range` | `Ruler` | ConstraintNodeLibrary / RangeConstraintNode.vue |
| 🔀 | `constraint-conditional` | `Shuffle` | ConstraintNodeLibrary / ConditionalConstraintNode.vue |
| 📜 | `constraint-scripted` | `ScrollText` | ConstraintNodeLibrary / ScriptedConstraintNode.vue |
| 🔤 | `constraint-charset` | `Type` | ConstraintNodeLibrary / CharsetConstraintNode.vue |
| 📅 | `constraint-dateLogic` | `CalendarClock` | ConstraintNodeLibrary / DateLogicConstraintNode.vue |
| 📦 | `constraint-composite` | `Package` | ConstraintNodeLibrary / CompositeConstraintNode.vue |

### 3.2 集合/容器节点

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 📂 / 📁 | `folder-open` / `folder` | `FolderOpen` / `Folder` | TableSetRoot/RegexSetRoot 等 |
| 📦 | `package` | `Package` | TableSetNode |
| 🗄️ | `archive` | `Archive` | SchemaSetNode |
| 🔤 | `constraint-charset` | `Type` | RegexSetNode（与字符集约束复用） |
| 🔒 | `lock` | `Lock` | ConstraintRuleSetRoot/Node |

> 注：`lock`、`package` 需在阶段 1 补进 ICON_REGISTRY（上面 §2.1 漏列，实施时补全）。

### 3.3 节点类型

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 🔬 | `project-root` | `Microscope` | ProjectRootNode.vue |
| ⚙️ | `gear` | `Settings` | TransformNode / 各 fallback |
| 🧰 | `pattern-toolbox` | `Wrench` | PatternToolboxNode.vue |
| 📋 | `clipboard` | `Clipboard` | PatternNode / ConstraintDashboard |
| 🧩 | `puzzle` | `Puzzle` | TemplateInstanceNode |
| 🔤 | `constraint-charset` | `Type` | RegexNode |
| 📤 | `upload` | `Upload` | TransformOutputNode |
| 📝 | `edit` | `PencilLine` | ManualDataNode |

### 3.4 转换分类

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 📄 | `transform-text` | `FileText` | transformCategory.ts |
| 🔢 | `transform-numeric` | `Binary` | transformCategory.ts |
| 🧹 | `transform-cleaning` | `Brush` | transformCategory.ts |
| 🏗️ | `transform-structure` | `Building2` | transformCategory.ts |
| 📅 | `transform-date` | `CalendarClock` | transformCategory.ts |

### 3.5 数据源/文件类型

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 📊 | `file-chart` | `FileSpreadsheet` | SourcePreviewNode / SchemaNodeHeader |
| 📄 | `file` | `FileText` | SourcePreviewNode / JsonSchemaNodeHeader |
| 📋 | `file-default` | `FileText` | SourcePreviewNode 默认 |
| 📑 | `file-code` | `FileCode` | SourcePreviewNode sheet |
| 📁 | `folder` | `Folder` | SchemaNodeDataSourceDropdown / DataSourcesSettingsPanel / ProjectCard |
| 🗑 | `trash` | `Trash2` | ManualDataNodeInspector |
| ✨ | `sparkles` | `Sparkles` | SchemaNodeHeader smart-fill |
| ⬇ | `save` | `Save` | SchemaNodeHeader save |
| ★ / ⭐ | `star` | `Star` | SourcePreviewNode header-row（需补进 registry） |

### 3.6 检查/状态

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 🔴 | `circle-danger` | `Circle` | InspectionStatusBadge / IssueCard / SummaryCard |
| ⚠️ / ⚠ | `alert` | `TriangleAlert` | 同上 + CrashFeedbackModal 等 |
| ℹ️ | `info` | `Info` | 同上 |
| ✅ / ✓ | `check-circle` / `check` | `CheckCircle2` / `Check` | passed 态用 check-circle，按钮指示用 check |
| 🔕 | `bell-off` | `BellOff` | ignored 态 |
| 🎉 | `party` | `PartyPopper` | InspectionSummaryCard / Drawer 空态 |
| 📭 | `mailbox` | `Inbox`（需补进 registry） | InspectionIgnoredManager 空态 |
| 🪧 | `presentation` | `Monitor`（需补进 registry） | InspectionIssueGroup 默认 |
| 💡 | `bulb` | `Lightbulb` | 提示前缀 |
| ❌ | `x` | `X` | fail 态 |

### 3.7 检查动作

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| 📂 | `folder-open` | `FolderOpen` | open_file action |
| 📋 | `clipboard` | `Clipboard` | copy action |
| 🔕 | `bell-off` | `BellOff` | dismiss action |
| 🛠️ | `wrench` | `Wrench` | auto_fix action |
| ➡ | `arrow-right` | `ArrowRight` | navigate action |

### 3.8 文本符号 → SVG

| 符号 | 业务图标名 | Lucide 组件 | 来源 |
|------|-----------|-------------|------|
| × (U+00D7) | `x` | `X` | NodeShell 删除按钮 |
| ✕ (U+2715) | `x` | `X` | JsonDataTree 清除、Settings 关闭、UpdateSettingsPanel 警告 |
| ✓ (U+2713) | `check` | `Check` | ToolTrailCard 成功、AskUserCard、SettingsModal、各 inspector 验证通过 |
| ✗ (U+2717) | `x` | `X` | ToolTrailCard 失败、各 inspector 验证失败 |

### 3.9 AI/冲突解决/DragGhost

| emoji | 业务图标名 | Lucide 组件 | 来源 |
|-------|-----------|-------------|------|
| ⚡ | `zap` | `Zap` | ConflictSidebar safeDefault |
| 📄 | `file` | `FileText` | ConflictSidebar keepAll / DiffView radio |
| ✨ | `sparkles` | `Sparkles` | ConflictSidebar useAll / Footer stat / DiffView radio |
| ➕ | `plus` | `Plus` | ConflictSidebar useAddedOnly |
| 🔧 | `wrench` | `Wrench` | AIChatDrawer 工具链标签 |
| 🏷️ | `tag` | `Tag`（需补进 registry） | AIChatDrawer context 节点标签 |
| ⌨️ | `keyboard` | `Keyboard` | ShortcutSettingsPanel |
| 🖥️ | `monitor` | `MonitorCog` | AIAssistantSettingsPanel hardwareTitle |
| 🗃️ | `database` | `Database` | DragGhost schema / i18n view |
| 🪄 | `wand` | `Wand2` | DragGhost pattern |
| 🛡️ | `shield` | `ShieldCheck` | DragGhost constraint |
| 🧾 | `receipt` | `ReceiptText` | DragGhost external_data_source |
| 🖼️ | `image` | `Image`（需补进 registry） | canvasTabStore 工作区标签 |

> **实施时需补进 ICON_REGISTRY 的图标**（§2.1 漏列）：`lock`, `package`, `star`, `inbox`, `monitor`（presentation 复用）, `tag`, `image`。

---

## 4. 分阶段实施计划

每阶段独立可验证、可 commit。每阶段后跑 `npm run type-check` + `npm run lint`（相关子目录）。

### 阶段 1 — 基建

**改动**：
- `cd frontend && npm install @lucide/vue`（锁定 `~1.0.0`）
- 新建 `components/icons/iconRegistry.ts`（含 §3 所有业务名映射，补全 lock/package/star/inbox/tag/image 等）
- 新建 `components/icons/AppIcon.vue`
- 新建 `tests/components/icons/iconRegistry.test.ts`（单元测试，验证关键映射存在 + `getIcon` 查询行为）

**验证**：
- `cd frontend && npm run type-check`
- `cd frontend && npm run test`（新单测通过）
- `cd frontend && npm run lint`

**Commit**: `feat(icons): 引入 @lucide/vue 与 AppIcon/iconRegistry 基建`

### 阶段 2 — 节点系统

**改动**（约 30 个文件）：
- `NodeHeader.vue`：加 `iconName` prop，渲染 `<AppIcon>`，保留 `icon` 作 deprecated
- `NodeShell.vue`：删除按钮 `×` → `<X>`
- `ConstraintNodeLibrary.ts`：10 个 icon 改 `CONSTRAINT_ICON_NAMES.*`
- `transformCategory.ts`：5 个 icon 改 `TRANSFORM_CATEGORY_ICON_NAMES.*`，`getCategoryIcon` 返回图标名
- 所有约束节点 `.vue`（10 个 constraintRules/* + CompositeConstraintNode）：`icon="🚫"` → `icon-name="constraint-notNull"`
- 所有集合节点 `.vue`（8 个 sets/* + constraintSets/*）：同上
- `TransformNode.vue`、`PatternToolboxNode.vue`、`PatternNode.vue`、`TemplateInstanceNode.vue`、`ProjectRootNode.vue`、`RegexNode.vue`、`ConstraintDashboardNode.vue`、`TransformOutputNode.vue`、`ManualDataNode.vue`：头部改 `icon-name`
- `ConstraintRuleTypeMenu.vue`：`v-html="constraint.icon"` → `<AppIcon :name="constraint.icon" />`
- `DragGhost.vue`：`typeConfigs` 的 `icon:` 改业务名，模板用 `<AppIcon>`
- `canvasTabStore.ts`：tab icon 改业务名
- `useConstraintTypes.ts`：若 `CONSTRAINT_ICONS`（SVG 字符串）被消费，改为导出图标名或直接删（消费方改用 AppIcon）
- `ToolboxPanel.vue`：本地 `ICONS` 常量与 `transformTypes[].icon` 改用 AppIcon

**验证**：
- `cd frontend && npm run type-check`
- `cd frontend && npm run lint`
- 跑节点渲染相关 E2E（`e2e/` 下节点创建/编辑 spec）

**Commit**: `refactor(nodes): 节点头部/注册表 emoji 改 SVG（@lucide/vue）`

### 阶段 3 — 检查系统

**改动**（约 8 个文件）：
- `InspectionStatusBadge.vue`：`SEVERITY_ICONS` 改图标名，模板 `<AppIcon>`
- `InspectionIssueCard.vue`：`SEVERITY_ICONS` / `ACTION_ICONS` 改图标名
- `InspectionSummaryCard.vue`：内联 emoji 改 `<AppIcon>`
- `InspectionIssueGroup.vue`：group key 图标改 `<AppIcon>`
- `InspectionDrawer.vue`：header/empty/copy/hint 图标改 `<AppIcon>`
- `InspectionIgnoredManager.vue`：空态图标改 `<AppIcon>`
- `ProjectRootNode.vue`：`passRateIcon` 改图标名
- `SourcePreviewNode.vue` + `SourcePreviewNode.css`：CSS `content: '⚠️'` 迁移到模板 `<AppIcon>`

**验证**：
- `cd frontend && npm run type-check`
- 跑检查流程 E2E

**Commit**: `refactor(inspection): 检查状态/动作 emoji 改 SVG`

### 阶段 4 — i18n 拆分

**改动**：
- 7 对 i18n 文件（zh-CN + en-US）：`core.ts`、`assetLibrary.ts`、`canvas.ts`、`ai.ts`、`inspector.ts`、`nodes.ts`、`common.ts` 去 emoji 前缀
- 约 10 个消费组件模板调整（视图切换、右键菜单、AI 面板、状态栏、Inspector 等）：加 `<AppIcon>` 拼接

**验证**：
- `cd frontend && npm run type-check`
- 跑 i18n 相关 E2E（如视图切换、右键菜单）
- 人工核对 zh-CN + en-US 文案一致

**Commit**: `refactor(i18n): 拆分 emoji 图标与文案，图标归组件`

### 阶段 5 — 扫尾

**改动**：
- `ai/ToolTrailCard.vue`、`ai/AskUserCard.vue`、`ai/AIChatDrawer.vue`：✓/✗/🔧/🏷️ 改 `<AppIcon>`
- `common/SettingsModal.vue`、`common/conflict-resolution/*.vue`（4 个）：✓/✕/⚡/📄/✨/➕ 改 `<AppIcon>`
- `settings/*.vue`（UpdateSettingsPanel、ShortcutSettingsPanel、ScriptSettingsPanel、DataSourcesSettingsPanel、AIAssistantSettingsPanel）：✕/✓/⚠️/⌨️ 改 `<AppIcon>`
- `inspectors/*.vue`（ManualDataNodeInspector、TemplateInstanceInspector、SchemaNodeInspector、PatternNodeInspector、JsonSchemaNodeInspector）：🗑/✓/✗ 改 `<AppIcon>`
- `SchemaNode/components/*`（SchemaNodeHeader、SchemaNodeDataSourceDropdown、SchemaNodeColumnRow、SchemaNodeColumnMenuDropdown）+ `json/components/*` 对应文件：📄/📊/✨/⬇/⚠️/✓/🚫 改 `<AppIcon>`
- `SourcePreviewNode.vue`、`JsonSourcePreviewNode.vue`：剩余 emoji（📊/📄/📋/📑/★/⭐/✓/❌/⚠️）改 `<AppIcon>`
- `AppStatusBar.vue`、`DataSourcesSettingsPanel.vue`、`ProjectCard.vue`：📂/📁 改 `<AppIcon>`
- `RegexConnectionDialog.vue`：🔤 改 `<AppIcon>`
- `ui/inspector/InspectorStatCard.vue`：默认 `icon: '📊'` prop 改图标名
- `TransformContextMenu.vue`：📋/🔗/🧠/⏱️ 改 `<AppIcon>`
- 清理 `NodeHeader.vue` 的 deprecated `icon` prop（确认无 `icon=` 残留后删除）
- **`aiChatStore.ts:525` 保留**（边界情况，spec §2.7）

**验证**：
- `npm run lint:all`
- `cd frontend && npm run type-check`
- `cd frontend && npm run test`
- 跑全量 E2E：`cd e2e && npx playwright test`
- `npm run cli:validate`
- 最后 grep 确认无残留 emoji：`grep -rP "[\x{1F000}-\x{1FAFF}]|[\x{2600}-\x{27BF}]|..." frontend/src --include="*.vue" --include="*.ts"`（排除 logger.* 与 aiChatStore:525）

**Commit**: `refactor(ui): 扫尾替换 AI/设置/Inspector/Schema emoji 为 SVG`

---

## 5. 测试策略

遵循项目 **E2E-first** 原则（见 AGENTS.md Testing Strategy）：

| 层 | 工具 | 范围 |
|----|------|------|
| 单元测试 | vitest | 仅 `iconRegistry.ts`（纯映射，无 Vue/Pinia 依赖，符合 vitest 范围） |
| E2E | Playwright | 节点渲染、检查徽章、视图切换、右键菜单等现有 spec 覆盖（不改交互逻辑，不新增专门 E2E） |
| 类型检查 | vue-tsc | 每阶段必跑，确保 `iconName` prop 类型安全 |
| Lint | ESLint + ruff | 每阶段必跑 |

### 单元测试要点（`iconRegistry.test.ts`）

- 验证 `ICON_REGISTRY` 包含所有 §3 列出的业务图标名（断言关键键存在，不 snapshot）
- `getIcon('check')` 返回定义的组件，`getIcon('nonexistent')` 返回 `undefined`
- `CONSTRAINT_ICON_NAMES` 与 `ICON_REGISTRY` 的键一致（10 个约束类型全覆盖）
- `TRANSFORM_CATEGORY_ICON_NAMES` 同理（5 个分类全覆盖）

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `@lucide/vue` v1.0.0 发布仅 3 个月（2026-03），可能不稳 | 锁版本 `~1.0.0`；API 与已广泛验证的 lucide-vue-next 完全相同；如遇问题可降级 |
| 50+ 文件改动易遗漏或破坏 | 分 5 阶段，每阶段独立 type-check + lint；阶段 2/3/4 后跑相关 E2E；阶段 5 后全量验证 |
| `NodeHeader` 的 `icon` prop 被大量调用，破坏面大 | 阶段 2 保留 `icon` 作 deprecated（带 console.warn），渐进迁移；阶段 5 确认无残留后删除 |
| `aiChatStore.ts:525` 的 ⚠️ 注入聊天消息（markdown 渲染） | 保留为已知边界（§2.7），不改 markdown 渲染层 |
| `SourcePreviewNode.css:652` 的 CSS `content: '⚠️'` | 迁移到模板 `<AppIcon>`，CSS 删除 content 规则 |
| E2E 选择器若依赖 emoji 文本会失效 | 已确认 `e2e/` 目录无 emoji 文本选择器（grep 验证） |
| 删除按钮 × 改 SVG 后尺寸/对齐变化 | 调整 `NodeShell.styles.css` 的 `.node-shell__delete-btn`；E2E 后人工核对 |
| `useConstraintTypes.ts` 的 `CONSTRAINT_ICONS`（SVG 字符串）被多处 `v-html` | 改为导出图标名，消费方用 `<AppIcon>`；或保留 SVG 字符串但同步替换为非 emoji 方案（倾向前者） |
| 现有内联 SVG（243 处）是否要换 | 明确不在范围，避免 scope 膨胀（§1.3） |

---

## 7. 成功标准

- [ ] `frontend/src/` 中用户可见的 emoji 全部替换（logger.* 与 aiChatStore:525 除外）
- [ ] 用户可见的文本符号 ×/✕/✓/✗ 替换为 SVG
- [ ] i18n 文案不再嵌入 emoji（图标由组件渲染）
- [ ] `@lucide/vue` 作为依赖引入，`iconRegistry.ts` + `AppIcon.vue` 基建就位
- [ ] `npm run lint:all`、`npm run type-check`（frontend）、`npm run test`（frontend）、`cd e2e && npx playwright test`、`npm run cli:validate` 全绿
- [ ] 单元测试覆盖 `iconRegistry.ts`
- [ ] 5 个 commit 对应 5 个阶段，每个可独立验证

---

## 8. 后续可选（不在本次范围）

- 收敛现有 243 处手写内联 SVG 到 `AppIcon`（另立专项）
- 清理 logger.* 日志前缀 emoji（若需要无 emoji 代码库）
- 删除 `assets/logo.svg`（Vue 脚手架残留）
