/**
 * @file useResourceInteraction.ts
 * @description 资源交互组合式函数
 *
 * 功能职责：
 * - 长按计时器管理（进入多选模式）
 * - 资源点击/拖拽交互事件封装
 * - 与 useResourceTree 的多选状态协同
 *
 * 手势模型（拖拽与多选互不抢占）：
 * - 长按（按住 ~500ms 且指针基本未移动）→ 进入多选并选中该条目；
 * - 拖拽意图（按住后指针位移超过阈值，或 dragstart 触发）→ 取消长按计时，
 *   保证"想拖拽"永远不会被误判为"想多选"；
 * - 多选模式不拦截 dragstart，拖拽链路始终可用。
 */

import { onScopeDispose } from 'vue'

import { useResourceTree } from '@/composables/resource'
import type { ResourceItem } from '@/types/resource'

/** 判定指针是否已构成拖拽意图的位移阈值（px），与常见浏览器 dragstart 触发距离相当 */
export const DRAG_MOVE_THRESHOLD_PX = 6

/**
 * 判断指针位移是否超过拖拽意图阈值（纯函数，便于单元测试）。
 * @returns true 表示位移已超过阈值，应视为拖拽手势
 */
export function hasExceededMoveThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = DRAG_MOVE_THRESHOLD_PX
): boolean {
  const dx = x - startX
  const dy = y - startY
  return Math.hypot(dx, dy) > threshold
}

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
  /** 指针起点（clientX/Y），用于位移阈值判定；null 表示未在追踪 */
  let pointerOrigin: { x: number; y: number } | null = null
  /** document mousemove 监听移除函数（一次性追踪，手势结束即移除） */
  let detachMoveListener: (() => void) | null = null

  /** 停止指针移动追踪（幂等，可安全重复调用） */
  function stopMoveTracking(): void {
    if (detachMoveListener) {
      detachMoveListener()
      detachMoveListener = null
    }
    pointerOrigin = null
  }

  /** 清除长按计时器与移动追踪 */
  function clearLongPressTimer(): void {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    pendingResource = null
    stopMoveTracking()
  }

  /** 长按到期：进入多选并选中当前条目（仅在指针未构成拖拽意图时到达这里） */
  function fireLongPress(): void {
    longPressTimer = null
    if (pendingResource) {
      if (!isMultiSelectMode.value) {
        enterMultiSelectMode()
      }
      toggleSelect(pendingResource)
      lastLongPressResourceId = pendingResource.id
      pendingResource = null
    }
    stopMoveTracking()
  }

  /**
   * 处理资源鼠标按下（启动长按计时器 + 指针移动追踪）
   *
   * 移动追踪说明：浏览器在按住拖动 draggable 元素时会先触发 dragstart，
   * 但在手势建立前（按下未动/微动）不会派发任何事件；此处通过 document 级
   * mousemove 监听位移，超过阈值即视为拖拽意图、取消长按——
   * 修复"按住条目缓慢拖动时 500ms 长按先触发、多选抢占拖拽"的缺陷。
   */
  function handleResourceMouseDown(resource: ResourceItem, event?: MouseEvent): void {
    lastLongPressResourceId = null
    // 防御：上一手势未正常收尾时先复位，避免残留计时器/监听
    clearLongPressTimer()
    pendingResource = resource

    pointerOrigin = event ? { x: event.clientX, y: event.clientY } : null
    if (pointerOrigin) {
      const origin = pointerOrigin
      const onMove = (e: MouseEvent): void => {
        if (!origin) return
        if (hasExceededMoveThreshold(origin.x, origin.y, e.clientX, e.clientY)) {
          clearLongPressTimer()
        }
      }
      document.addEventListener('mousemove', onMove)
      detachMoveListener = () => document.removeEventListener('mousemove', onMove)
    }

    longPressTimer = setTimeout(fireLongPress, LONG_PRESS_DURATION)
  }

  /**
   * 处理资源鼠标抬起（清除计时器）
   */
  function handleResourceMouseUp(): void {
    clearLongPressTimer()
  }

  // 卸载兜底清理：长按是异步手势，若组件在长按到期前卸载，fireLongPress 永远不会
  // 经由"正常完成回调"路径收尾——计时器回调会在已销毁组件上触发 toggleSelect，
  // document 级 mousemove 监听也会永久驻留泄漏。这里在作用域销毁时无条件清理
  // （AGENTS.md 监听器清理纪律：清理必须与卸载解耦，不能只依赖手势正常结束）。
  onScopeDispose(() => {
    clearLongPressTimer()
  })

  /**
   * 处理资源鼠标离开（清除计时器）
   */
  function handleResourceMouseLeave(): void {
    clearLongPressTimer()
  }

  /**
   * 处理资源点击
   * @param resource 被点击的资源
   * @param event 鼠标事件
   * @param options 可选回调
   */
  function handleResourceClick(
    resource: ResourceItem,
    event: MouseEvent,
    options?: { onToggleExpand?: () => void }
  ): void {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    stopMoveTracking()

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
