import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFeedbackStore } from '@/stores/feedbackStore'
import type { ErrorInfo } from '@/types/feedback'

function makeError(overrides?: Partial<ErrorInfo>): ErrorInfo {
  return {
    source: 'renderer',
    message: 'TestError: boom',
    stack: 'at a (x.js:1)\nat b (x.js:2)',
    url: 'app://./canvas',
    ...overrides,
  }
}

describe('feedbackStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reportCrash 后队列长度 +1,模态可见', () => {
    const store = useFeedbackStore()
    expect(store.pendingReports).toHaveLength(0)
    expect(store.isModalVisible).toBe(false)

    store.reportCrash(makeError())

    expect(store.pendingReports).toHaveLength(1)
    expect(store.isModalVisible).toBe(true)
    expect(store.currentReport?.message).toBe('TestError: boom')
  })

  it('相同指纹的第二次错误不进队列(会话内去重)', () => {
    const store = useFeedbackStore()
    store.reportCrash(makeError())
    store.reportCrash(makeError()) // 完全相同

    expect(store.pendingReports).toHaveLength(1)
  })

  it('不同指纹的错误都进队列', () => {
    const store = useFeedbackStore()
    store.reportCrash(makeError({ message: 'A' }))
    store.reportCrash(makeError({ message: 'B' }))

    expect(store.pendingReports).toHaveLength(2)
  })

  it('dismiss 出列当前报告,有下一个则继续显示', () => {
    const store = useFeedbackStore()
    store.reportCrash(makeError({ message: 'A' }))
    store.reportCrash(makeError({ message: 'B' }))

    store.dismiss()
    expect(store.pendingReports).toHaveLength(1)
    expect(store.isModalVisible).toBe(true)
    expect(store.currentReport?.message).toBe('B')

    store.dismiss()
    expect(store.pendingReports).toHaveLength(0)
    expect(store.isModalVisible).toBe(false)
  })

  it('报告补全环境字段(version/platform/fingerprint/id)', () => {
    const store = useFeedbackStore()
    store.reportCrash(makeError())
    const report = store.currentReport

    expect(report).toBeDefined()
    expect(report!.id).toBeTruthy()
    expect(report!.timestamp).toBeTruthy()
    expect(report!.fingerprint).toMatch(/^[0-9a-f]+$/)
    expect(typeof report!.appVersion).toBe('string')
    expect(typeof report!.platform).toBe('string')
  })
})
