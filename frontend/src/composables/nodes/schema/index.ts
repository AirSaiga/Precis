/**
 * @file index.ts
 * @description Schema节点入口
 * 整合所有 Schema 节点相关的逻辑
 * 作为 Schema 节点模块的统一出口
 */

import { useSchemaData } from './useSchemaData'
import { useSchemaSourceManager } from './useSchemaSourceManager'
import { useColumnGeneration } from './useColumnGeneration'
import { useSchemaValidation } from './useSchemaValidation'
import { useSchemaEditing } from './useSchemaEditing'
import { useSchemaSaving } from './useSchemaSaving'
import { useSchemaUI } from './useSchemaUI'
import { useSchemaConnectionHandler } from './useSchemaConnectionHandler'
import { useSchemaEvents } from './useSchemaEvents'
import { useSchemaNodeDrag } from './useSchemaNodeDrag'
import type { SchemaNodeData } from '../types'

/**
 * Schema节点统一入口
 * 整合 Schema 节点的所有功能模块
 * 提供一站式的方法和状态访问接口
 *
 * 设计考量：
 * - 使用组合式函数（Composables）模式组织代码
 * - 将复杂的节点逻辑拆分为多个职责单一的功能模块
 * - 通过展开运算符合并各模块的返回值
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含所有状态和方法的响应式对象
 */
export function useSchemaNode(props: { id: string; data: SchemaNodeData }, emit: any) {
  // Schema数据管理
  // 处理 Schema 节点的数据初始化、更新、同步等核心功能
  const data = useSchemaData(props, emit)

  // Schema数据源连接管理
  // 处理 Schema 节点与数据源节点的连接状态管理
  const sourceManager = useSchemaSourceManager(props, emit)

  // 列生成
  // 提供表头数据解析、列定义生成、类型推断等功能
  const generation = useColumnGeneration(props)

  // Schema验证
  // 提供列验证、约束检查等功能
  const validation = useSchemaValidation(props, emit)

  // Schema编辑
  // 处理表名编辑、列编辑、约束编辑、数据类型切换等用户交互
  const editing = useSchemaEditing(props, emit)

  // Schema UI - 先初始化以获取 hoveredColumn
  // 提供 UI 相关的状态和方法，如悬停状态、选中状态等
  const ui = useSchemaUI(props)

  // Schema保存 - 传递 hoveredColumn
  // 处理 Schema 节点的保存逻辑，包括本地状态和远程同步
  const saving = useSchemaSaving(props, emit, ui.hoveredColumn)

  // Schema事件处理
  // 处理全局事件，如保存事件、表头变更事件等
  const events = useSchemaEvents(props, emit)

  return {
    // Schema数据管理
    ...data,

    // Schema数据源连接管理
    ...sourceManager,

    // 列生成
    ...generation,

    // Schema验证
    ...validation,

    // Schema编辑
    ...editing,

    // Schema保存
    ...saving,

    // Schema UI
    ...ui,

    // Schema事件处理
    ...events,
  }
}

// 导出所有子模块，供外部按需导入使用
// 这样可以在不引入整个 useSchemaNode 的情况下使用单个功能
export * from './useSchemaData'
export * from './useSchemaSourceManager'
export * from './useColumnGeneration'
export * from './useSchemaValidation'
export * from './useSchemaEditing'
export * from './useSchemaSaving'
export * from './useSchemaUI'
export * from './useSchemaConnectionHandler'
export * from './useSchemaEvents'
export * from './useSchemaNodeDrag'

// 导出工具函数
export * from '@/utils/nodes/schema/typeInference'
export * from '@/utils/nodes/schema/columnGeneration'
export * from '@/utils/nodes/schema/columnValidation'

// 重新导出共享的 useToast
export { useToast } from '@/composables/shared/useToast'
