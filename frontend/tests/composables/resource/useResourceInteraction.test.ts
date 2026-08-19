/**
 * @file useResourceInteraction.test.ts
 * @description 资源树手势模型单元测试
 *
 * 重点覆盖缺陷修复："拖拽手势被长按多选抢占"：
 * - 按住后指针位移超过阈值（拖拽意图）→ 长按计时取消，多选不触发；
 * - dragstart 路径（clearLongPressTimer）→ 多选不触发；
 * - 指针静止按住 500ms（真实长按意图）→ 仍正常进入多选；
 * - 长按后的补发 click 被吞掉（既有行为回归保护）。
 *
 * 边界处理：mock 依赖的 useResourceTree（Pinia store 组合函数），
 * 仅注入响应式布尔与 spy 函数，被测手势状态机保持真实实现。
 * 手势状态在单次 useResourceInteraction() 闭包内维护，故整个测试共用一个实例。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import type { ResourceItem } from '@/types/resource'

// --- 边界 mock：useResourceTree（被测 composable 的依赖边界） ---
const hasSelection = ref(false)
const isMultiSelectMode = ref(false)
const toggleSelect = vi.fn()
const enterMultiSelectMode = vi.fn()

vi.mock('@/composables/resource', () => ({
  useResourceTree: () => ({
    hasSelection,
    isMultiSelectMode,
    toggleSelect,
    enterMultiSelectMode,
  }),
}))

import {
  useResourceInteraction,
  hasExceededMoveThreshold,
  DRAG_MOVE_THRESHOLD_PX,
} from '@/composables/resource/useResourceInteraction'

/** 测试数据工厂：约束资源 */
function makeResource(overrides?: Partial<{ id: string; name: string }>): ResourceItem {
  return {
    id: overrides?.id ?? 'res_1',
    name: overrides?.name ?? '资源一',
    kind: 'constraint',
    constraintType: 'NotNull',
  }
}

/** 构造鼠标事件的工厂 */
function makeMouseEvent(x: number, y: number): MouseEvent {
  return new MouseEvent('mousedown', { clientX: x, clientY: y })
}

describe('hasExceededMoveThreshold — 拖拽意图判定（纯函数）', () => {
  it('位移在阈值内返回 false（视为长按）', () => {
    expect(hasExceededMoveThreshold(100, 100, 104, 103)).toBe(false)
  })

  it('位移超过阈值返回 true（视为拖拽，任意方向）', () => {
    expect(hasExceededMoveThreshold(100, 100, 100 + DRAG_MOVE_THRESHOLD_PX + 1, 100)).toBe(true)
    expect(hasExceededMoveThreshold(100, 100, 93, 100)).toBe(true)
    expect(hasExceededMoveThreshold(100, 100, 100, 100 - DRAG_MOVE_THRESHOLD_PX - 2)).toBe(true)
  })

  it('支持自定义阈值', () => {
    expect(hasExceededMoveThreshold(0, 0, 20, 0, 50)).toBe(false)
  })
})

describe('useResourceInteraction — 手势状态机', () => {
  // 手势闭包状态在单次调用内维护，测试共用一个实例（每个用例开始先收尾复位）
  const interaction = useResourceInteraction()

  beforeEach(() => {
    vi.useFakeTimers()
    interaction.handleResourceMouseUp()
    hasSelection.value = false
    isMultiSelectMode.value = false
    toggleSelect.mockClear()
    enterMultiSelectMode.mockClear()
  })

  afterEach(() => {
    // 收尾复位，确保 document mousemove 监听被移除（测试隔离）
    interaction.handleResourceMouseUp()
    vi.useRealTimers()
  })

  it('按住不动 500ms：进入多选并选中该条目（长按语义保留）', () => {
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(100, 100))

    vi.advanceTimersByTime(500)

    expect(enterMultiSelectMode).toHaveBeenCalledTimes(1)
    expect(toggleSelect).toHaveBeenCalledTimes(1)
  })

  it('按住后位移超过阈值：长按被取消，不进入多选（拖拽不被多选抢占）', () => {
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(100, 100))

    // 模拟按住缓慢拖动（未到 500ms 已位移超过阈值）
    const move = new MouseEvent('mousemove', {
      clientX: 100 + DRAG_MOVE_THRESHOLD_PX + 2,
      clientY: 100,
    })
    document.dispatchEvent(move)

    vi.advanceTimersByTime(600)

    expect(enterMultiSelectMode).not.toHaveBeenCalled()
    expect(toggleSelect).not.toHaveBeenCalled()
  })

  it('位移取消长按后：document mousemove 监听被移除（无泄漏）', () => {
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(0, 0))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0 }))

    const spy = vi.spyOn(document, 'removeEventListener')
    // 新手势 + mouseup 收尾：监听应被移除
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(0, 0))
    interaction.handleResourceMouseUp()
    expect(spy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    spy.mockRestore()
  })

  it('dragstart 路径（clearLongPressTimer）：多选不触发', () => {
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(10, 10))

    interaction.clearLongPressTimer()
    vi.advanceTimersByTime(700)

    expect(enterMultiSelectMode).not.toHaveBeenCalled()
    expect(toggleSelect).not.toHaveBeenCalled()
  })

  it('mouseup 提前释放：长按不触发', () => {
    interaction.handleResourceMouseDown(makeResource(), makeMouseEvent(10, 10))

    vi.advanceTimersByTime(200)
    interaction.handleResourceMouseUp()
    vi.advanceTimersByTime(500)

    expect(enterMultiSelectMode).not.toHaveBeenCalled()
  })

  it('长按完成后：补发的 click 被吞掉（不把选中项立即反选）', () => {
    const resource = makeResource({ id: 'res_long' })
    interaction.handleResourceMouseDown(resource, makeMouseEvent(0, 0))
    vi.advanceTimersByTime(500)

    // 长按选中后 hasSelection 通常为 true：click 应被跳过而非再次 toggle
    hasSelection.value = true
    interaction.handleResourceClick(resource, new MouseEvent('click'))
    expect(toggleSelect).toHaveBeenCalledTimes(1) // 仅长按那一次
  })
})
