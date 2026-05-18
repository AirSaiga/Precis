---
name: "typescript-types"
description: "Precis TypeScript 类型系统规范。适用于 frontend/src/ 下类型定义、接口设计、API 类型、共享类型与 Feature 专属类型的组织。"
scope: ["frontend/src/types/**/*.ts", "frontend/src/**/*.ts"]
---

# Precis TypeScript 类型系统规范

## 适用范围

- 全局共享类型（`src/types/`）
- Feature 专属类型（`src/features/<name>/types/`）
- API 请求/响应类型（`src/api/`）
- Vue 组件 Props/Emits 类型
- Pinia Store 状态类型
- Vue Flow 节点数据类型

## 类型目录组织

```
frontend/src/
├── types/                    # 全局共享类型
│   ├── graph.ts             # 画布节点、连接类型
│   ├── constraints.ts       # 约束类型定义
│   ├── project.ts           # 项目相关类型
│   └── index.ts             # 统一导出
├── api/
│   └── types/               # API 专属类型
│       ├── conflict.ts
│       └── validation/
└── features/
    └── keyboard/
        └── types.ts         # Feature 专属类型
```

## interface vs type

| 场景 | 推荐 | 说明 |
|------|------|------|
| 对象形状定义 | `interface` | 支持声明合并，更适合 OOP |
| 联合类型 | `type` | `type Status = 'idle' \| 'loading' \| 'success'` |
| 元组/映射 | `type` | `type Point = [number, number]` |
| 工具类型衍生 | `type` | `type PartialUser = Partial<User>` |

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 接口 | PascalCase | `RegexNodeData`, `ProjectManifest` |
| 类型别名 | PascalCase | `ConstraintType`, `MatchMode` |
| 枚举 | PascalCase，单数 | `enum ValidationStatus` |
| 泛型参数 | 单个大写字母或 PascalCase | `T`, `TData`, `TResponse` |

## 核心类型定义示例

### 画布节点数据

```typescript
// types/graph.ts
export interface BaseNodeData {
  id: string
  label: string
  type: NodeType
  position: { x: number; y: number }
}

export interface SchemaNodeData extends BaseNodeData {
  type: 'schema'
  tableId: string
  columns: SchemaColumn[]
  sourceRef?: DataSourceRef
}

export interface RegexNodeData extends BaseNodeData {
  type: 'regex'
  pattern: string
  matchMode: MatchMode
  caseSensitive: boolean
  sourceRef?: {
    tableId: string
    columnId: string
  }
}

export type NodeData = SchemaNodeData | RegexNodeData | ConstraintNodeData
export type NodeType = 'schema' | 'regex' | 'constraint' | 'preview'
export type MatchMode = 'full' | 'partial' | 'extract'
```

### 约束类型

```typescript
// types/constraints.ts
export type ConstraintType = 
  | 'Unique' 
  | 'NotNull' 
  | 'AllowedValues' 
  | 'ForeignKey' 
  | 'Conditional' 
  | 'Scripted'
  | 'Range'
  | 'Charset'

export interface BaseConstraint {
  id: string
  type: ConstraintType
  enabled: boolean
  description?: string
}

export interface UniqueConstraint extends BaseConstraint {
  type: 'Unique'
  refs: {
    tableId: string
    columnIds: string[]
  }
}

export interface RangeConstraint extends BaseConstraint {
  type: 'Range'
  refs: {
    tableId: string
    columnId: string
  }
  params: {
    min?: number
    max?: number
  }
}

export type Constraint = UniqueConstraint | RangeConstraint | /* ... */
```

### API 响应类型

```typescript
// api/types/conflict.ts
export interface ConflictItem {
  id: string
  type: 'schema' | 'constraint' | 'regex'
  localVersion: unknown
  remoteVersion: unknown
  resolution?: 'local' | 'remote' | 'merged'
}

export interface ConflictResolutionPayload {
  conflicts: ConflictItem[]
  strategy: 'manual' | 'prefer-local' | 'prefer-remote'
}
```

## 组件 Props 类型

```vue
<script setup lang="ts">
// 优先使用 interface 定义 Props
interface Props {
  visible: boolean
  ruleData?: RegexNodeData
  readonly?: boolean
}

// 使用 withDefaults 提供默认值
const props = withDefaults(defineProps<Props>(), {
  readonly: false
})

// Emits 类型定义
const emit = defineEmits<{
  close: []
  save: [data: RegexNodeData]
  'update:visible': [value: boolean]
}>()
</script>
```

## Pinia Store 类型

```typescript
// stores/graphStore.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Node, Edge, NodeData } from '@/types/graph'

export interface GraphState {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId: string | null
}

export const useGraphStore = defineStore('graph', () => {
  // State
  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])
  const selectedNodeId = ref<string | null>(null)
  
  // Getters
  const selectedNode = computed(() => 
    nodes.value.find(n => n.id === selectedNodeId.value)
  )
  
  const nodeCount = computed(() => nodes.value.length)
  
  // Actions
  function addNode(node: Node): void {
    nodes.value.push(node)
  }
  
  function removeNode(nodeId: string): void {
    const index = nodes.value.findIndex(n => n.id === nodeId)
    if (index > -1) {
      nodes.value.splice(index, 1)
      edges.value = edges.value.filter(
        e => e.source !== nodeId && e.target !== nodeId
      )
    }
  }
  
  function updateNodeData<T extends NodeData>(
    nodeId: string, 
    data: Partial<T>
  ): void {
    const node = nodes.value.find(n => n.id === nodeId)
    if (node) {
      node.data = { ...node.data, ...data }
    }
  }
  
  return {
    nodes, edges, selectedNodeId,
    selectedNode, nodeCount,
    addNode, removeNode, updateNodeData
  }
})
```

## 类型守卫

```typescript
// utils/typeGuards.ts
import type { SchemaNodeData, RegexNodeData, NodeData } from '@/types/graph'

export function isSchemaNodeData(data: NodeData): data is SchemaNodeData {
  return data.type === 'schema'
}

export function isRegexNodeData(data: NodeData): data is RegexNodeData {
  return data.type === 'regex'
}

// 使用
function handleNodeClick(data: NodeData) {
  if (isSchemaNodeData(data)) {
    // TypeScript 知道这里是 SchemaNodeData
    console.log(data.columns)
  } else if (isRegexNodeData(data)) {
    // TypeScript 知道这里是 RegexNodeData
    console.log(data.pattern)
  }
}
```

## 泛型使用规范

```typescript
// 通用响应包装器
interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
}

// 分页响应
interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// 使用
async function fetchProjects(): Promise<ApiResponse<Project[]>> {
  const res = await httpClient.get('/projects')
  return res.data
}
```

## 类型导出规范

每个类型模块应提供统一导出：

```typescript
// types/index.ts
export type { NodeData, EdgeData, GraphState } from './graph'
export type { Constraint, ConstraintType } from './constraints'
export type { ProjectManifest, ProjectSettings } from './project'
```

Feature 模块同样：

```typescript
// features/keyboard/types.ts
export interface ShortcutCommand {
  id: string
  keys: string[]
  description: string
  action: () => void
}

export interface KeyboardState {
  activeShortcuts: Map<string, ShortcutCommand>
  enabled: boolean
}
```

## 避免的类型反模式

❌ **不要使用 `any`**
```typescript
// 错误
function processData(data: any): any { ... }

// 正确
function processData<T extends Record<string, unknown>>(data: T): T { ... }
```

❌ **不要重复定义相同结构**
```typescript
// 错误：前后端各定义一次
interface User { id: string; name: string }
interface UserResponse { id: string; name: string }

// 正确：使用泛型或继承
interface User { id: string; name: string }
type UserResponse = ApiResponse<User>
```

❌ **避免过深的可选链**
```typescript
// 错误
const name = node?.data?.properties?.name?.value

// 正确：使用类型守卫或默认值
const name = node.data?.name ?? ''
```
