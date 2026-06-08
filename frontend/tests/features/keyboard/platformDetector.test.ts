import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  detectPlatform,
  isMac,
  isWindows,
  isLinux,
  getPlatformDisplayName,
  getPlatformInfo,
  getPrimaryModifierKey,
  getSecondaryModifierKey,
  detectKeyboardLayout,
  hasFunctionKeys,
  platformDetector,
} from '@/features/keyboard/platform/detector'

function mockNavigator(platform: string, language = 'en-US'): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, language },
    configurable: true,
    writable: true,
  })
}

describe('detectPlatform', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects macOS via MacIntel platform', () => {
    mockNavigator('MacIntel')
    expect(detectPlatform()).toBe('mac')
  })

  it('detects macOS via MacPPC platform', () => {
    mockNavigator('MacPPC')
    expect(detectPlatform()).toBe('mac')
  })

  it('detects macOS via iPhone platform', () => {
    mockNavigator('iPhone')
    expect(detectPlatform()).toBe('mac')
  })

  it('detects macOS via iPad platform', () => {
    mockNavigator('iPad')
    expect(detectPlatform()).toBe('mac')
  })

  it('detects Windows via Win32 platform', () => {
    mockNavigator('Win32')
    expect(detectPlatform()).toBe('windows')
  })

  it('detects Windows via Win64 platform', () => {
    mockNavigator('Win64')
    expect(detectPlatform()).toBe('windows')
  })

  it('detects Linux via Linux platform', () => {
    mockNavigator('Linux x86_64')
    expect(detectPlatform()).toBe('linux')
  })

  it('returns unknown for unrecognized platform', () => {
    mockNavigator('SunOS')
    expect(detectPlatform()).toBe('unknown')
  })

  it('excludes Android from Linux', () => {
    mockNavigator('Linux armv81 Android')
    expect(detectPlatform()).toBe('unknown')
  })
})

describe('isMac / isWindows / isLinux', () => {
  it('isMac returns true for Mac platform', () => {
    mockNavigator('MacIntel')
    expect(isMac()).toBe(true)
    expect(isWindows()).toBe(false)
    expect(isLinux()).toBe(false)
  })

  it('isWindows returns true for Windows platform', () => {
    mockNavigator('Win32')
    expect(isMac()).toBe(false)
    expect(isWindows()).toBe(true)
    expect(isLinux()).toBe(false)
  })

  it('isLinux returns true for Linux platform', () => {
    mockNavigator('Linux x86_64')
    expect(isMac()).toBe(false)
    expect(isWindows()).toBe(false)
    expect(isLinux()).toBe(true)
  })

  it('all return false for unknown platform', () => {
    mockNavigator('SomeOS')
    expect(isMac()).toBe(false)
    expect(isWindows()).toBe(false)
    expect(isLinux()).toBe(false)
  })
})

describe('getPlatformDisplayName', () => {
  it('returns macOS for mac', () => {
    expect(getPlatformDisplayName('mac')).toBe('macOS')
  })

  it('returns Windows for windows', () => {
    expect(getPlatformDisplayName('windows')).toBe('Windows')
  })

  it('returns Linux for linux', () => {
    expect(getPlatformDisplayName('linux')).toBe('Linux')
  })

  it('returns Unknown for unknown', () => {
    expect(getPlatformDisplayName('unknown')).toBe('Unknown')
  })
})

describe('getPlatformInfo', () => {
  it('returns full info for Mac', () => {
    mockNavigator('MacIntel')
    const info = getPlatformInfo()
    expect(info).toEqual({
      type: 'mac',
      isMac: true,
      isWindows: false,
      isLinux: false,
      displayName: 'macOS',
    })
  })

  it('returns full info for Windows', () => {
    mockNavigator('Win32')
    const info = getPlatformInfo()
    expect(info).toEqual({
      type: 'windows',
      isMac: false,
      isWindows: true,
      isLinux: false,
      displayName: 'Windows',
    })
  })

  it('returns full info for Linux', () => {
    mockNavigator('Linux x86_64')
    const info = getPlatformInfo()
    expect(info).toEqual({
      type: 'linux',
      isMac: false,
      isWindows: false,
      isLinux: true,
      displayName: 'Linux',
    })
  })
})

describe('getPrimaryModifierKey', () => {
  it('returns meta on Mac', () => {
    mockNavigator('MacIntel')
    expect(getPrimaryModifierKey()).toBe('meta')
  })

  it('returns ctrl on Windows', () => {
    mockNavigator('Win32')
    expect(getPrimaryModifierKey()).toBe('ctrl')
  })

  it('returns ctrl on Linux', () => {
    mockNavigator('Linux x86_64')
    expect(getPrimaryModifierKey()).toBe('ctrl')
  })
})

describe('getSecondaryModifierKey', () => {
  it('returns ctrl on Mac', () => {
    mockNavigator('MacIntel')
    expect(getSecondaryModifierKey()).toBe('ctrl')
  })

  it('returns alt on Windows', () => {
    mockNavigator('Win32')
    expect(getSecondaryModifierKey()).toBe('alt')
  })

  it('returns alt on Linux', () => {
    mockNavigator('Linux x86_64')
    expect(getSecondaryModifierKey()).toBe('alt')
  })
})

describe('detectKeyboardLayout', () => {
  it('returns jis for Japanese language', () => {
    mockNavigator('MacIntel', 'ja-JP')
    expect(detectKeyboardLayout()).toBe('jis')
  })

  it('returns jis for Chinese language', () => {
    mockNavigator('Win32', 'zh-CN')
    expect(detectKeyboardLayout()).toBe('jis')
  })

  it('returns ansi for English language', () => {
    mockNavigator('Win32', 'en-US')
    expect(detectKeyboardLayout()).toBe('ansi')
  })

  it('returns ansi for other languages', () => {
    mockNavigator('Win32', 'fr-FR')
    expect(detectKeyboardLayout()).toBe('ansi')
  })
})

describe('hasFunctionKeys', () => {
  it('always returns true', () => {
    expect(hasFunctionKeys()).toBe(true)
  })
})

describe('platformDetector singleton', () => {
  it('exposes all detector functions', () => {
    expect(platformDetector.detectPlatform).toBe(detectPlatform)
    expect(platformDetector.isMac).toBe(isMac)
    expect(platformDetector.isWindows).toBe(isWindows)
    expect(platformDetector.isLinux).toBe(isLinux)
    expect(platformDetector.getPlatformDisplayName).toBe(getPlatformDisplayName)
    expect(platformDetector.getPlatformInfo).toBe(getPlatformInfo)
    expect(platformDetector.getPrimaryModifierKey).toBe(getPrimaryModifierKey)
    expect(platformDetector.getSecondaryModifierKey).toBe(getSecondaryModifierKey)
    expect(platformDetector.detectKeyboardLayout).toBe(detectKeyboardLayout)
    expect(platformDetector.hasFunctionKeys).toBe(hasFunctionKeys)
  })
})
