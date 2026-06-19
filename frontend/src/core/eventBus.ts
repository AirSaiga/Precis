/**
 * @file eventBus.ts
 * @description 类型安全的应用级事件总线
 *
 * 替代散落在各 composable 中的 window/document CustomEvent 模式。
 * 所有自定义事件统一通过此总线分发和监听。
 *
 * 用法:
 *   import { eventBus } from '@/core/eventBus'
 *   eventBus.emit('focus-canvas-nodes', { nodeIds: ['id1'] })
 *   eventBus.on('focus-canvas-nodes', (payload) => { ... })
 *   eventBus.off('focus-canvas-nodes', handler)
 */
import mitt from 'mitt'
import type { DragEventPayload } from '@/stores/dragStore'
import type { ResourceItem } from '@/types/resource/types'

export interface AppEvents {
  'focus-canvas-nodes': { nodeIds: string[] }
  /**
   * 请求把某个资源导入画布并聚焦其节点。
   * 由配置自检抽屉等画布外的组件发出，画布组件监听后执行导入+定位。
   * kind 取值与 importV2ResourceToCanvas 一致：'schema' | 'constraint' | 'regex' | 'transform'
   */
  'inspection-import-and-focus': { resourceId: string; kind: 'schema' | 'constraint' | 'regex' | 'transform' }
  'project-applied': undefined
  sourcePreviewDataChanged: { nodeId: string; data: Record<string, unknown> }
  headerRowChanged: {
    nodeId: string
    headerRow: number
    data: Record<string, unknown>
    oldHeaderRow: number
    rowData: string[]
  }
  'regex-pattern-updated': { nodeId: string; reason: string }
  sourceNodeDisconnected: {
    sourceNodeId: string
    targetNodeId: string
    edgeId: string
  }
  'data-source-refreshed': { nodeId: string; fileId: string; fileName: string }
  'data-source-changed': undefined
  'reload-file-uploaded': { file: File; nodeId: string; sourceName: string }
  schemaValidationCompleted: { nodeId: string; results: unknown }
  'validate-json-schema': { nodeId: string }
  constraintValidationCompleted: { nodeId: string; result: unknown }
  regexPatternUpdated: {
    nodeId: string
    pattern: string
    flags: string
    matchMode: string
    caseSensitive: boolean
  }
  viewchange: { view: string }
  'open-settings': undefined
  'open-project-management': undefined
  'project-closed': undefined
  'open-save-as-template-dialog': undefined
  fielddragstart: DragEventPayload
  fielddragend: undefined
  'json-source-preview-refresh': { nodeId: string }
  'schema-node-save-complete': {
    nodeId: string
    success: boolean
    cancelled?: boolean
    error?: string
  }
  'schema-node-save': { nodeId: string; nodeData: unknown }
  'json-schema-node-save': { nodeId: string; nodeData: unknown }
  'json-schema-node-save-complete': {
    nodeId: string
    success: boolean
    cancelled?: boolean
    error?: string
  }
  'open-resource-context-menu': {
    visible: boolean
    position: { x: number; y: number }
    kind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template'
    item: ResourceItem
  }
}

export type AppEventMap = {
  [K in keyof AppEvents]: AppEvents[K]
}

export const eventBus = mitt<AppEventMap>()
