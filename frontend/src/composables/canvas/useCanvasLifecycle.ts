/**
 * @file useCanvasLifecycle.ts
 * @description 画布生命周期管理组合式函数
 *
 * 职责：
 * - 注册/清理画布相关的全局事件监听器
 * - 处理来自子组件的跨组件通信事件
 * - 键盘快捷键（Ctrl+H 聚焦项目）
 * - 聚焦到项目根节点
 */

import { onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { platformDetector } from '@/features/keyboard/platform'
import { useGraphStore } from '@/stores/graphStore'
import { useDragStore } from '@/stores/dragStore'
import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { AppEvents } from '@/core/eventBus'

export interface CanvasLifecycleOptions {
  /** 项目创建对话框打开回调 */
  onOpenCreateProjectDialog?: () => void
  /** 表头行变更回调 */
  onHeaderRowChanged?: (detail: AppEvents['headerRowChanged']) => void
  /** 数据源预览数据变更回调 */
  onSourcePreviewDataChanged?: (detail: AppEvents['sourcePreviewDataChanged']) => void | Promise<void>
  /** Schema 节点保存回调 */
  onSchemaNodeSave?: (detail: AppEvents['schema-node-save']) => void | Promise<void>
  /** 正则模式更新回调 */
  onRegexPatternUpdated?: (detail: AppEvents['regex-pattern-updated']) => void | Promise<void>
}

/**
 * @description 画布生命周期管理组合式函数
 * @param options - 生命周期事件回调配置
 * @returns 包含 focusToProjectRoot 方法的对象
 */
export function useCanvasLifecycle(options: CanvasLifecycleOptions = {}) {
  const store = useGraphStore()
  const dragStore = useDragStore()
  const { fitView, findNode, updateNode } = useVueFlow()

  /**
   * @description 聚焦到项目根节点
   * @description 将所有隐藏节点恢复显示，并将视口动画聚焦到项目根节点
   */
  const focusToProjectRoot = () => {
    // 恢复所有被隐藏的节点，确保项目根节点可见
    store.nodes.forEach((node) => {
      if (node.hidden) {
        updateNode(node.id, { hidden: false })
      }
    })
    // 查找项目根节点并将视口适配聚焦
    const projectNode = store.nodes.find((n) => n.type === 'projectRoot')
    if (projectNode) {
      fitView({ nodes: [projectNode.id], padding: 0.5, duration: 300 })
    }
  }

  // 将聚焦方法挂载到全局 window 对象，供 Toolbar 等外部组件调用
  ;(window as unknown as { __focusToProjectRoot?: () => void }).__focusToProjectRoot =
    focusToProjectRoot

  /**
   * @description 处理聚焦画布节点事件
   * @param evt - 自定义事件，包含需要聚焦的节点 ID 列表
   */
  const handleFocusCanvasNodes = (detail: { nodeIds: string[] }) => {
    const nodeIds = detail.nodeIds
    if (nodeIds.length === 0) return

    store.setSelection(nodeIds)
    const focusNodeIds = nodeIds.filter((id) => findNode(id))
    if (focusNodeIds.length > 0) {
      fitView({ nodes: focusNodeIds, padding: 0.25 })
    }
  }

  /**
   * @description 处理全局键盘按下事件
   * @param evt - 键盘事件对象
   */
  const handleGlobalKeydown = (evt: KeyboardEvent) => {
    // 根据操作系统判断使用 Ctrl 还是 Command(Meta) 键
    const isMac = platformDetector.isMac()
    const isCtrlOrMeta = isMac ? evt.metaKey : evt.ctrlKey

    // Ctrl+H / Command+H：快捷键聚焦到项目根节点
    if (isCtrlOrMeta && evt.key.toLowerCase() === 'h') {
      // 仅在项目已加载时响应快捷键
      if (!store.isProjectLoaded) return
      evt.preventDefault()
      evt.stopPropagation()
      focusToProjectRoot()
    }
  }

  const handleHeaderRowChanged = (detail: AppEvents['headerRowChanged']) => {
    options.onHeaderRowChanged?.(detail)
  }

  const handleSourcePreviewDataChanged = (detail: AppEvents['sourcePreviewDataChanged']) => {
    options.onSourcePreviewDataChanged?.(detail)
  }

  const handleSchemaNodeSave = (detail: AppEvents['schema-node-save']) => {
    options.onSchemaNodeSave?.(detail)
  }

  const handleRegexPatternUpdated = (detail: AppEvents['regex-pattern-updated']) => {
    options.onRegexPatternUpdated?.(detail)
  }

  onMounted(() => {
    eventBus.on('headerRowChanged', handleHeaderRowChanged)
    eventBus.on('sourcePreviewDataChanged', handleSourcePreviewDataChanged)
    eventBus.on('schema-node-save', handleSchemaNodeSave)
    eventBus.on('regex-pattern-updated', handleRegexPatternUpdated)
    eventBus.on('focus-canvas-nodes', handleFocusCanvasNodes)
    window.addEventListener('keydown', handleGlobalKeydown)
  })

  onUnmounted(() => {
    eventBus.off('headerRowChanged', handleHeaderRowChanged)
    eventBus.off('sourcePreviewDataChanged', handleSourcePreviewDataChanged)
    eventBus.off('schema-node-save', handleSchemaNodeSave)
    eventBus.off('regex-pattern-updated', handleRegexPatternUpdated)
    eventBus.off('focus-canvas-nodes', handleFocusCanvasNodes)
    window.removeEventListener('keydown', handleGlobalKeydown)
    delete (window as unknown as { __focusToProjectRoot?: () => void }).__focusToProjectRoot
    // 清除拖拽悬浮状态
    dragStore.clearHover()
    logger.debug('NodeCanvas lifecycle cleaned up')
  })

  return {
    focusToProjectRoot,
  }
}
