/**
 * X02 — 键盘监听器 IME 合成态行为校验
 *
 * 本测试由 verify.mjs 复制进 frontend/tests/features/keyboard/ 后以 vitest 运行。
 * 直接 import 真实的 KeyboardListenerImpl，通过 document 派发合成 keydown 事件，
 * 断言「IME 合成态事件不派发 shortcut / 非合成态正常派发」。
 *
 * Mock 面（仅外部边界）：
 *   - @/core/utils/logger — 静默日志
 *   - @/core/eventBus     — 隔离应用事件总线
 * 平台适配器（platformAdapter）走真实实现（jsdom 下 navigator 可用，无重依赖）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/core/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/core/eventBus', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}))

import { KeyboardListenerImpl } from '@/features/keyboard/listeners/keyboardListener'
import type { ShortcutEventData } from '@/features/keyboard/types'

function createExecutor() {
  return {
    execute: vi.fn(async () => ({ success: true })),
    on: vi.fn(),
    off: vi.fn(),
  }
}

/**
 * 构造并派发一个 keydown 事件。
 * isComposing / keyCode 是 KeyboardEvent 上的只读（或遗留只读）属性，
 * 构造参数里传 isComposing 在不同实现下兼容性不一，统一用 defineProperty 覆盖。
 * 事件派发到 document.body 并冒泡到 document（监听器挂在 document 上），
 * target 为 body —— 不在输入框内，isIgnoredElement 不会拦截。
 */
function dispatchKeydown(init: {
  key: string
  isComposing?: boolean
  keyCode?: number
  ctrlKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'isComposing', { value: init.isComposing ?? false })
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  document.body.dispatchEvent(event)
  return event
}

describe('X02 — 键盘监听器对 IME 合成态事件的处理', () => {
  let listener: KeyboardListenerImpl
  let shortcutSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listener = new KeyboardListenerImpl(createExecutor())
    shortcutSpy = vi.fn()
    listener.on('shortcut', shortcutSpy as (data: ShortcutEventData) => void)
    listener.start()
  })

  afterEach(() => {
    listener.destroy()
  })

  describe('IME 合成态（选词阶段）事件必须被放行，不得触发任何快捷键', () => {
    it('isComposing=true 的 Backspace 不派发 shortcut（否则误删节点）', async () => {
      dispatchKeydown({ key: 'Backspace', isComposing: true })
      await Promise.resolve()
      expect(shortcutSpy).not.toHaveBeenCalled()
    })

    it('isComposing=true 的单字符键不派发 shortcut（选词数字键/字母）', async () => {
      dispatchKeydown({ key: 'a', isComposing: true })
      dispatchKeydown({ key: '1', isComposing: true })
      await Promise.resolve()
      expect(shortcutSpy).not.toHaveBeenCalled()
    })

    it('isComposing=true 的 Enter 不派发 shortcut（确认候选不应触发确认动作）', async () => {
      dispatchKeydown({ key: 'Enter', isComposing: true })
      await Promise.resolve()
      expect(shortcutSpy).not.toHaveBeenCalled()
    })

    it('keyCode=229（旧 Chromium 合成态信号）的 Backspace 不派发 shortcut', async () => {
      // 旧版 Chromium 在 IME 合成态下 isComposing 可能为 false，
      // 但 keyCode 恒为 229 —— 该兜底信号也必须被识别
      dispatchKeydown({ key: 'Backspace', isComposing: false, keyCode: 229 })
      await Promise.resolve()
      expect(shortcutSpy).not.toHaveBeenCalled()
    })

    it('keyCode=229 的单字符键不派发 shortcut', async () => {
      dispatchKeydown({ key: 'a', isComposing: false, keyCode: 229 })
      await Promise.resolve()
      expect(shortcutSpy).not.toHaveBeenCalled()
    })
  })

  describe('非合成态快捷键行为不回归', () => {
    it('普通 Backspace 正常派发 shortcut', async () => {
      dispatchKeydown({ key: 'Backspace', keyCode: 8 })
      await Promise.resolve()
      expect(shortcutSpy).toHaveBeenCalledTimes(1)
      const data = shortcutSpy.mock.calls[0][0] as ShortcutEventData
      expect(data.shortcut.key).toBe('Backspace')
    })

    it('普通单字符键正常派发 shortcut', async () => {
      dispatchKeydown({ key: 'a', keyCode: 65 })
      await Promise.resolve()
      expect(shortcutSpy).toHaveBeenCalledTimes(1)
    })

    it('Ctrl+S 组合键正常派发 shortcut', async () => {
      dispatchKeydown({ key: 's', ctrlKey: true, keyCode: 83 })
      await Promise.resolve()
      expect(shortcutSpy).toHaveBeenCalledTimes(1)
      const data = shortcutSpy.mock.calls[0][0] as ShortcutEventData
      expect(data.shortcut.ctrl).toBe(true)
    })

    it('显式 isComposing=false 的事件按普通按键处理', async () => {
      dispatchKeydown({ key: 'Backspace', isComposing: false, keyCode: 8 })
      await Promise.resolve()
      expect(shortcutSpy).toHaveBeenCalledTimes(1)
    })
  })
})
