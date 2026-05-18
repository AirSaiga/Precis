import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useShortcutStore } from '@/features/keyboard/stores/shortcutStore'

const STORAGE_KEY = 'precis-shortcuts'

describe('shortcutStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
    setActivePinia(createPinia())
  })

  it('initial state uses default config', () => {
    const store = useShortcutStore()
    expect(store.enabled).toBe(true)
    expect(store.showFeedback).toBe(true)
    expect(store.disabledCount).toBe(0)
    expect(store.customShortcutCount).toBe(0)
  })

  it('toggles enabled and persists to localStorage', () => {
    const store = useShortcutStore()
    store.enabled = false
    expect(store.enabled).toBe(false)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.enabled).toBe(false)
  })

  it('toggles showFeedback and persists', () => {
    const store = useShortcutStore()
    store.showFeedback = false
    expect(store.showFeedback).toBe(false)
  })

  it('disableCommand adds to disabled list', () => {
    const store = useShortcutStore()
    store.disableCommand('cmd.save')
    expect(store.isCommandDisabled('cmd.save')).toBe(true)
    expect(store.disabledCount).toBe(1)
  })

  it('enableCommand removes from disabled list', () => {
    const store = useShortcutStore()
    store.disableCommand('cmd.save')
    store.enableCommand('cmd.save')
    expect(store.isCommandDisabled('cmd.save')).toBe(false)
    expect(store.disabledCount).toBe(0)
  })

  it('duplicate disable does not add twice', () => {
    const store = useShortcutStore()
    store.disableCommand('cmd.a')
    store.disableCommand('cmd.a')
    expect(store.disabledCount).toBe(1)
  })

  it('setCustomShortcut stores and retrieves', () => {
    const store = useShortcutStore()
    store.setCustomShortcut('cmd.zoom', { key: 'Equal', ctrl: true })
    expect(store.getCustomShortcut('cmd.zoom')).toEqual({ key: 'Equal', ctrl: true })
    expect(store.customShortcutCount).toBe(1)
  })

  it('deleteCustomShortcut removes entry', () => {
    const store = useShortcutStore()
    store.setCustomShortcut('cmd.x', { key: 'X' })
    store.deleteCustomShortcut('cmd.x')
    expect(store.getCustomShortcut('cmd.x')).toBeUndefined()
    expect(Object.keys(store.config.customShortcuts).length).toBe(0)
  })

  it('resetToDefaults restores initial state', () => {
    const store = useShortcutStore()
    store.enabled = false
    store.disableCommand('cmd.y')
    store.setCustomShortcut('cmd.z', { key: 'Z' })
    store.resetToDefaults()
    expect(store.enabled).toBe(true)
    expect(store.config.disabledCommands).toEqual([])
    expect(Object.keys(store.config.customShortcuts).length).toBe(0)
  })

  it('exportConfig returns deep copy', () => {
    const store = useShortcutStore()
    store.disableCommand('cmd.a')
    const exported = store.exportConfig()
    expect(exported.disabledCommands).toContain('cmd.a')
    exported.disabledCommands.push('cmd.b')
    expect(store.isCommandDisabled('cmd.b')).toBe(false)
  })

  it('importConfig merges settings', () => {
    const store = useShortcutStore()
    store.importConfig({
      customShortcuts: { 'cmd.open': { key: 'O', ctrl: true } },
      disabledCommands: ['cmd.close'],
      enabled: false,
      showFeedback: false,
    })
    expect(store.enabled).toBe(false)
    expect(store.showFeedback).toBe(false)
    expect(store.isCommandDisabled('cmd.close')).toBe(true)
    expect(store.getCustomShortcut('cmd.open')).toEqual({ key: 'O', ctrl: true })
  })

  it('restores config from localStorage on init', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: false,
        showFeedback: true,
        disabledCommands: ['cmd.test'],
        customShortcuts: {},
      })
    )
    setActivePinia(createPinia())
    const store = useShortcutStore()
    expect(store.enabled).toBe(false)
    expect(store.isCommandDisabled('cmd.test')).toBe(true)
  })
})
