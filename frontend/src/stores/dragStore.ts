/**
 * @file dragStore.ts
 * @description 全局拖拽状态管理 Store
 *
 * 统一管理应用中的字段拖拽交互状态，包括拖拽开始/结束、
 * 悬停目标跟踪以及跨组件拖拽通信。
 *
 * 核心功能：
 * - startDrag / endDrag: 控制拖拽生命周期
 * - setHoverNode / setHoverColumn: 跟踪悬停目标
 * - initializeDragState: 初始化全局 document 事件监听，实现跨组件通信
 *
 * 数据流：
 * 用户拖拽字段 → startDrag → CustomEvent('fielddragstart') → 其他组件响应
 * 拖拽结束 → endDrag → CustomEvent('fielddragend') → 状态重置
 *
 * 设计要点：
 * - 使用 Pinia Composition API 模式
 * - 通过 CustomEvent 实现跨组件、跨 Store 的拖拽状态同步
 */

import { logger } from '@/core/utils/logger'
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

/**
 * 拖拽内部状态接口
 *
 * 描述当前拖拽交互的完整状态，包括是否正在拖拽、
 * 拖拽载荷数据以及当前悬停的目标信息。
 */
interface DragState {
  /** 是否正在拖拽中 */
  isDragging: boolean
  /** 当前拖拽携带的数据载荷 */
  dragPayload: DragEventPayload | null
  /** 当前悬停的节点（画布节点或 DOM 元素） */
  hoverNode: unknown
  /** 当前悬停的列（表格列或字段） */
  hoverColumn: unknown
}

/**
 * 字段拖拽事件载荷
 *
 * 当用户从数据源面板或节点端口拖拽字段时，
 * 通过此数据结构传递字段的元信息。
 */
export interface DragEventPayload {
  /** 拖拽类型标识（如 'field'） */
  type: string
  /** 来源节点 ID（拖拽发起的节点） */
  sourceNodeId: string
  /** 来源节点显示名称 */
  sourceNodeName?: string
  /** 被拖拽的字段名称 */
  fieldName: string
  /** 字段在列表中的索引 */
  fieldIndex?: number
  /** 关联的本地文件路径 */
  localPath?: string
  /** 来源类型（如 'schema'、'sourcePreview'） */
  sourceType?: string
}

/**
 * 全局拖拽状态管理 Store
 *
 * 统一管理应用中的字段拖拽交互状态，确保跨组件拖拽通信的一致性。
 * 使用 Pinia Composition API 模式，通过 CustomEvent 实现与外部组件的双向同步。
 */
export const useDragStore = defineStore('drag', () => {
  // --- State ---

  /** 本地拖拽状态，包含拖拽生命周期和悬停信息 */
  const localDragState = ref<DragState>({
    isDragging: false,
    dragPayload: null,
    hoverNode: null,
    hoverColumn: null,
  })

  // --- Getters ---

  /** 当前完整的拖拽状态对象（用于调试或批量读取） */
  const dragState = computed(() => localDragState.value)

  /** 是否正在拖拽中，用于 UI 层显示拖拽指示器 */
  const isDragging = computed(() => localDragState.value.isDragging)

  /** 当前拖拽的数据载荷，用于 drop 目标判断可接受性 */
  const dragPayload = computed(() => localDragState.value.dragPayload)

  // --- Actions ---

  /**
   * 开始拖拽
   *
   * 设置拖拽状态为活跃，保存拖拽载荷，
   * 并通过 CustomEvent 向全局广播拖拽开始事件，实现跨组件通信。
   *
   * @param payload - 拖拽数据载荷，包含字段和来源信息
   */
  const startDrag = (payload: DragEventPayload) => {
    logger.debug('🔄 拖拽状态管理：开始拖拽', payload)
    localDragState.value.isDragging = true
    localDragState.value.dragPayload = payload

    // 通过 CustomEvent 向 document 广播，使未使用 Pinia 的组件也能响应拖拽状态
    const dragStartEvent = new CustomEvent('fielddragstart', {
      detail: payload,
    })
    document.dispatchEvent(dragStartEvent)
  }

  /**
   * 结束拖拽
   *
   * 重置所有拖拽状态（包括悬停信息），
   * 并通过 CustomEvent 广播拖拽结束事件，通知所有监听组件清理状态。
   */
  const endDrag = () => {
    logger.debug('🔄 拖拽状态管理：结束拖拽')
    localDragState.value.isDragging = false
    localDragState.value.dragPayload = null
    localDragState.value.hoverNode = null
    localDragState.value.hoverColumn = null

    // 广播拖拽结束事件，确保所有组件同步清理拖拽相关 UI 状态
    const dragEndEvent = new CustomEvent('fielddragend')
    document.dispatchEvent(dragEndEvent)
  }

  /**
   * 设置悬停节点
   *
   * 当拖拽字段经过某个节点时调用，用于高亮显示可放置目标。
   *
   * @param node - 悬停的节点对象或 DOM 元素
   */
  const setHoverNode = (node: unknown) => {
    localDragState.value.hoverNode = node
  }

  /**
   * 设置悬停列
   *
   * 当拖拽字段经过表格或列表的某列时调用，用于显示列级放置指示。
   *
   * @param column - 悬停的列标识或列对象
   */
  const setHoverColumn = (column: unknown) => {
    localDragState.value.hoverColumn = column
  }

  /**
   * 清除悬停状态
   *
   * 当拖拽字段离开悬停目标时调用，移除高亮和放置指示。
   */
  const clearHover = () => {
    localDragState.value.hoverNode = null
    localDragState.value.hoverColumn = null
  }

  /**
   * 重置拖拽状态
   *
   * 强制将所有拖拽相关状态恢复为初始值，
   * 用于异常恢复或强制取消拖拽的场景。
   */
  const resetDragState = () => {
    localDragState.value = {
      isDragging: false,
      dragPayload: null,
      hoverNode: null,
      hoverColumn: null,
    }
  }

  /**
   * 初始化拖拽状态管理
   *
   * 在应用启动时调用一次，设置全局 document 事件监听器，
   * 接收来自其他组件（未使用 Pinia）的拖拽事件，保持状态同步。
   *
   * @returns 清理函数，用于组件卸载时移除事件监听器
   */
  const initializeDragState = () => {
    // 监听来自其他组件的字段拖拽开始事件（通过 CustomEvent 广播）
    const handleFieldDragStart = (event: Event) => {
      const customEvent = event as CustomEvent
      logger.debug('🔄 拖拽状态管理：收到字段拖拽开始事件', customEvent.detail)
      // 同步外部组件的拖拽状态到本 store
      localDragState.value.isDragging = true
      localDragState.value.dragPayload = customEvent.detail
    }

    // 监听来自其他组件的字段拖拽结束事件
    const handleFieldDragEnd = () => {
      logger.debug('🔄 拖拽状态管理：收到字段拖拽结束事件')
      localDragState.value.isDragging = false
      localDragState.value.dragPayload = null
      localDragState.value.hoverNode = null
      localDragState.value.hoverColumn = null
    }

    // 注册全局事件监听器
    document.addEventListener('fielddragstart', handleFieldDragStart)
    document.addEventListener('fielddragend', handleFieldDragEnd)

    // 返回清理函数，供调用方在组件卸载时调用，防止内存泄漏
    return () => {
      document.removeEventListener('fielddragstart', handleFieldDragStart)
      document.removeEventListener('fielddragend', handleFieldDragEnd)
    }
  }

  return {
    // 状态
    dragState,
    isDragging,
    dragPayload,

    // 方法
    startDrag,
    endDrag,
    setHoverNode,
    setHoverColumn,
    clearHover,
    resetDragState,
    initializeDragState,
  }
})
