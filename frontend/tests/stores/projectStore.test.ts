import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'

vi.spyOn(console, 'error').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('projectStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initial state is inactive with null paths', () => {
    const store = useProjectStore()
    expect(store.currentPaths).toBeNull()
    expect(store.isProjectActive).toBe(false)
  })

  it('setProjectPaths updates state and persists to localStorage', () => {
    const store = useProjectStore()
    store.setProjectPaths({ configPath: '/project', dataPath: '/project/data' })
    expect(store.currentPaths).toEqual({ configPath: '/project', dataPath: '/project/data' })
    expect(store.isProjectActive).toBe(true)
    const stored = localStorage.getItem('activeProjectPaths')
    expect(stored).toBe(JSON.stringify({ configPath: '/project', dataPath: '/project/data' }))
  })

  it('clearProject resets state and removes localStorage', () => {
    const store = useProjectStore()
    store.setProjectPaths({ configPath: '/project', dataPath: '/data' })
    store.clearProject()
    expect(store.currentPaths).toBeNull()
    expect(store.isProjectActive).toBe(false)
    expect(localStorage.getItem('activeProjectPaths')).toBeNull()
  })

  it('isProjectActive is false when configPath is empty string', () => {
    const store = useProjectStore()
    store.setProjectPaths({ configPath: '', dataPath: '/data' })
    expect(store.isProjectActive).toBe(false)
  })

  it('restores valid paths from localStorage on init', () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: '/saved', dataPath: '/saved/data' })
    )
    // Re-create store to trigger init logic
    setActivePinia(createPinia())
    const store = useProjectStore()
    expect(store.currentPaths).toEqual({ configPath: '/saved', dataPath: '/saved/data' })
    expect(store.isProjectActive).toBe(true)
  })

  it('ignores invalid localStorage data', () => {
    localStorage.setItem('activeProjectPaths', 'not-json')
    setActivePinia(createPinia())
    const store = useProjectStore()
    expect(store.currentPaths).toBeNull()
  })

  it('removes malformed localStorage object', () => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ foo: 'bar' }))
    setActivePinia(createPinia())
    const store = useProjectStore()
    expect(store.currentPaths).toBeNull()
    expect(localStorage.getItem('activeProjectPaths')).toBeNull()
  })
})
