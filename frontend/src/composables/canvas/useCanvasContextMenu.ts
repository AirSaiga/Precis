/**
 * @file useCanvasContextMenu.ts
 * @description 画布节点右键上下文菜单组合式函数
 *
 * 职责：
 * - 监听节点右键点击事件
 * - 创建并管理原生 DOM 上下文菜单
 * - 将选中节点添加到 AI Chat 上下文
 * - 将选中节点打包为模板定义
 */

import type { NodeMouseEvent } from '@vue-flow/core'
import { useAiChatStore } from '@/stores/aiChatStore'
import { useGraphStore } from '@/stores/graphStore'
import { isConstraintNodeType } from '@/services/constraints/validationRegistryCore'

export interface CanvasContextMenuOptions {
  /** VueFlow 节点右键事件注册器 */
  onNodeContextMenu: (handler: (event: NodeMouseEvent) => void) => void
  /** i18n 翻译函数 */
  t: (key: string) => string
}

/** 判断节点类型是否可被打包进模板 */
function isEligibleNodeType(type: string | undefined): boolean {
  if (!type) return false
  return type === 'transform' || type === 'regex' || isConstraintNodeType(type)
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
function extractNodeLabel(node: { type?: string; data?: Record<string, unknown> }): string {
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
 * @param options - 上下文菜单配置选项
 * @returns setupContextMenu 菜单初始化函数和 onPaneContextMenu 画布右键处理器
 */
export function useCanvasContextMenu({ onNodeContextMenu, t }: CanvasContextMenuOptions) {
  const aiChatStore = useAiChatStore()
  const graphStore = useGraphStore()

  /**
   * @description 设置节点右键上下文菜单
   * @description 注册节点右键事件，创建原生 DOM 菜单并提供"添加到 AI Chat"和"保存为模板"功能
   */
  const setupContextMenu = () => {
    onNodeContextMenu(({ event, node }) => {
      const mouseEvent = event as MouseEvent
      // 阻止浏览器默认右键菜单弹出
      mouseEvent.preventDefault()

      // 如果页面上已存在上下文菜单，先移除旧的
      const existingMenu = document.querySelector('.canvas-context-menu')
      if (existingMenu) {
        existingMenu.remove()
      }

      // 创建自定义上下文菜单容器
      const contextMenu = document.createElement('div')
      contextMenu.className = 'canvas-context-menu'
      contextMenu.style.position = 'fixed'
      contextMenu.style.left = mouseEvent.clientX + 'px'
      contextMenu.style.top = mouseEvent.clientY + 'px'
      contextMenu.style.zIndex = '10000'

      // 创建"添加到 AI Chat"菜单项按钮
      const addToChatItem = document.createElement('button')
      addToChatItem.className = 'context-menu-item'
      addToChatItem.textContent = '\u2728 ' + t('aiChat.addToChat')
      addToChatItem.onclick = () => {
        // 提取节点显示标签（如表名、配置名等）
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
        window.dispatchEvent(new CustomEvent('viewchange', { detail: { view: 'ai-chat' } }))
        // 点击后移除上下文菜单
        if (contextMenu.parentNode === document.body) {
          document.body.removeChild(contextMenu)
        }
      }

      contextMenu.appendChild(addToChatItem)

      // 判断是否显示"保存为模板"菜单项
      // 条件：当前选中的节点中有至少一个 eligible 类型
      const selectedNodeIds = graphStore.selectedNodeIds
      const allSelectedNodes =
        selectedNodeIds.length > 0
          ? graphStore.nodes.filter((n) => selectedNodeIds.includes(n.id))
          : [node]
      const hasEligible = allSelectedNodes.some((n) => isEligibleNodeType(n.type))

      if (hasEligible) {
        // 分隔线
        const separator = document.createElement('div')
        separator.className = 'context-menu-separator'
        contextMenu.appendChild(separator)

        // 创建"保存为模板"菜单项
        const saveAsTemplateItem = document.createElement('button')
        saveAsTemplateItem.className = 'context-menu-item'
        saveAsTemplateItem.textContent = '\uD83D\uDCE6 ' + t('template.saveAsTemplate')
        saveAsTemplateItem.onclick = () => {
          window.dispatchEvent(new CustomEvent('open-save-as-template-dialog'))
          if (contextMenu.parentNode === document.body) {
            document.body.removeChild(contextMenu)
          }
        }
        contextMenu.appendChild(saveAsTemplateItem)
      }

      // 定义点击菜单外部时关闭菜单的处理器
      const closeMenu = (e: MouseEvent) => {
        if (!contextMenu.contains(e.target as Node)) {
          if (contextMenu.parentNode === document.body) {
            document.body.removeChild(contextMenu)
          }
          // 清理事件监听，防止内存泄漏
          document.removeEventListener('click', closeMenu)
        }
      }

      // 将菜单挂载到页面并延迟注册点击关闭事件
      document.body.appendChild(contextMenu)
      setTimeout(() => {
        document.addEventListener('click', closeMenu)
      }, 0)
    })
  }

  /**
   * @description 处理画布空白处右键事件
   * @param event - 包含 MouseEvent 的事件对象
   */
  const onPaneContextMenu = (event: { event: MouseEvent }) => {
    // 阻止浏览器默认右键菜单在画布空白处弹出
    event.event.preventDefault()
  }

  return { setupContextMenu, onPaneContextMenu }
}
