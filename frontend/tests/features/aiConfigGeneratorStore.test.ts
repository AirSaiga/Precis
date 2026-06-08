import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createDefaultOptions } from '@/features/ai-config-generator/services/generationOptions'
import type { AiGenerateV2ConfigOptions } from '@/types/ai'

vi.mock('@/api/aiApi', () => ({
  getActiveCloudAIProvider: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn() },
}))

// Must import after mocks are set up
const { useAiConfigGeneratorStore } = await import('@/features/ai-config-generator/stores/aiConfigGeneratorStore')

describe('aiConfigGeneratorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initial state has visible=false and default options', () => {
    const store = useAiConfigGeneratorStore()
    expect(store.visible).toBe(false)
    expect(store.activeProvider).toBeNull()
    expect(store.providerLoaded).toBe(false)
    expect(store.options).toEqual(createDefaultOptions())
  })

  it('open() resets state and sets visible=true', () => {
    const store = useAiConfigGeneratorStore()
    store.options = { ...createDefaultOptions(), sample_rows: 999 }
    store.open()
    expect(store.visible).toBe(true)
    expect(store.options.sample_rows).toBe(50)
  })

  it('open() calls loadActiveProvider', async () => {
    const store = useAiConfigGeneratorStore()
    store.open()
    await vi.waitFor(() => {
      expect(store.providerLoaded).toBe(true)
    })
  })

  it('close() sets visible=false and runs reset hooks', () => {
    const store = useAiConfigGeneratorStore()
    store.open()
    const hook = vi.fn()
    store.registerResetHook(hook)
    store.close()
    expect(store.visible).toBe(false)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('registerResetHook adds to hook list', () => {
    const store = useAiConfigGeneratorStore()
    const hook1 = vi.fn()
    const hook2 = vi.fn()
    store.registerResetHook(hook1)
    store.registerResetHook(hook2)
    store.close()
    expect(hook1).toHaveBeenCalledTimes(1)
    expect(hook2).toHaveBeenCalledTimes(1)
  })

  it('resetAllState resets to initial values', () => {
    const store = useAiConfigGeneratorStore()
    store.activeProvider = { id: 'test', name: 'Test', api_key_configured: true } as any
    store.providerLoaded = true
    store.options = { ...createDefaultOptions(), sample_rows: 999 }
    store.resetAllState()
    expect(store.activeProvider).toBeNull()
    expect(store.providerLoaded).toBe(false)
    expect(store.options).toEqual(createDefaultOptions())
  })

  it('loadActiveProvider sets providerLoaded on success', async () => {
    const { getActiveCloudAIProvider } = await import('@/api/aiApi')
    const mockProvider = { id: 'p1', name: 'Test Provider', api_key_configured: true }
    vi.mocked(getActiveCloudAIProvider).mockResolvedValue(mockProvider as any)
    const store = useAiConfigGeneratorStore()
    await store.loadActiveProvider()
    expect(store.activeProvider).toEqual(mockProvider)
    expect(store.providerLoaded).toBe(true)
  })

  it('loadActiveProvider handles error', async () => {
    const { getActiveCloudAIProvider } = await import('@/api/aiApi')
    vi.mocked(getActiveCloudAIProvider).mockRejectedValue(new Error('API error'))
    const store = useAiConfigGeneratorStore()
    await store.loadActiveProvider()
    expect(store.activeProvider).toBeNull()
    expect(store.providerLoaded).toBe(true)
  })
})
