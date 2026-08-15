/**
 * @file useResourceInteraction.ts
 * @description 资源交互组合式函数
 *
 * 功能职责：
 * - 长按计时器管理（进入多选模式）
 * - 资源点击/拖拽交互事件封装
 * - 与 useResourceTree 的多选状态协同
 */

import { useResourceTree } from '@/composables/resource'
import type { ResourceItem } from '@/types/resource'

export function useResourceInteraction() {
  const { hasSelection, isMultiSelectMode, toggleSelect, enterMultiSelectMode } = useResourceTree()

  const LONG_PRESS_DURATION = 500
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let pendingResource: ResourceItem | null = null
  /**
   * 刚完成长按的资源 ID：长按选中后浏览器仍会补发一次 click，
   * handleResourceClick 若不跳过会把刚选中的资源再 toggle 一次（立即取消选择），
   * 导致多选模式永远无法保持——长按进入多选实际不可用的根因。
   */
  let lastLongPressResourceId: string | null = null

  /**
   * 处理资源鼠标按下（启动长按计时器）
   */
  const handleResourceMouseDown = (resource: ResourceItem): void => {
    lastLongPressResourceId = null
    pendingResource = resource
    longPressTimer = setTimeout(() => {
      if (pendingResource) {
        if (!isMultiSelectMode.value) {
          enterMultiSelectMode()
        }
        toggleSelect(pendingResource)
        lastLongPressResourceId = pendingResource.id
        pendingResource = null
      }
    }, LONG_PRESS_DURATION)
  }

  /**
   * 处理资源鼠标抬起（清除计时器）
   */
  const handleResourceMouseUp = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    pendingResource = null
  }

  /**
   * 处理资源鼠标离开（清除计时器）
   */
  const handleResourceMouseLeave = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    pendingResource = null
  }

  /**
   * 清除长按计时器
   */
  const clearLongPressTimer = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    pendingResource = null
  }

  /**
   * 处理资源点击
   * @param resource 被点击的资源
   * @param event 鼠标事件
   * @param options 可选回调
   */
  const handleResourceClick = (
    resource: ResourceItem,
    event: MouseEvent,
    options?: { onToggleExpand?: () => void }
  ): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }

    // 长按刚完成的补发 click：吞掉，避免把长按选中的资源立即反选
    if (lastLongPressResourceId === resource.id) {
      lastLongPressResourceId = null
      return
    }

    if (hasSelection.value) {
      toggleSelect(resource)
    } else {
      // 只有非多选模式下，Schema 点击才触发展开
      if (resource.kind === 'schema' && options?.onToggleExpand) {
        options.onToggleExpand()
      }
      // 其他资源类型点击不做任何操作
    }
  }

  return {
    handleResourceMouseDown,
    handleResourceMouseUp,
    handleResourceMouseLeave,
    clearLongPressTimer,
    handleResourceClick,
  }
}
