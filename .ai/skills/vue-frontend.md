---
name: "vue-frontend"
description: "Precis Vue3 TypeScript 前端开发规范。适用于 frontend/src/ 目录下组件、组合式函数、状态管理、画布节点等开发。"
scope: ["frontend/**/*.{vue,ts}"]
---

# Precis Vue3 TypeScript 前端开发规范

## 适用范围

- Vue 单文件组件（SFC）
- 组合式函数（Composables）
- Pinia 状态管理
- Vue Flow 画布节点与连接
- 检查器面板（Inspector Panel）
- 特性模块（features/ 垂直切片）

## 文件结构规范

```vue
<template>
  <!-- 模板代码 -->
</template>

<script setup lang="ts">
// 1. 导入外部组件
import ComponentA from '@/components/ComponentA.vue'

// 2. 导入类型
import type { MyType } from '@/types'

// 3. 导入组合式函数/工具
import { useStore } from '@/stores/store'
import { ref, computed } from 'vue'

// 代码逻辑
</script>

<style scoped>
/* 样式代码 */
</style>
```

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件名 | PascalCase | `NodeCanvas.vue`, `AssetLibrary` |
| 组合式函数 | camelCase，前缀 use | `useGraphStore`, `useTheme` |
| 类型/接口 | PascalCase | `RegexNodeData`, `ConstraintType` |
| 常量 | UPPER_SNAKE_CASE | `AI_CHAT_DRAWER_WIDTH`, `MIN_SIDEBAR_WIDTH` |
| 变量/函数 | camelCase | `sidebarWidth`, `toggleSidebar()` |
| Store | camelCase，后缀 Store | `useCanvasStore`, `useProjectStore` |

## Props 与 Emits 类型定义

```vue
<script setup lang="ts">
interface Props {
  visible: boolean
  ruleData?: RegexNodeData
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  save: [data: RegexNodeData]
}>()

// 组合式函数调用
const graphStore = useGraphStore()
const { t } = useI18n()
</script>
```

## features/ 目录垂直切片规范

满足以下全部条件的功能应组织为 feature：

- **跨层**：涉及 components + composables + types 等多个架构层
- **独立**：功能内聚，有明确的业务边界
- **用户可感知**：面向用户的交互功能

### 标准结构

```
features/<feature-name>/
├── components/     # 该功能的 UI 组件
├── composables/    # 该功能的组合式函数
├── types/          # 该功能的类型定义
├── services/       # 该功能的服务层（可选）
├── stores/         # 该功能的状态管理（可选）
└── index.ts        # 统一导出入口（必须）
```

### 已有 Feature 模块

| Feature | 说明 |
|---------|------|
| `keyboard/` | 键盘快捷键系统（命令模式） |
| `regex/` | 正则表达式设计器 |
| `node-layout-organizer/` | 节点布局自动整理 |

## CSS 变量规范

使用 CSS 变量统一管理主题：

```css
/* 背景色 */
--ui-bg-nav-primary: #1e1e1e;
--ui-bg-sidebar: #252526;
--ui-bg-canvas: #1e1e1e;
--ui-bg-elevated: #2d2d30;

/* 边框 */
--ui-border-subtle: #333;
--ui-border-light: #3c3c3c;

/* 文字 */
--ui-text-primary: #cccccc;
--ui-text-secondary: #9cdcfe;
--ui-text-muted: #858585;

/* 强调色 */
--ui-accent: #007acc;
--ui-accent-primary: #0e639c;
```

## 全局状态管理

使用 Pinia 管理全局状态：

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useGraphStore = defineStore('graph', () => {
  // State
  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])
  
  // Getters
  const nodeCount = computed(() => nodes.value.length)
  
  // Actions
  function addNode(node: Node) {
    nodes.value.push(node)
  }
  
  return { nodes, edges, nodeCount, addNode }
})
```

## Vue Flow 节点开发规范

### 节点数据接口

```typescript
export interface RegexNodeData {
  id: string
  name: string
  pattern: string
  matchMode: 'full' | 'partial' | 'extract'
  caseSensitive: boolean
  sourceRef?: {
    tableId: string
    columnId: string
  }
}
```

### 节点组件复用

节点外壳优先复用共享 UI 组件：
- `NodeShell` — 节点外壳容器
- `NodeHeader` — 节点头部
- `NodeHandle` — 连接点
- `NodeBadge` — 徽章
- `NodeDivider` — 分割线
- `nodeVariants.ts` — 节点主题变量

## 类型定义规范

类型定义放在 `src/types/` 目录：

```typescript
// types/graph.ts
export interface RegexNodeData {
  id: string
  name: string
  pattern: string
  matchMode: 'full' | 'partial' | 'extract'
  caseSensitive: boolean
  sourceRef?: {
    tableId: string
    columnId: string
  }
}

// 联合类型
export type ConstraintType = 
  | 'Unique' 
  | 'NotNull' 
  | 'AllowedValues' 
  | 'ForeignKey' 
  | 'Conditional' 
  | 'Scripted'
```
