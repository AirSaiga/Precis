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

export interface CanvasLifecycleOptions {
  /** 项目创建对话框打开回调 */
  onOpenCreateProjectDialog?: () => void
  /** 表头行变更回调 */
  onHeaderRowChanged?: (event: Event) => void
  /** 数据源预览数据变更回调 */
  onSourcePreviewDataChanged?: (event: any) => void | Promise<void>
  /** Schema 节点保存回调 */
  onSchemaNodeSave?: (event: any) => void | Promise<void>
  /** 正则模式更新回调 */
  onRegexPatternUpdated?: (event: any) => void | Promise<void>
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
  const handleFocusCanvasNodes = (evt: Event) => {
    // 从自定义事件的 detail 中提取节点 ID 列表
    const detail = (evt as CustomEvent).detail as { nodeIds?: string[] } | undefined
    const nodeIds = Array.isArray(detail?.nodeIds) ? detail!.nodeIds : []
    if (nodeIds.length === 0) return

    // 更新 Store 中的选中状态，并过滤出当前画布中实际存在的节点
    store.setSelection(nodeIds)
    const focusNodeIds = nodeIds.filter((id) => findNode(id))
    if (focusNodeIds.length > 0) {
      // 将视口动画适配到选中的节点
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

  /**
   * @description 处理打开创建项目对话框事件
   */
  const handleOpenCreateProjectDialog = () => {
    options.onOpenCreateProjectDialog?.()
  }

  /**
   * @description 处理表头行变更事件
   * @param evt - 自定义事件对象
   */
  const handleHeaderRowChanged = (evt: Event) => {
    options.onHeaderRowChanged?.(evt)
  }

  /**
   * @description 处理数据源预览数据变更事件
   * @param evt - 自定义事件对象
   */
  const handleSourcePreviewDataChanged = (evt: Event) => {
    options.onSourcePreviewDataChanged?.(evt)
  }

  /**
   * @description 处理 Schema 节点保存事件
   * @param evt - 自定义事件对象
   */
  const handleSchemaNodeSave = (evt: Event) => {
    options.onSchemaNodeSave?.(evt)
  }

  /**
   * @description 处理正则模式更新事件
   * @param evt - 自定义事件对象
   */
  const handleRegexPatternUpdated = (evt: Event) => {
    options.onRegexPatternUpdated?.(evt)
  }

  onMounted(() => {
    // 注册来自各节点的跨组件通信自定义事件
    document.addEventListener('headerRowChanged', handleHeaderRowChanged)
    document.addEventListener(
      'sourcePreviewDataChanged',
      handleSourcePreviewDataChanged as unknown as EventListener
    )
    document.addEventListener('schema-node-save', handleSchemaNodeSave)
    document.addEventListener(
      'regex-pattern-updated',
      handleRegexPatternUpdated as unknown as EventListener
    )
    // 注册窗口级事件：节点聚焦和创建项目对话框
    window.addEventListener('focus-canvas-nodes', handleFocusCanvasNodes as EventListener)
    window.addEventListener('open-create-project-dialog', handleOpenCreateProjectDialog)
    // 注册全局键盘快捷键监听
    window.addEventListener('keydown', handleGlobalKeydown)
  })

  onUnmounted(() => {
    // 清理所有注册的事件监听器，防止组件卸载后发生内存泄漏
    document.removeEventListener('headerRowChanged', handleHeaderRowChanged)
    document.removeEventListener(
      'sourcePreviewDataChanged',
      handleSourcePreviewDataChanged as unknown as EventListener
    )
    document.removeEventListener('schema-node-save', handleSchemaNodeSave)
    document.removeEventListener(
      'regex-pattern-updated',
      handleRegexPatternUpdated as unknown as EventListener
    )
    window.removeEventListener('focus-canvas-nodes', handleFocusCanvasNodes as EventListener)
    window.removeEventListener('open-create-project-dialog', handleOpenCreateProjectDialog)
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
