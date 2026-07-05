/**
 * @file useCanvasEventSetup.ts
 * @description 画布事件设置组合式函数
 *
 * 职责：
 * - 统一设置画布相关的跨组件事件处理（Schema、SourcePreview、Regex）
 * - 连接调度器初始化
 * - 生命周期事件注册与清理
 */

import { useCanvasLifecycle } from './useCanvasLifecycle'
import { useConnectionDispatcher } from './useConnectionDispatcher'
import { useSchemaEvents } from '@/composables/nodes/schema/useSchemaEvents'
import { useJsonSchemaEvents } from '@/composables/nodes/json/useJsonSchemaEvents'
import { useSourcePreviewEvents } from '@/composables/nodes/sourcePreview/useSourcePreviewEvents'
import { useRegexValidation } from '@/features/regex/composables'
import type { SchemaNodeData, JsonSchemaNodeData, SourcePreviewNodeData } from '@/types/graph'

export interface CanvasEventSetupOptions {
  /** 打开创建项目对话框回调 */
  onOpenCreateProjectDialog: () => void
}

/**
 * @description 画布事件设置组合式函数
 * @description 整合 Schema、SourcePreview、Regex 等模块的事件处理，并初始化连接调度器
 * @param options - 事件设置配置选项
 * @returns 连接调度器回调和节点保存处理器
 */
export function useCanvasEventSetup(options: CanvasEventSetupOptions) {
  // 初始化 Schema 节点事件处理器（传入空对象作为占位，实际事件通过 lifecycle 转发）
  const { handleNodeSave } = useSchemaEvents(
    { id: '', data: {} } as unknown as { id: string; data: SchemaNodeData },
    () => {}
  )

  // 初始化 JSON Schema 节点事件处理器（同上，仅处理保存事件的持久化）
  const { handleJsonSchemaNodeSave } = useJsonSchemaEvents({ id: '', data: {} } as unknown as {
    id: string
    data: JsonSchemaNodeData
  })

  // 初始化 SourcePreview 节点事件处理器
  const { handleHeaderRowChanged, handleSourcePreviewDataChanged } = useSourcePreviewEvents(
    { id: '', data: {} } as unknown as { id: string; data: SourcePreviewNodeData },
    () => {}
  )

  // 初始化正则验证事件处理器
  const { handleRegexPatternUpdated } = useRegexValidation()

  // 初始化连接调度器，获取连接各阶段的回调函数
  const {
    onConnectStart: onConnectStartFromDispatcher,
    onConnect: onConnectFromDispatcher,
    onConnectEnd: onConnectEndFromDispatcher,
  } = useConnectionDispatcher()

  // 注册画布生命周期事件，将各模块事件处理器统一挂载
  useCanvasLifecycle({
    onOpenCreateProjectDialog: options.onOpenCreateProjectDialog,
    onHeaderRowChanged: handleHeaderRowChanged,
    onSourcePreviewDataChanged: handleSourcePreviewDataChanged,
    onSchemaNodeSave: (detail) => handleNodeSave(detail),
    onJsonSchemaNodeSave: (detail) => handleJsonSchemaNodeSave(detail),
    onRegexPatternUpdated: handleRegexPatternUpdated,
  })

  return {
    onConnectStartFromDispatcher,
    onConnectFromDispatcher,
    onConnectEndFromDispatcher,
    handleNodeSave,
    handleJsonSchemaNodeSave,
  }
}
