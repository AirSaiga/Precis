import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock Pattern API 层（外部边界）
vi.mock('@/api/projectV2Api/pattern', () => ({
  listV2Patterns: vi.fn(),
  createV2Pattern: vi.fn(),
  updateV2Pattern: vi.fn(),
  deleteV2Pattern: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: () => ({ currentPaths: { configPath: '/fake/proj' } }),
}))

import { useExpressionStore } from '@/stores/expressionStore'
import {
  listV2Patterns,
  createV2Pattern,
  updateV2Pattern,
  deleteV2Pattern,
} from '@/api/projectV2Api/pattern'

const mockedList = vi.mocked(listV2Patterns)
const mockedCreate = vi.mocked(createV2Pattern)
const mockedUpdate = vi.mocked(updateV2Pattern)
const mockedDelete = vi.mocked(deleteV2Pattern)

describe('expressionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initial state has empty patterns and not loading', () => {
    const store = useExpressionStore()
    expect(store.patterns).toEqual([])
    expect(store.isLoading).toBe(false)
    expect(store.patternNames).toEqual([])
  })

  it('fetchExpressions loads patterns from API', async () => {
    mockedList.mockResolvedValue([{ name: 'semver', regex: '^v\\d+$', output: { type: 'semver' } }])
    const store = useExpressionStore()
    await store.fetchExpressions()
    expect(store.isLoading).toBe(false)
    expect(store.patterns.length).toBe(1)
    expect(store.patterns[0].name).toBe('semver')
    expect(store.patterns[0].regex).toBe('^v\\d+$')
    expect(store.patternNames).toEqual(['semver'])
  })

  it('fetchExpressions handles API error gracefully', async () => {
    mockedList.mockRejectedValue(new Error('network'))
    const store = useExpressionStore()
    await store.fetchExpressions()
    expect(store.patterns).toEqual([])
    expect(store.isLoading).toBe(false)
  })

  it('addRule appends a new pattern rule locally', () => {
    const store = useExpressionStore()
    const rule = store.addRule()
    expect(store.patterns.length).toBe(1)
    expect(rule.name).toBe('new_rule')
    expect(rule.regex).toBe('')
    expect(store.patternNames).toEqual(['new_rule'])
  })

  it('saveExpressions syncs new/updated/deleted patterns', async () => {
    // 后端现有：semver + old_rule
    mockedList.mockResolvedValue([
      { name: 'semver', regex: 'a' },
      { name: 'old_rule', regex: 'b' },
    ])
    const store = useExpressionStore()
    await store.fetchExpressions()
    // 本地修改：删 old_rule（移除）、改 semver、加 new_rule
    store.patterns = [
      { name: 'semver', regex: 'updated' },
      { name: 'new_rule', regex: 'c' },
    ]
    await store.saveExpressions()

    // old_rule 应被删除
    expect(mockedDelete).toHaveBeenCalledWith('old_rule', '/fake/proj')
    // semver 应被更新（后端已有）
    expect(mockedUpdate).toHaveBeenCalledWith(
      'semver',
      expect.objectContaining({ name: 'semver', regex: 'updated' }),
      '/fake/proj'
    )
    // new_rule 应被创建（后端没有）
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new_rule', regex: 'c' }),
      '/fake/proj'
    )
  })
})
