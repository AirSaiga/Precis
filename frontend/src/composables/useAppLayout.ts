/**
 * @file useAppLayout.ts
 * @description 应用布局状态管理组合式函数
 *
 * 职责：
 * - 管理四栏布局的展开/收起状态
 * - 面板拖拽调宽交互（RAF 批量更新）
 * - 响应式计算各区域样式
 */

import { ref, computed, onUnmounted, type Ref } from 'vue'

const ACTIVITY_BAR_WIDTH = 64
const MIN_SIDEBAR_WIDTH = 150
const MAX_SIDEBAR_WIDTH = 500
const MIN_RIGHT_WIDTH = 200
const MAX_RIGHT_WIDTH = 600

/**
 * 应用布局状态接口
 *
 * 提供四栏布局（ActivityBar / Sidebar / Canvas / RightPanel）的完整状态与交互方法。
 * 所有尺寸相关状态均为 Ref，支持响应式绑定到模板。
 */
export interface AppLayoutState {
  /** ActivityBar（最左侧图标栏）是否收起 */
  activityBarCollapsed: Ref<boolean>
  /** 左侧边栏是否收起 */
  sidebarCollapsed: Ref<boolean>
  /** 右侧面板是否收起 */
  rightCollapsed: Ref<boolean>
  /** 左侧边栏当前宽度（px） */
  sidebarWidth: Ref<number>
  /** 右侧面板当前宽度（px） */
  rightWidth: Ref<number>
  /** 是否正在拖拽左侧边栏调宽 */
  isDraggingSidebar: Ref<boolean>
  /** 是否正在拖拽右侧面板调宽 */
  isDraggingRight: Ref<boolean>
  /** 布局过渡动画是否禁用（拖拽或 AI 面板切换时禁用，避免视觉抖动） */
  isLayoutTransitionDisabled: Ref<boolean>
  /** 画布区域 flex 样式（动态计算剩余宽度） */
  canvasStyle: Ref<{ flex: string }>
  /** 左侧折叠切换按钮的 left 定位 */
  leftToggleStyle: Ref<{ left: string }>
  /** 右侧折叠切换按钮的 right 定位 */
  rightToggleStyle: Ref<{ right: string }>
  /** 右侧面板宽度样式 */
  rightPanelStyle: Ref<{ width: string }>
  /** AI 聊天浮动按钮的 left 定位 */
  aiChatFabStyle: Ref<{ left: string }>
  /** 切换左侧边栏展开/收起 */
  toggleSidebar: () => void
  /** 切换右侧面板展开/收起 */
  toggleRightPanel: () => void
  /** 鼠标按下开始拖拽（sidebar 或 right） */
  handleMouseDown: (type: 'sidebar' | 'right', event: MouseEvent) => void
  /** 鼠标移动更新待处理宽度（配合 RAF 批量刷新） */
  handleMouseMove: (evt: MouseEvent) => void
  /** 鼠标抬起结束拖拽，清理事件监听 */
  handleMouseUp: () => void
  /** 窗口大小变化时更新视口宽度 */
  handleResize: () => void
}

export function useAppLayout(): AppLayoutState {
  // === 面板折叠状态 ===
  const activityBarCollapsed = ref(false)
  const sidebarCollapsed = ref(false)
  const rightCollapsed = ref(false)

  // === 面板宽度状态 ===
  const sidebarWidth = ref(260)
  const rightWidth = ref(280)

  // === 拖拽与过渡状态 ===
  const isDraggingSidebar = ref(false)
  const isDraggingRight = ref(false)
  // 当前视口宽度，用于计算右侧面板拖拽边界
  const viewportWidth = ref(window.innerWidth)

  // === RAF 批量更新机制 ===
  // 拖拽过程中不直接修改 ref，而是先缓存到 pending 变量，
  // 在 requestAnimationFrame 中统一刷新，避免高频 DOM 更新导致卡顿
  let rafId: number | null = null
  let pendingSidebarWidth: number | null = null
  let pendingRightWidth: number | null = null

  const isLayoutTransitionDisabled = computed(
    () => isDraggingSidebar.value || isDraggingRight.value
  )

  const leftToggleStyle = computed(() => ({
    left:
      (activityBarCollapsed.value ? 0 : ACTIVITY_BAR_WIDTH) +
      (sidebarCollapsed.value ? 0 : sidebarWidth.value) +
      'px',
  }))

  const rightToggleStyle = computed(() => ({
    right: rightCollapsed.value ? '0px' : rightWidth.value + 'px',
  }))

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
    const totalSideWidth = leftWidth + rightWidthCalc
    return {
      flex: `0 0 calc(100vw - ${totalSideWidth}px)`,
    }
  })

  /**
   * 切换左侧边栏展开/收起状态
   */
  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /**
   * 切换右侧面板展开/收起状态
   */
  const toggleRightPanel = () => {
    rightCollapsed.value = !rightCollapsed.value
  }

  /**
   * 窗口大小变化时更新视口宽度
   *
   * 用于右侧面板拖拽时计算边界，避免窗口缩放后拖拽位置异常。
   */
  const handleResize = () => {
    viewportWidth.value = window.innerWidth
  }

  /**
   * 将 pending 中缓存的宽度变更批量刷新到响应式状态
   *
   * 由 requestAnimationFrame 回调触发，确保每帧最多一次 DOM 更新。
   */
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

  /**
   * 鼠标按下开始拖拽调宽
   *
   * 设置拖拽标志、绑定全局 mousemove/mouseup 事件、禁用文本选择。
   *
   * @param type - 拖拽目标：'sidebar' 左侧边栏 或 'right' 右侧面板
   * @param event - 鼠标事件，调用 preventDefault 防止选中文本
   */
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

  /**
   * 鼠标移动更新待处理宽度
   *
   * 根据鼠标位置计算新宽度，校验边界后写入 pending 变量。
   * 如果 RAF 未调度，则请求下一帧统一刷新。
   *
   * @param evt - 鼠标事件
   */
  const handleMouseMove = (evt: MouseEvent) => {
    if (isDraggingSidebar.value && !sidebarCollapsed.value) {
      const newWidth = evt.clientX - ACTIVITY_BAR_WIDTH
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        pendingSidebarWidth = newWidth
      }
    } else if (isDraggingRight.value && !rightCollapsed.value) {
      const newRightWidth = viewportWidth.value - evt.clientX
      if (newRightWidth >= MIN_RIGHT_WIDTH && newRightWidth <= MAX_RIGHT_WIDTH) {
        pendingRightWidth = newRightWidth
      }
    }

    if (!rafId && (pendingSidebarWidth !== null || pendingRightWidth !== null)) {
      rafId = requestAnimationFrame(flushPendingUpdates)
    }
  }

  /**
   * 鼠标抬起结束拖拽
   *
   * 重置拖拽标志、取消 RAF、强制刷新 pending 更新、移除全局事件监听、恢复样式。
   */
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

  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  })

  return {
    // --- 折叠状态 ---
    activityBarCollapsed,
    sidebarCollapsed,
    rightCollapsed,

    // --- 宽度与拖拽状态 ---
    sidebarWidth,
    rightWidth,
    isDraggingSidebar,
    isDraggingRight,

    // --- 样式计算（computed） ---
    isLayoutTransitionDisabled,
    canvasStyle,
    leftToggleStyle,
    rightToggleStyle,
    rightPanelStyle,
    aiChatFabStyle,

    // --- 交互方法 ---
    toggleSidebar,
    toggleRightPanel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleResize,
  }
}
