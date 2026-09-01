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
  'inspection-import-and-focus': {
    resourceId: string
    kind: 'schema' | 'constraint' | 'regex' | 'transform'
  }
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
  'reload-file-uploaded': { file: File; nodeId: string; sourceName: string }
  schemaValidationCompleted: { nodeId: string; results: unknown }
  'validate-json-schema': { nodeId: string }
  constraintValidationCompleted: { nodeId: string; result: unknown }
  viewchange: { view: string }
  'open-settings': undefined
  'open-project-management': undefined
  'project-closed': undefined
  /**
   * 持久化的项目路径已失效（后端返回"提供的项目配置路径不存在"404）。
   * 由 httpClient 响应拦截器检测到该 404 后发出；App 层监听后清理项目
   * 运行时状态并回到项目选择页，避免应用带着死路径对所有项目级请求持续 404。
   */
  'project-path-invalid': undefined
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
  /**
   * 全量校验"全绿"完成（0 错误 0 阻塞且全部通过）。
   * 由 useValidationTaskRunner 在结果落地后发出，状态栏监听后
   * 给成功计数一次 status-pulse 动画（一次性、不循环）。
   */
  'full-validation-all-pass': {
    passedCount: number
    totalChecks: number
  }
}

export type AppEventMap = {
  [K in keyof AppEvents]: AppEvents[K]
}

export const eventBus = mitt<AppEventMap>()
