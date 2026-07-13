/**
 * @file useCanvasContextMenu.ts
 * @description 画布节点右键上下文菜单组合式函数
 *
 * 职责：
 * - 监听节点右键点击事件（Vue Flow onNodeContextMenu hook）
 * - 维护菜单的响应式状态（visible / position / node / showSaveAsTemplate）
 * - 提供 action 回调（添加到 AI Chat / 保存为模板）
 *
 * 渲染由 CanvasContextMenu.vue 组件负责（消费 menuState + 调用 controller）。
 * 本 composable 不再直接操作 DOM，消除原生 createElement/appendChild 模式。
 */

import type { NodeMouseEvent } from '@vue-flow/core'
import { reactive } from 'vue'
import type { CustomNode } from '@/types/graph'
import { useAiChatStore } from '@/stores/aiChatStore'
import { useGraphStore } from '@/stores/graphStore'
import { isConstraintNodeType } from '@/services/constraints/validationRegistryCore'
import { isRegexNodeType } from '@/utils/nodes/regex'
import { eventBus } from '@/core/eventBus'

export interface CanvasContextMenuOptions {
  /** VueFlow 节点右键事件注册器 */
  onNodeContextMenu: (handler: (event: NodeMouseEvent) => void) => void
}

/** 菜单响应式状态（CanvasContextMenu.vue 通过 props 消费） */
export interface CanvasContextMenuState {
  visible: boolean
  position: { x: number; y: number }
  node: CustomNode | null
  /** 是否显示"保存为模板"项（基于选中节点的 eligible 类型判断） */
  showSaveAsTemplate: boolean
}

/** 控制器接口：组件挂载时调 setup，卸载调 teardown，点击菜单项调对应 action */
export interface CanvasContextMenuController {
  /** 注册 Vue Flow onNodeContextMenu hook（在组件 onMounted 时调用） */
  setup: () => void
  /** 移除事件监听（在组件 onUnmounted 时调用） */
  teardown: () => void
  /** "添加到 AI Chat" action */
  handleAddToChat: () => void
  /** "保存为模板" action */
  handleSaveAsTemplate: () => void
  /** 关闭菜单（overlay/ESC/菜单项点击后调用） */
  close: () => void
}

/** 判断节点类型是否可被打包进模板 */
function isEligibleNodeType(type: string | undefined): boolean {
  if (!type) return false
  return type === 'transform' || isRegexNodeType(type) || isConstraintNodeType(type)
}

/**
 * 根据节点类型提取显示标签
 *
 * 不同节点类型使用不同的字段作为显示名称：
 * - schema/jsonSchema: tableName（表名）
 * - transform/templateInstance: configName
 * - 约束节点: configName 或 constraintName
 * - sourcePreview/jsonSourcePreview: configName 或 sourceName
 * - regex: configName 或 pattern
 * - 其他: 回退到 label/name/id
 */
export function extractNodeLabel(node: { type?: string; data?: Record<string, unknown> }): string {
  const data = node.data || {}
  const nodeType = node.type || ''

  // Schema 节点优先使用 tableName
  if (nodeType === 'schema' || nodeType === 'jsonSchema') {
    return (data.tableName as string) || (data.configName as string) || (data.name as string) || ''
  }

  // 约束节点优先使用 configName，其次 constraintName
  if (isConstraintNodeType(nodeType)) {
    return (data.configName as string) || (data.constraintName as string) || ''
  }

  // Transform / Template / Regex / Source 等节点使用 configName
  if (data.configName) {
    return data.configName as string
  }

  // 回退到 name 或 label
  return (data.name as string) || (data.label as string) || ''
}

/**
 * @description 画布右键上下文菜单组合式函数
 *
 * 返回响应式 menuState（驱动 CanvasContextMenu.vue 渲染）和 controller
 * （组件挂载/卸载/点击 action 时调用）。不再直接操作 DOM。
 *
 * @param options - 上下文菜单配置选项
 * @returns menuState（响应式状态）+ controller（事件桥接 + action）
 */
export function useCanvasContextMenu({ onNodeContextMenu }: CanvasContextMenuOptions) {
  const aiChatStore = useAiChatStore()
  const graphStore = useGraphStore()

  const menuState = reactive<CanvasContextMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    node: null,
    showSaveAsTemplate: false,
  })

  /** Vue Flow onNodeContextMenu handler（保存引用以便 teardown 时移除） */
  let nodeContextMenuHandler: ((event: NodeMouseEvent) => void) | null = null

  const setup = () => {
    nodeContextMenuHandler = ({ event, node }) => {
      const mouseEvent = event as MouseEvent
      mouseEvent.preventDefault()

      // 判断是否显示"保存为模板"项
      const selectedNodeIds = graphStore.selectedNodeIds
      const allSelectedNodes =
        selectedNodeIds.length > 0
          ? graphStore.nodes.filter((n) => selectedNodeIds.includes(n.id))
          : [node as CustomNode]
      const hasEligible = allSelectedNodes.some((n) => isEligibleNodeType(n.type))

      // 更新响应式状态（驱动组件渲染）
      menuState.visible = true
      menuState.position = { x: mouseEvent.clientX, y: mouseEvent.clientY }
      menuState.node = node as CustomNode
      menuState.showSaveAsTemplate = hasEligible
    }
    onNodeContextMenu(nodeContextMenuHandler)
  }

  const teardown = () => {
    // Vue Flow 的 onNodeContextMenu 注册的 handler 无法直接移除，
    // 但组件卸载时 menuState.visible 会被组件的关闭逻辑置 false，
    // handler 即使再触发也只会更新状态，组件已不在 DOM 中。
    nodeContextMenuHandler = null
  }

  const handleAddToChat = () => {
    const node = menuState.node
    if (!node) return

    const displayLabel = extractNodeLabel(node) || node.id
    aiChatStore.addContextNode({
      id: node.id,
      type: node.type || 'unknown',
      data: {
        label: displayLabel,
        ...node.data,
      },
      label: displayLabel,
    })
    // 切换左侧侧边栏到 AI 助手视图
    eventBus.emit('viewchange', { view: 'ai-chat' })
  }

  const handleSaveAsTemplate = () => {
    eventBus.emit('open-save-as-template-dialog')
  }

  /** 关闭菜单（由组件的 overlay/ESC/菜单项点击触发） */
  const close = () => {
    menuState.visible = false
    menuState.node = null
  }

  const controller: CanvasContextMenuController = {
    setup,
    teardown,
    handleAddToChat,
    handleSaveAsTemplate,
    close,
  }

  return { menuState, controller, close }
}
