/**
 * @file index.ts
 * @description JSON Schema节点入口
 * 整合所有 JSON Schema 节点相关的逻辑
 * 作为 JSON Schema 节点模块的统一出口
 */

import { useJsonSchemaData } from './useJsonSchemaData'
import { useJsonSchemaSourceManager } from './useJsonSchemaSourceManager'
import { useJsonSchemaValidation } from './useJsonSchemaValidation'
import { useJsonSchemaUI } from './useJsonSchemaUI'
import { useJsonSchemaInteractions } from './useJsonSchemaInteractions'
import { useJsonSchemaResizable } from './useJsonSchemaResizable'
import { useJsonSchemaSaving } from './useJsonSchemaSaving'
import { useJsonSchemaDrag } from './useJsonSchemaDrag'
import { useJsonSchemaConnectionHandler } from './useJsonSchemaConnectionHandler'
import type { JsonSchemaNodeData, JsonSchemaColumn } from '@/types/nodes'
import type { EmitFn } from 'vue'
import type { ConstraintCreateData } from './useJsonSchemaInteractions'

type JsonSchemaNodeEmits = {
  save: [JsonSchemaNodeData]
  'remove-node': [string]
  dataChanged: [JsonSchemaNodeData]
  'column-add': []
  'column-update': [{ columnId: string; updates: Partial<JsonSchemaColumn> }]
  'column-delete': [string]
  'constraint-create': [ConstraintCreateData]
  'source-connect': [{ sourceNodeId: string; targetNodeId: string }]
}

/**
 * JSON Schema节点统一入口
 * 整合 JSON Schema 节点的所有功能模块
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
export function useJsonSchemaNode(
  props: { id: string; data: JsonSchemaNodeData },
  emit: EmitFn<JsonSchemaNodeEmits>
) {
  // JSON Schema数据管理
  // 处理 JSON Schema 节点的数据初始化、更新、同步等核心功能
  const data = useJsonSchemaData(props, emit)

  // JSON Schema数据源连接管理
  // 处理 JSON Schema 节点与数据源节点的连接状态管理
  const sourceManager = useJsonSchemaSourceManager(
    props,
    emit as (event: string, ...args: unknown[]) => void
  )

  // JSON Schema验证
  // 提供列验证、约束检查等功能
  const validation = useJsonSchemaValidation(props)

  // JSON Schema UI
  // 提供 UI 相关的状态和方法，如悬停状态、选中状态等
  const ui = useJsonSchemaUI(props)

  // JSON Schema交互
  // 处理拖拽、键盘事件、列连接等交互行为
  const interactions = useJsonSchemaInteractions(
    props,
    emit as (event: string, ...args: unknown[]) => void
  )

  // JSON Schema调整大小
  // 处理节点的宽度和高度调整
  const resizable = useJsonSchemaResizable(props)

  // JSON Schema保存
  // 处理 JSON Schema 节点的保存逻辑，包括本地状态和远程同步
  const saving = useJsonSchemaSaving(props, emit as (event: string, ...args: unknown[]) => void)

  // JSON Schema拖拽
  // 处理节点和列的拖拽排序
  const drag = useJsonSchemaDrag(
    props,
    emit as unknown as EmitFn<{ columnReorder: [Record<string, unknown>] }>
  )

  return {
    // JSON Schema数据管理
    ...data,

    // JSON Schema数据源连接管理
    ...sourceManager,

    // JSON Schema验证
    ...validation,

    // JSON Schema UI
    ...ui,

    // JSON Schema交互
    ...interactions,

    // JSON Schema调整大小
    ...resizable,

    // JSON Schema保存
    ...saving,

    // JSON Schema拖拽
    ...drag,
  }
}

// 导出所有子模块，供外部按需导入使用
// 这样可以在不引入整个 useJsonSchemaNode 的情况下使用单个功能
export * from './useJsonSchemaData'
export * from './useJsonSchemaSourceManager'
export * from './useJsonSchemaValidation'
export * from './useJsonSchemaUI'
export * from './useJsonSchemaInteractions'
export * from './useJsonSchemaResizable'
export * from './useJsonSchemaSaving'
export * from './useJsonSchemaDrag'
export * from './useJsonSchemaConnectionHandler'

// 导出工具函数
export * from '@/utils/nodes/json/columnGeneration'
export * from '@/utils/nodes/json/typeInference'
export * from '@/utils/nodes/json/columnValidation'

// 重新导出共享的 useToast
export { useToast } from '@/composables/shared/useToast'
