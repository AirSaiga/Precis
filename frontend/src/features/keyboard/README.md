# Keyboard Shortcuts Module

## 目录结构

```
keyboard/
├── commands/              ← 命令定义（快捷键 + 元数据）
│   ├── baseCommands.ts   ← 编辑器基础命令
│   ├── canvasCommands.ts  ← 画布相关命令
│   ├── helpCommands.ts   ← 帮助命令
│   ├── feedback.ts       ← 反馈相关
│   └── index.ts
├── handlers/              ← 命令处理器（业务逻辑）
│   ├── node/             ← 节点操作
│   │   ├── duplicate.ts
│   │   ├── copyCutPaste.ts
│   │   ├── delete.ts
│   │   ├── move.ts
│   │   ├── bindDataSource.ts
│   │   ├── generateSchema.ts
│   │   ├── validateNode.ts
│   │   └── index.ts
│   ├── canvas/           ← 画布视图操作
│   │   ├── zoom.ts
│   │   ├── view.ts
│   │   └── index.ts
│   ├── history/          ← 历史记录操作
│   │   ├── undo.ts
│   │   ├── redo.ts
│   │   └── index.ts
│   ├── editor/           ← 编辑器操作
│   │   └── save.ts
│   └── index.ts
├── registry/             ← 命令注册表
│   ├── shortcutRegistry.ts
│   └── index.ts
├── executor/             ← 命令执行器
│   ├── commandExecutor.ts
│   └── index.ts
├── listeners/            ← 键盘事件监听
│   ├── keyboardListener.ts
│   └── index.ts
├── platform/             ← 平台检测与适配
│   ├── detector.ts
│   ├── adapter.ts
│   └── index.ts
├── stores/               ← 快捷键状态管理
│   ├── shortcutStore.ts
│   └── index.ts
├── index.ts              ← 模块入口
├── types.ts              ← 类型定义
├── constants.ts          ← 快捷键配置
└── README.md             ← 本文档
```

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer                                   │
│           Components / Shortcuts / Context Menu                  │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Commands Layer                             │
│             commands/ (定义命令元数据和快捷键)                     │
│                                                                  │
│   Command = {                                                   │
│     id, name, defaultShortcut, platformVariants,                │
│     category, priority, execute(), isAvailable()                 │
│   }                                                             │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Handlers Layer                             │
│             handlers/ (业务逻辑编排)                               │
│                                                                  │
│   职责：                                                         │
│   1. 调用 Store 方法执行操作                                      │
│   2. 返回操作结果 { success, message }                            │
│   3. 处理业务逻辑（参数转换、状态检查等）                          │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Stores Layer                               │
│         graphStore.ts / canvasStore.ts (纯状态管理)                │
│                                                                  │
│   职责：                                                         │
│   1. 状态定义 (nodes, edges, selection)                          │
│   2. CRUD 操作 (create, delete, update, get)                      │
│   3. 历史记录 (undo, redo, saveState)                            │
└─────────────────────────────────────────────────────────────────┘
```

## 新增快捷键步骤

### 步骤 1: 创建处理器 (handlers/)

根据命令类型，在对应的目录下创建处理器文件：

**handlers/node/**: 节点相关
**handlers/canvas/**: 画布相关
**handlers/history/**: 历史相关
**handlers/editor/**: 编辑器相关

```typescript
// handlers/node/newFeature.ts
import { useGraphStore } from '@/stores/graphStore'

export async function newFeature(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  if (!graphStore.selectedNodeId) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  // 业务逻辑
  // ...

  return { success: true, message: 'shortcuts.feedback.success' }
}
```

**注意**：处理器函数返回 `{ success, message }` 格式，`message` 是 i18n 键名。

### 步骤 2: 在 index.ts 中导出

```typescript
// handlers/node/index.ts
export { newFeature } from './newFeature'
```

### 步骤 3: 定义命令 (commands/)

在对应的命令文件中添加命令定义：

```typescript
// commands/canvasCommands.ts
import { newFeature } from '../handlers/node'

export function createNewFeatureCommand(): Command {
  return {
    id: 'node.newFeature', // 唯一标识
    name: 'shortcuts.newFeature', // i18n 键名
    defaultShortcut: { key: 'n', ctrl: true, shift: true },
    category: 'node',
    priority: 35,
    execute: async () => {
      const result = await newFeature()
      if (result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}
```

### 步骤 4: 添加 i18n 键值

**zh-CN/shortcuts.ts**:

```typescript
feedback: {
  newFeature: '新功能执行成功',
}
```

**en-US/shortcuts.ts**:

```typescript
feedback: {
  newFeature: 'New feature executed',
}
```

**命令名称**（用于快捷键设置界面显示）：

```typescript
commands: {
  newFeature: '新功能',
}
```

### 步骤 5: 测试

重启开发服务器，测试快捷键是否生效。

## 快捷键分类

| 分类   | 命令前缀       | Handler 目录       | 示例                    |
| ------ | -------------- | ------------------ | ----------------------- |
| 画布   | `canvas.*`     | handlers/canvas/   | zoomIn, fitView         |
| 节点   | `node.*`       | handlers/node/     | duplicate, delete, move |
| 历史   | `history.*`    | handlers/history/  | undo, redo              |
| 编辑器 | `editor.*`     | handlers/editor/   | save                    |
| 连接   | `connection.*` | handlers/ (需新建) | create, delete          |

## 快捷键配置

### 默认快捷键定义位置

`constants.ts` 中定义了所有默认快捷键：

```typescript
export const DEFAULT_SHORTCUTS: Record<string, Shortcut | { mac: Shortcut; windows: Shortcut }> = {
  'node.duplicate': {
    mac: { key: 'd', meta: true },
    windows: { key: 'd', ctrl: true },
  },
  // ...
}
```

### 快捷键格式

```typescript
interface Shortcut {
  key: string // 键名 (如 'a', 'ArrowUp', 'Delete')
  ctrl?: boolean // Ctrl 修饰键
  meta?: boolean // Cmd (Mac) 修饰键
  shift?: boolean // Shift 修饰键
  alt?: boolean // Alt/Option 修饰键
}
```

## 最佳实践

1. **每个命令一个文件** - 便于维护和查找
2. **处理器函数返回 `{ success, message }`** - 统一接口
3. **使用 i18n 键值** - 避免硬编码文本
4. **在 `isAvailable` 中检查前置条件** - 防止无效操作
5. **保持处理器简洁** - 只做业务编排，不处理 UI
6. **所有状态操作通过 Store** - 保持数据一致性

## 命令对象结构

```typescript
interface Command {
  id: string // 命令唯一标识
  name: string // i18n 键名（显示名称）
  defaultShortcut?: Shortcut // 默认快捷键
  platformVariants?: {
    // 平台特定快捷键
    mac?: Shortcut
    windows?: Shortcut
  }
  category: string // 分类 (editor/canvas/node/history)
  priority: number // 优先级 (数字越小越靠前)
  execute: (context?: CommandContext) => Promise<void>
  isAvailable?: (context?: CommandContext) => Promise<boolean> | boolean
}
```

## 常见问题

### Q: 快捷键不生效怎么办？

1. 检查 `App.vue` 中是否调用了 `useKeyboardShortcuts()`
2. 检查浏览器控制台是否有错误日志
3. 检查 `isAvailable` 返回 `false`（如没有选中节点）

### Q: 如何调试快捷键？

打开浏览器控制台，添加以下日志：

```typescript
// 在 handlers/* 中
console.log('[NewFeature] 执行:', result)
```

### Q: 如何禁用某个快捷键？

命令注册时会自动禁用冲突的快捷键，或通过配置禁用：

```typescript
const manager = useKeyboardShortcuts()
manager.disable('node.duplicate') // 禁用复制节点快捷键
```
