/**
 * @file useAppLayout.ts
 * @description 应用布局状态管理组合式函数
 *
 * 职责：
 * - 管理四栏布局的展开/收起状态
 * - 面板拖拽调宽交互（RAF 批量更新）
 * - 响应式计算各区域样式
 * - 监听 AI 面板变化，同步布局
 */

import { ref, computed, watch, type Ref } from 'vue'
import { useAiChatStore } from '@/stores/aiChatStore'

const ACTIVITY_BAR_WIDTH = 64
const AI_CHAT_DRAWER_WIDTH = 400
const MIN_SIDEBAR_WIDTH = 150
const MAX_SIDEBAR_WIDTH = 500
const MIN_RIGHT_WIDTH = 200
const MAX_RIGHT_WIDTH = 600

export interface AppLayoutState {
  activityBarCollapsed: Ref<boolean>
  sidebarCollapsed: Ref<boolean>
  rightCollapsed: Ref<boolean>
  sidebarWidth: Ref<number>
  rightWidth: Ref<number>
  isDraggingSidebar: Ref<boolean>
  isDraggingRight: Ref<boolean>
  isLayoutTransitionDisabled: Ref<boolean>
  canvasStyle: Ref<{ flex: string }>
  leftToggleStyle: Ref<{ left: string }>
  rightToggleStyle: Ref<{ right: string }>
  rightPanelStyle: Ref<{ width: string }>
  aiChatFabStyle: Ref<{ left: string }>
  toggleSidebar: () => void
  toggleRightPanel: () => void
  handleMouseDown: (type: 'sidebar' | 'right', event: MouseEvent) => void
  handleMouseMove: (evt: MouseEvent) => void
  handleMouseUp: () => void
  handleResize: () => void
}

export function useAppLayout(): AppLayoutState {
  const aiChatStore = useAiChatStore()

  const activityBarCollapsed = ref(false)
  const sidebarCollapsed = ref(false)
  const rightCollapsed = ref(false)

  const sidebarWidth = ref(260)
  const rightWidth = ref(280)

  const isDraggingSidebar = ref(false)
  const isDraggingRight = ref(false)
  const isAiPanelToggling = ref(false)
  const viewportWidth = ref(window.innerWidth)

  // 用于优化拖拽性能的 RAF
  let rafId: number | null = null
  let pendingSidebarWidth: number | null = null
  let pendingRightWidth: number | null = null

  const isLayoutTransitionDisabled = computed(
    () => isDraggingSidebar.value || isDraggingRight.value || isAiPanelToggling.value
  )

  // 监听 AI 面板展开/收起，临时禁用过渡动画确保 toggle 按钮位置同步
  watch(
    () => aiChatStore.drawerVisible,
    () => {
      isAiPanelToggling.value = true
      requestAnimationFrame(() => {
        isAiPanelToggling.value = false
      })
    }
  )

  const leftToggleStyle = computed(() => ({
    left:
      (activityBarCollapsed.value ? 0 : ACTIVITY_BAR_WIDTH) +
      (sidebarCollapsed.value ? 0 : sidebarWidth.value) +
      'px',
  }))

  const rightToggleStyle = computed(() => {
    const aiChatWidth = aiChatStore.drawerVisible ? AI_CHAT_DRAWER_WIDTH : 0
    return {
      right: rightCollapsed.value ? aiChatWidth + 'px' : rightWidth.value + aiChatWidth + 'px',
    }
  })

  const rightPanelStyle = computed(() => ({
    width: rightCollapsed.value ? '0px' : rightWidth.value + 'px',
  }))

  const aiChatFabStyle = computed(() => {
    const leftWidth =
      (activityBarCollapsed.value ? 0 : ACTIVITY_BAR_WIDTH) +
      (sidebarCollapsed.value ? 0 : sidebarWidth.value)
    return {
      left: 60 + leftWidth + 'px',
    }
  })

  const canvasStyle = computed(() => {
    const leftWidth =
      (activityBarCollapsed.value ? 0 : ACTIVITY_BAR_WIDTH) +
      (sidebarCollapsed.value ? 0 : sidebarWidth.value)
    const rightWidthCalc = rightCollapsed.value ? 0 : rightWidth.value
    const aiChatWidth = aiChatStore.drawerVisible ? AI_CHAT_DRAWER_WIDTH : 0
    const totalSideWidth = leftWidth + rightWidthCalc + aiChatWidth
    return {
      flex: `0 0 calc(100vw - ${totalSideWidth}px)`,
    }
  })

  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  const toggleRightPanel = () => {
    rightCollapsed.value = !rightCollapsed.value
  }

  const handleResize = () => {
    viewportWidth.value = window.innerWidth
  }

  const flushPendingUpdates = () => {
    if (pendingSidebarWidth !== null) {
      sidebarWidth.value = pendingSidebarWidth
      pendingSidebarWidth = null
    }
    if (pendingRightWidth !== null) {
      rightWidth.value = pendingRightWidth
      pendingRightWidth = null
    }
    rafId = null
  }

  const handleMouseDown = (type: 'sidebar' | 'right', event: MouseEvent) => {
    event.preventDefault()
    if (type === 'sidebar') {
      isDraggingSidebar.value = true
    } else {
      isDraggingRight.value = true
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleMouseMove = (evt: MouseEvent) => {
    if (isDraggingSidebar.value && !sidebarCollapsed.value) {
      const newWidth = evt.clientX - ACTIVITY_BAR_WIDTH
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        pendingSidebarWidth = newWidth
      }
    } else if (isDraggingRight.value && !rightCollapsed.value) {
      const aiChatWidth = aiChatStore.drawerVisible ? AI_CHAT_DRAWER_WIDTH : 0
      const newRightWidth = viewportWidth.value - evt.clientX - aiChatWidth
      if (newRightWidth >= MIN_RIGHT_WIDTH && newRightWidth <= MAX_RIGHT_WIDTH) {
        pendingRightWidth = newRightWidth
      }
    }

    if (!rafId && (pendingSidebarWidth !== null || pendingRightWidth !== null)) {
      rafId = requestAnimationFrame(flushPendingUpdates)
    }
  }

  const handleMouseUp = () => {
    isDraggingSidebar.value = false
    isDraggingRight.value = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      flushPendingUpdates()
    }
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return {
    activityBarCollapsed,
    sidebarCollapsed,
    rightCollapsed,
    sidebarWidth,
    rightWidth,
    isDraggingSidebar,
    isDraggingRight,
    isLayoutTransitionDisabled,
    canvasStyle,
    leftToggleStyle,
    rightToggleStyle,
    rightPanelStyle,
    aiChatFabStyle,
    toggleSidebar,
    toggleRightPanel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleResize,
  }
}
