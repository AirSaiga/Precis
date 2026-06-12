/**
 * @file useJsonSchemaResizable.ts
 * @description JSON Schema 节点调整大小逻辑
 *
 * 功能概述:
 * - 拖拽调整宽高
 * - 尺寸状态保存
 * - 响应式尺寸同步
 *
 * 架构设计:
 * - 使用 Vue 响应式系统管理尺寸状态
 * - 通过 useGraphStore 持久化尺寸数据
 * - 支持最小尺寸限制
 */

import { ref, watch, onUnmounted } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import type { JsonSchemaNodeData } from '@/types/nodes'

/**
 * JSON Schema 节点调整大小逻辑
 *
 * @param props - 组件属性，包含 id 和 data
 * @returns 调整大小相关的方法和状态
 */
export function useJsonSchemaResizable(props: { id: string; data: JsonSchemaNodeData }) {
  const store = useGraphStore()

  // 默认尺寸常量
  const MIN_WIDTH = 280
  const MIN_HEIGHT = 200
  const DEFAULT_WIDTH = 460
  const DEFAULT_HEIGHT = 250

  // 响应式尺寸状态
  // 优先使用 props 中的数据，否则使用默认值
  const width = ref(props.data.width || DEFAULT_WIDTH)
  const height = ref<number | undefined>(props.data.height)

  // 是否正在调整大小
  const isResizing = ref(false)

  // 拖拽起始数据
  const dragStart = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }

  /**
   * 开始调整大小
   * @param event - 鼠标事件
   */
  const startResize = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    isResizing.value = true
    dragStart.x = event.clientX
    dragStart.y = event.clientY
    dragStart.width = width.value

    // 如果当前 height 未定义（由内容撑开），则获取当前 DOM 元素的高度作为起始高度
    if (height.value === undefined) {
      const nodeEl = document.querySelector(`[data-node-id="${props.id}"]`) as HTMLElement
      if (nodeEl) {
        dragStart.height = nodeEl.offsetHeight
        height.value = dragStart.height
      } else {
        dragStart.height = MIN_HEIGHT
        height.value = MIN_HEIGHT
      }
    } else {
      dragStart.height = height.value
    }

    // 添加全局事件监听
    window.addEventListener('mousemove', handleResize)
    window.addEventListener('mouseup', endResize)

    // 设置光标样式
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
  }

  /**
   * 处理调整大小
   * @param event - 鼠标事件
   */
  const handleResize = (event: MouseEvent) => {
    if (!isResizing.value) return

    const deltaX = event.clientX - dragStart.x
    const deltaY = event.clientY - dragStart.y

    // 计算新尺寸
    const newWidth = Math.max(MIN_WIDTH, dragStart.width + deltaX)
    const newHeight = Math.max(MIN_HEIGHT, dragStart.height + deltaY)

    width.value = newWidth
    height.value = newHeight
  }

  /**
   * 结束调整大小
   */
  const endResize = () => {
    if (!isResizing.value) return

    isResizing.value = false

    // 移除事件监听
    window.removeEventListener('mousemove', handleResize)
    window.removeEventListener('mouseup', endResize)

    // 恢复光标样式
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // 保存尺寸到节点数据
    saveSize()
  }

  /**
   * 保存尺寸到节点数据
   */
  const saveSize = () => {
    store.updateNodeData(props.id, {
      ...props.data,
      width: width.value,
      height: height.value,
    })
  }

  /**
   * 重置为默认尺寸
   */
  const resetSize = () => {
    width.value = DEFAULT_WIDTH
    height.value = DEFAULT_HEIGHT
    saveSize()
  }

  /**
   * 根据内容自动适应尺寸
   * @param columnsCount - 列数量
   */
  const autoFitSize = (columnsCount: number = 0) => {
    const columnHeight = 36
    const headerHeight = 60
    const padding = 40
    const count = columnsCount || props.data.columns?.length || 0

    const recommendedHeight = headerHeight + count * columnHeight + padding
    height.value = Math.max(DEFAULT_HEIGHT, recommendedHeight)
    saveSize()
  }

  // 监听 props 数据变化，同步更新尺寸（如果是外部变更）
  watch(
    () => props.data.width,
    (newWidth) => {
      if (newWidth && !isResizing.value) {
        width.value = newWidth
      }
    }
  )

  watch(
    () => props.data.height,
    (newHeight) => {
      if (newHeight && !isResizing.value) {
        height.value = newHeight
      }
    }
  )

  // 组件卸载时清理事件监听
  onUnmounted(() => {
    window.removeEventListener('mousemove', handleResize)
    window.removeEventListener('mouseup', endResize)
  })

  return {
    width,
    height,
    isResizing,
    startResize,
    handleResize,
    endResize,
    saveSize,
    resetSize,
    autoFitSize,
  }
}
