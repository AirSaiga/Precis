import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useScriptEditorStore } from '@/stores/scriptEditorStore'

describe('scriptEditorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial state is hidden with null nodeId', () => {
    const store = useScriptEditorStore()
    expect(store.visible).toBe(false)
    expect(store.nodeId).toBeNull()
  })

  it('open sets nodeId and makes visible', () => {
    const store = useScriptEditorStore()
    store.open('node-123')
    expect(store.visible).toBe(true)
    expect(store.nodeId).toBe('node-123')
  })

  it('close hides editor and clears nodeId', () => {
    const store = useScriptEditorStore()
    store.open('node-456')
    store.close()
    expect(store.visible).toBe(false)
    expect(store.nodeId).toBeNull()
  })
})
