import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useExpressionStore } from '@/stores/expressionStore'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  // expressionStore 经 toast 间接引入 src/i18n/index.ts，后者顶层调用 createI18n
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

describe('expressionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initial state has empty patterns and not loading', () => {
    const store = useExpressionStore()
    expect(store.patterns).toEqual([])
    expect(store.isLoading).toBe(false)
    expect(store.patternNames).toEqual([])
  })

  it('fetchExpressions loads patterns after delay', async () => {
    const store = useExpressionStore()
    const promise = store.fetchExpressions()
    expect(store.isLoading).toBe(true)
    vi.advanceTimersByTime(500)
    await promise
    expect(store.isLoading).toBe(false)
    expect(store.patterns.length).toBe(1)
    expect(store.patterns[0].name).toBe('gt_int')
    expect(store.patternNames).toEqual(['gt_int'])
  })

  it('addRule appends a new pattern rule', () => {
    const store = useExpressionStore()
    const rule = store.addRule('patterns')
    expect(store.patterns.length).toBe(1)
    expect(rule.name).toBe('new_rule')
    expect(rule.regex).toBe('')
    expect(store.patternNames).toEqual(['new_rule'])
  })
})
