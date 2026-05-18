/**
 * @file useCanvasContextMenu.ts
 * @description 画布节点右键上下文菜单组合式函数
 *
 * 职责：
 * - 监听节点右键点击事件
 * - 创建并管理原生 DOM 上下文菜单
 * - 将选中节点添加到 AI Chat 上下文
 */

import type { NodeMouseEvent } from '@vue-flow/core'
import { useAiChatStore } from '@/stores/aiChatStore'

export interface CanvasContextMenuOptions {
  /** VueFlow 节点右键事件注册器 */
  onNodeContextMenu: (handler: (event: NodeMouseEvent) => void) => void
  /** i18n 翻译函数 */
  t: (key: string) => string
}

/**
 * @description 画布右键上下文菜单组合式函数
 * @param options - 上下文菜单配置选项
 * @returns setupContextMenu 菜单初始化函数和 onPaneContextMenu 画布右键处理器
 */
export function useCanvasContextMenu({ onNodeContextMenu, t }: CanvasContextMenuOptions) {
  const aiChatStore = useAiChatStore()

  /**
   * @description 设置节点右键上下文菜单
   * @description 注册节点右键事件，创建原生 DOM 菜单并提供"添加到 AI Chat"功能
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
        // 提取节点数据，优先使用 label 或 name 作为显示文本
        const nodeData = node.data || {}
        aiChatStore.addContextNode({
          id: node.id,
          type: node.type || 'unknown',
          data: {
            label: (nodeData.label as string) || (nodeData.name as string) || node.id,
            ...nodeData,
          },
          label: (nodeData.label as string) || (nodeData.name as string) || node.id,
        })
        // 打开 AI Chat 侧边栏
        aiChatStore.openDrawer()
        // 点击后移除上下文菜单
        if (contextMenu.parentNode === document.body) {
          document.body.removeChild(contextMenu)
        }
      }

      contextMenu.appendChild(addToChatItem)

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
