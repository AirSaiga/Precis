/**
 * @fileoverview appModeStore 单元测试
 *
 * 覆盖 IDE / Agent 双模式切换行为：
 * - 默认 IDE 模式
 * - setMode 切换 + 同值早退
 * - toggleMode 双向往复
 * - 切换前 AI 任务清理（loading 时中止流式 + 等待飞行指令）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppModeStore } from '@/stores/appModeStore'
import { useAiChatStore } from '@/stores/aiChatStore'

// aiChatStore 是边界依赖：mock 掉流式清理，专注验证模式切换本身。
// 用 vi.hoisted 保持单例 mock 对象——store 内部与测试断言必须命中同一个实例。
const aiChatMock = vi.hoisted(() => ({
  loading: false,
  cancelSendMessage: vi.fn().mockResolvedValue(undefined),
  awaitPendingInstructions: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/aiChatStore', () => ({
  useAiChatStore: vi.fn(() => aiChatMock),
}))

describe('appModeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    aiChatMock.loading = false
    aiChatMock.cancelSendMessage.mockClear()
    aiChatMock.awaitPendingInstructions.mockClear()
  })

  it('默认处于 IDE 模式', () => {
    const store = useAppModeStore()
    expect(store.mode).toBe('ide')
    expect(store.isAgentMode).toBe(false)
  })

  it('setMode("agent") 切换到 Agent 模式', async () => {
    const store = useAppModeStore()
    await store.setMode('agent')
    expect(store.mode).toBe('agent')
    expect(store.isAgentMode).toBe(true)
  })

  it('setMode 同值早退，不触发 AI 清理', async () => {
    const store = useAppModeStore()
    await store.setMode('ide')
    expect(aiChatMock.awaitPendingInstructions).not.toHaveBeenCalled()
    expect(store.mode).toBe('ide')
  })

  it('切换前等待 AI 飞行指令落定', async () => {
    const store = useAppModeStore()
    await store.setMode('agent')
    expect(aiChatMock.awaitPendingInstructions).toHaveBeenCalledTimes(1)
  })

  it('loading 中切换先中止流式对话再切换', async () => {
    aiChatMock.loading = true
    const store = useAppModeStore()
    await store.setMode('agent')
    expect(aiChatMock.cancelSendMessage).toHaveBeenCalledTimes(1)
    expect(store.mode).toBe('agent')
  })

  it('toggleMode 在双模式间往复（异步落定）', async () => {
    const store = useAppModeStore()
    store.toggleMode()
    await vi.waitFor(() => expect(store.isAgentMode).toBe(true))
    store.toggleMode()
    await vi.waitFor(() => expect(store.isAgentMode).toBe(false))
  })
})
