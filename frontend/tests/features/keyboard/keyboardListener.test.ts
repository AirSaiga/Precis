/**
 * @fileoverview keyboardListener 单元测试
 *
 * 重点回归（CI G1 用例失败根因）：页面存在文本选区时，
 * Ctrl+A 不得被"放行原生行为"守卫吞掉——画布应用的节点全选
 * 必须始终生效（浏览器原生全选选中的是页面文本，无业务价值）。
 * Ctrl+C / Ctrl+X 在有文本选区时仍放行给浏览器原生复制/剪切。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import KeyboardListenerImpl from '@/features/keyboard/listeners/keyboardListener'
import type { ShortcutEventData } from '@/features/keyboard/types'

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  // 真实事件的 target 总是具体元素；派发到 body（tagName 存在且非输入元素，不会被忽略守卫拦截）
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
}

/** 模拟页面文本选区状态（happy-dom 下无法真实建立 Range 选区） */
function mockSelection(text: string) {
  return vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text,
  } as unknown as Selection)
}

describe('KeyboardListenerImpl 文本选区守卫', () => {
  let listener: KeyboardListenerImpl
  let received: ShortcutEventData[]

  beforeEach(() => {
    received = []
    const executor = {
      execute: vi.fn().mockResolvedValue({ success: true }),
      on: vi.fn(),
      off: vi.fn(),
    }
    listener = new KeyboardListenerImpl(executor)
    listener.on('shortcut', (data) => received.push(data))
    listener.start()
  })

  afterEach(() => {
    listener.destroy()
    vi.restoreAllMocks()
  })

  it('有文本选区时 Ctrl+A 仍触发快捷键（节点全选不被吞）', () => {
    const spy = mockSelection('残留的页面文本')
    pressKey('a', { ctrlKey: true })
    expect(spy).toHaveBeenCalled()
    expect(received).toHaveLength(1)
    expect(received[0]?.shortcut.key).toBe('a')
    expect(received[0]?.shortcut.ctrl).toBe(true)
  })

  it('无文本选区时 Ctrl+A 正常触发', () => {
    mockSelection('')
    pressKey('a', { ctrlKey: true })
    expect(received).toHaveLength(1)
  })

  it('有文本选区时 Ctrl+C 放行给浏览器原生行为（不触发快捷键）', () => {
    mockSelection('选中的文本')
    pressKey('c', { ctrlKey: true })
    expect(received).toHaveLength(0)
  })

  it('有文本选区时 Ctrl+X 放行给浏览器原生行为（不触发快捷键）', () => {
    mockSelection('选中的文本')
    pressKey('x', { ctrlKey: true })
    expect(received).toHaveLength(0)
  })

  it('普通按键不受选区影响', () => {
    mockSelection('选中的文本')
    pressKey('Delete')
    expect(received).toHaveLength(1)
    expect(received[0]?.shortcut.key).toBe('Delete')
  })
})
