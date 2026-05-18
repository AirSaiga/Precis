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

// 拖拽状态接口定义
interface DragState {
  isDragging: boolean
  dragPayload: DragEventPayload | null
  hoverNode: unknown
  hoverColumn: unknown
}

// 拖拽事件类型定义
export interface DragEventPayload {
  type: string
  sourceNodeId: string
  sourceNodeName?: string
  fieldName: string
  fieldIndex?: number
  localPath?: string
  sourceType?: string
}

/**
 * 全局拖拽状态管理Store
 * 统一管理应用中的拖拽状态，确保状态一致性
 */
export const useDragStore = defineStore('drag', () => {
  // 本地拖拽状态
  const localDragState = ref<DragState>({
    isDragging: false,
    dragPayload: null,
    hoverNode: null,
    hoverColumn: null,
  })

  // 计算属性：获取当前拖拽状态
  const dragState = computed(() => localDragState.value)

  // 计算属性：是否正在拖拽
  const isDragging = computed(() => localDragState.value.isDragging)

  // 计算属性：获取拖拽数据
  const dragPayload = computed(() => localDragState.value.dragPayload)

  /**
   * 开始拖拽
   * @param payload 拖拽数据
   */
  const startDrag = (payload: DragEventPayload) => {
    logger.debug('🔄 拖拽状态管理：开始拖拽', payload)
    localDragState.value.isDragging = true
    localDragState.value.dragPayload = payload

    // 触发document事件，确保跨组件通信
    const dragStartEvent = new CustomEvent('fielddragstart', {
      detail: payload,
    })
    document.dispatchEvent(dragStartEvent)
  }

  /**
   * 结束拖拽
   */
  const endDrag = () => {
    logger.debug('🔄 拖拽状态管理：结束拖拽')
    localDragState.value.isDragging = false
    localDragState.value.dragPayload = null
    localDragState.value.hoverNode = null
    localDragState.value.hoverColumn = null

    // 触发document事件，确保跨组件通信
    const dragEndEvent = new CustomEvent('fielddragend')
    document.dispatchEvent(dragEndEvent)
  }

  /**
   * 设置悬停节点
   * @param node 悬停的节点
   */
  const setHoverNode = (node: unknown) => {
    localDragState.value.hoverNode = node
  }

  /**
   * 设置悬停列
   * @param column 悬停的列
   */
  const setHoverColumn = (column: unknown) => {
    localDragState.value.hoverColumn = column
  }

  /**
   * 清除悬停状态
   */
  const clearHover = () => {
    localDragState.value.hoverNode = null
    localDragState.value.hoverColumn = null
  }

  /**
   * 重置拖拽状态
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
   * 设置document事件监听器
   */
  const initializeDragState = () => {
    // 监听字段拖拽开始事件
    const handleFieldDragStart = (event: Event) => {
      const customEvent = event as CustomEvent
      logger.debug('🔄 拖拽状态管理：收到字段拖拽开始事件', customEvent.detail)
      localDragState.value.isDragging = true
      localDragState.value.dragPayload = customEvent.detail
    }

    // 监听字段拖拽结束事件
    const handleFieldDragEnd = () => {
      logger.debug('🔄 拖拽状态管理：收到字段拖拽结束事件')
      localDragState.value.isDragging = false
      localDragState.value.dragPayload = null
      localDragState.value.hoverNode = null
      localDragState.value.hoverColumn = null
    }

    // 添加事件监听器
    document.addEventListener('fielddragstart', handleFieldDragStart)
    document.addEventListener('fielddragend', handleFieldDragEnd)

    // 返回清理函数
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
