import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Shortcut } from '@/features/keyboard/types'
import {
  adaptShortcutToPlatform,
  getPlatformShortcut,
  formatShortcut,
  getKeyDisplayName,
  parseShortcut,
  getOriginalKey,
  compareShortcuts,
  matchesShortcut,
  platformAdapter,
} from '@/features/keyboard/platform/adapter'

const CTRL = '\u2303'
const CMD = '\u2318'
const OPT = '\u2325'
const SHIFT = '\u21E7'

function mockNavigator(platform: string, language = 'en-US'): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, language },
    configurable: true,
    writable: true,
  })
}

function makeKeyEvent(key: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  return event
}

function withModifiers(
  event: KeyboardEvent,
  mods: {
    ctrl?: boolean
    meta?: boolean
    shift?: boolean
    alt?: boolean
  }
): KeyboardEvent {
  Object.defineProperty(event, 'ctrlKey', { value: mods.ctrl ?? false, configurable: true })
  Object.defineProperty(event, 'metaKey', { value: mods.meta ?? false, configurable: true })
  Object.defineProperty(event, 'shiftKey', { value: mods.shift ?? false, configurable: true })
  Object.defineProperty(event, 'altKey', { value: mods.alt ?? false, configurable: true })
  return event
}

describe('adaptShortcutToPlatform', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('on Mac', () => {
    beforeEach(() => {
      mockNavigator('MacIntel')
    })

    it('converts ctrl to meta when meta is not set', () => {
      const result = adaptShortcutToPlatform({ key: 's', ctrl: true })
      expect(result.ctrl).toBe(false)
      expect(result.meta).toBe(true)
    })

    it('keeps meta when meta is already set', () => {
      const result = adaptShortcutToPlatform({ key: 's', meta: true })
      expect(result.meta).toBe(true)
      expect(result.ctrl).toBe(false)
    })

    it('keeps both meta and ctrl when both are set', () => {
      // 源码逻辑：当 meta 已设置时不再转换（即使 ctrl 也设置）
      const result = adaptShortcutToPlatform({ key: 's', meta: true, ctrl: true })
      expect(result.meta).toBe(true)
      expect(result.ctrl).toBe(true)
    })

    it('preserves alt and shift flags', () => {
      const result = adaptShortcutToPlatform({ key: 's', ctrl: true, alt: true, shift: true })
      expect(result.alt).toBe(true)
      expect(result.shift).toBe(true)
      expect(result.meta).toBe(true)
      expect(result.ctrl).toBe(false)
    })
  })

  describe('on non-Mac (Windows)', () => {
    beforeEach(() => {
      mockNavigator('Win32')
    })

    it('converts meta to ctrl when ctrl is not set', () => {
      const result = adaptShortcutToPlatform({ key: 's', meta: true })
      expect(result.meta).toBe(false)
      expect(result.ctrl).toBe(true)
    })

    it('keeps ctrl when ctrl is already set', () => {
      const result = adaptShortcutToPlatform({ key: 's', ctrl: true })
      expect(result.ctrl).toBe(true)
      expect(result.meta).toBe(false)
    })

    it('keeps both meta and ctrl when both are set', () => {
      // 源码逻辑：当 ctrl 已设置时不再转换（即使 meta 也设置）
      const result = adaptShortcutToPlatform({ key: 's', ctrl: true, meta: true })
      expect(result.ctrl).toBe(true)
      expect(result.meta).toBe(true)
    })
  })

  it('normalizes undefined modifier flags to false', () => {
    mockNavigator('MacIntel')
    const result = adaptShortcutToPlatform({ key: 'a' })
    expect(result.ctrl).toBe(false)
    expect(result.meta).toBe(false)
    expect(result.shift).toBe(false)
    expect(result.alt).toBe(false)
  })
})

describe('getPlatformShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns adapted default when no variants are provided', () => {
    mockNavigator('MacIntel')
    const defaultShortcut: Shortcut = { key: 's', ctrl: true }
    const result = getPlatformShortcut(defaultShortcut)
    expect(result.meta).toBe(true)
    expect(result.ctrl).toBe(false)
  })

  it('returns Mac variant on Mac when defined', () => {
    mockNavigator('MacIntel')
    const defaultShortcut: Shortcut = { key: 's', ctrl: true }
    const result = getPlatformShortcut(defaultShortcut, {
      mac: { key: 's', meta: true, shift: true },
    })
    expect(result.key).toBe('s')
    expect(result.meta).toBe(true)
    expect(result.shift).toBe(true)
  })

  it('returns Windows variant on Windows when defined', () => {
    mockNavigator('Win32')
    const defaultShortcut: Shortcut = { key: 's', ctrl: true }
    const result = getPlatformShortcut(defaultShortcut, {
      windows: { key: 's', ctrl: true, alt: true },
    })
    expect(result.ctrl).toBe(true)
    expect(result.alt).toBe(true)
  })

  it('returns adapted default when platform variant is missing', () => {
    mockNavigator('Win32')
    const defaultShortcut: Shortcut = { key: 's', ctrl: true }
    const result = getPlatformShortcut(defaultShortcut, {
      mac: { key: 's', meta: true },
    })
    expect(result.ctrl).toBe(true)
    expect(result.meta).toBe(false)
  })
})

describe('formatShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('on Mac', () => {
    beforeEach(() => {
      mockNavigator('MacIntel')
    })

    it('formats control as ⌃', () => {
      expect(formatShortcut({ key: 's', ctrl: true })).toBe(`${CTRL}+S`)
    })

    it('formats meta as ⌘', () => {
      expect(formatShortcut({ key: 's', meta: true })).toBe(`${CMD}+S`)
    })

    it('formats alt as ⌥', () => {
      expect(formatShortcut({ key: 's', alt: true })).toBe(`${OPT}+S`)
    })

    it('formats shift as ⇧', () => {
      expect(formatShortcut({ key: 's', shift: true })).toBe(`${SHIFT}+S`)
    })

    it('combines multiple modifiers in canonical order', () => {
      expect(formatShortcut({ key: 's', ctrl: true, shift: true, alt: true, meta: true })).toBe(
        `${CTRL}+${CMD}+${OPT}+${SHIFT}+S`
      )
    })

    it('uses display name for special keys', () => {
      expect(formatShortcut({ key: 'Escape' })).toBe('Esc')
      expect(formatShortcut({ key: 'ArrowUp' })).toBe('↑')
      expect(formatShortcut({ key: 'Enter' })).toBe('Enter')
    })

    it('uppercases single-character keys', () => {
      expect(formatShortcut({ key: 'a' })).toBe('A')
      expect(formatShortcut({ key: 'z' })).toBe('Z')
    })

    it('uses short format without separator', () => {
      expect(formatShortcut({ key: 's', ctrl: true, meta: true }, true)).toBe(`${CTRL}${CMD}S`)
    })
  })

  describe('on Windows', () => {
    beforeEach(() => {
      mockNavigator('Win32')
    })

    it('formats control as Ctrl', () => {
      expect(formatShortcut({ key: 's', ctrl: true })).toBe('Ctrl+S')
    })

    it('formats meta as Win', () => {
      expect(formatShortcut({ key: 's', meta: true })).toBe('Win+S')
    })

    it('formats alt as Alt', () => {
      expect(formatShortcut({ key: 's', alt: true })).toBe('Alt+S')
    })

    it('formats shift as Shift', () => {
      expect(formatShortcut({ key: 's', shift: true })).toBe('Shift+S')
    })

    it('combines modifiers with + separator', () => {
      expect(formatShortcut({ key: 's', ctrl: true, shift: true })).toBe('Ctrl+Shift+S')
    })

    it('keeps multi-character key as-is', () => {
      expect(formatShortcut({ key: 'F1' })).toBe('F1')
    })
  })
})

describe('getKeyDisplayName', () => {
  it('maps space to Space', () => {
    expect(getKeyDisplayName(' ')).toBe('Space')
  })

  it('maps Escape to Esc', () => {
    expect(getKeyDisplayName('Escape')).toBe('Esc')
  })

  it('maps Enter to Enter', () => {
    expect(getKeyDisplayName('Enter')).toBe('Enter')
  })

  it('maps arrow keys to arrows', () => {
    expect(getKeyDisplayName('ArrowUp')).toBe('↑')
    expect(getKeyDisplayName('ArrowDown')).toBe('↓')
    expect(getKeyDisplayName('ArrowLeft')).toBe('←')
    expect(getKeyDisplayName('ArrowRight')).toBe('→')
  })

  it('maps function keys to F-key labels', () => {
    for (let i = 1; i <= 12; i++) {
      expect(getKeyDisplayName(`F${i}`)).toBe(`F${i}`)
    }
  })

  it('maps Insert and Delete to short labels', () => {
    expect(getKeyDisplayName('Insert')).toBe('Ins')
    expect(getKeyDisplayName('Delete')).toBe('Del')
  })

  it('returns key as-is when not in map', () => {
    expect(getKeyDisplayName('SomeUnknownKey')).toBe('SomeUnknownKey')
  })
})

describe('getOriginalKey', () => {
  it('maps SPACE/SP to space character', () => {
    expect(getOriginalKey('SPACE')).toBe(' ')
    expect(getOriginalKey('SP')).toBe(' ')
  })

  it('maps ESC variants to Escape', () => {
    expect(getOriginalKey('ESC')).toBe('Escape')
    expect(getOriginalKey('ESCAPE')).toBe('Escape')
  })

  it('maps ENTER to Enter', () => {
    expect(getOriginalKey('ENTER')).toBe('Enter')
  })

  it('maps arrow key names', () => {
    expect(getOriginalKey('UP')).toBe('ArrowUp')
    expect(getOriginalKey('DOWN')).toBe('ArrowDown')
    expect(getOriginalKey('LEFT')).toBe('ArrowLeft')
    expect(getOriginalKey('RIGHT')).toBe('ArrowRight')
  })

  it('maps INSERT/INS to Insert', () => {
    expect(getOriginalKey('INS')).toBe('Insert')
    expect(getOriginalKey('INSERT')).toBe('Insert')
  })

  it('maps DEL/DELETE to Delete', () => {
    expect(getOriginalKey('DEL')).toBe('Delete')
    expect(getOriginalKey('DELETE')).toBe('Delete')
  })

  it('maps BACKSPACE/BS to Backspace', () => {
    expect(getOriginalKey('BACKSPACE')).toBe('Backspace')
    expect(getOriginalKey('BS')).toBe('Backspace')
  })

  it('returns original string for unknown display names', () => {
    expect(getOriginalKey('SomeUnknown')).toBe('SomeUnknown')
  })
})

describe('parseShortcut', () => {
  it('parses Ctrl+S', () => {
    const result = parseShortcut('Ctrl+S')
    expect(result).toEqual({
      key: 'S',
      ctrl: true,
      meta: false,
      shift: false,
      alt: false,
    })
  })

  it('parses Ctrl + S with spaces', () => {
    const result = parseShortcut('Ctrl + S')
    expect(result.ctrl).toBe(true)
    expect(result.key).toBe('S')
  })

  it('parses Cmd+Shift+Z (Mac format)', () => {
    const result = parseShortcut('Cmd+Shift+Z')
    expect(result.meta).toBe(true)
    expect(result.shift).toBe(true)
    expect(result.key).toBe('Z')
  })

  it('parses Alt+Delete', () => {
    const result = parseShortcut('Alt+Delete')
    expect(result.alt).toBe(true)
    expect(result.key).toBe('Delete')
  })

  it('parses control as ctrl', () => {
    const result = parseShortcut('control+s')
    expect(result.ctrl).toBe(true)
    expect(result.key).toBe('s')
  })

  it('parses command/option as meta/alt', () => {
    const result = parseShortcut('command+s option+s')
    expect(result.meta).toBe(true)
    expect(result.alt).toBe(true)
  })

  it('parses unicode modifier symbols with separator', () => {
    const result = parseShortcut(`${CMD}+${SHIFT}+A`)
    expect(result.meta).toBe(true)
    expect(result.shift).toBe(true)
    expect(result.key).toBe('A')
  })

  it('handles empty string', () => {
    const result = parseShortcut('')
    expect(result.key).toBe('')
    expect(result.ctrl).toBe(false)
  })

  it('handles Esc key', () => {
    const result = parseShortcut('Esc')
    expect(result.key).toBe('Escape')
  })
})

describe('compareShortcuts', () => {
  it('returns true for identical shortcuts', () => {
    const a: Shortcut = { key: 's', ctrl: true }
    const b: Shortcut = { key: 's', ctrl: true }
    expect(compareShortcuts(a, b)).toBe(true)
  })

  it('is case-insensitive on key', () => {
    const a: Shortcut = { key: 'S', ctrl: true }
    const b: Shortcut = { key: 's', ctrl: true }
    expect(compareShortcuts(a, b)).toBe(true)
  })

  it('returns false when ctrl differs', () => {
    expect(compareShortcuts({ key: 's', ctrl: true }, { key: 's', ctrl: false })).toBe(false)
  })

  it('returns false when meta differs', () => {
    expect(compareShortcuts({ key: 's', meta: true }, { key: 's', meta: false })).toBe(false)
  })

  it('returns false when shift differs', () => {
    expect(compareShortcuts({ key: 's', shift: true }, { key: 's', shift: false })).toBe(false)
  })

  it('returns false when alt differs', () => {
    expect(compareShortcuts({ key: 's', alt: true }, { key: 's', alt: false })).toBe(false)
  })

  it('returns false when key differs', () => {
    expect(compareShortcuts({ key: 's', ctrl: true }, { key: 'a', ctrl: true })).toBe(false)
  })
})

describe('matchesShortcut', () => {
  it('returns true for matching key and modifier', () => {
    // 显式设置所有修饰符以避免 undefined !== false 误判
    const event = withModifiers(makeKeyEvent('s'), { ctrl: true })
    const shortcut: Shortcut = { key: 's', ctrl: true, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(true)
  })

  it('is case-insensitive on key', () => {
    const event = makeKeyEvent('S')
    const shortcut: Shortcut = { key: 's', ctrl: false, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(true)
  })

  it('returns false when key does not match', () => {
    const event = makeKeyEvent('a')
    const shortcut: Shortcut = { key: 's', ctrl: false, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(false)
  })

  it('returns false when required modifier is missing', () => {
    const event = makeKeyEvent('s')
    const shortcut: Shortcut = { key: 's', ctrl: true, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(false)
  })

  it('returns false when modifier does not match', () => {
    const event = withModifiers(makeKeyEvent('s'), { ctrl: true })
    const shortcut: Shortcut = { key: 's', ctrl: false, meta: true, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(false)
  })

  it('returns false when shift mismatch', () => {
    const event = withModifiers(makeKeyEvent('s'), { shift: true })
    const shortcut: Shortcut = { key: 's', ctrl: false, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(false)
  })

  it('returns false when alt mismatch', () => {
    const event = withModifiers(makeKeyEvent('s'), { alt: true })
    const shortcut: Shortcut = { key: 's', ctrl: false, meta: false, shift: false, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(false)
  })

  it('returns true for multi-modifier combo', () => {
    const event = withModifiers(makeKeyEvent('s'), { ctrl: true, shift: true })
    const shortcut: Shortcut = { key: 's', ctrl: true, meta: false, shift: true, alt: false }
    expect(matchesShortcut(event, shortcut)).toBe(true)
  })
})

describe('platformAdapter singleton', () => {
  it('exposes all adapter functions', () => {
    expect(platformAdapter.adaptShortcutToPlatform).toBe(adaptShortcutToPlatform)
    expect(platformAdapter.getPlatformShortcut).toBe(getPlatformShortcut)
    expect(platformAdapter.formatShortcut).toBe(formatShortcut)
    expect(platformAdapter.getKeyDisplayName).toBe(getKeyDisplayName)
    expect(platformAdapter.parseShortcut).toBe(parseShortcut)
    expect(platformAdapter.getOriginalKey).toBe(getOriginalKey)
    expect(platformAdapter.compareShortcuts).toBe(compareShortcuts)
    expect(platformAdapter.matchesShortcut).toBe(matchesShortcut)
  })
})
