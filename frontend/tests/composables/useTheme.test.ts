import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  applyThemePreference,
  resolveThemePreference,
  getSystemResolvedTheme,
  getStoredThemePreference,
  getThemeMediaQuery,
} from '@/core/utils/theme'

describe('theme utilities', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.documentElement.style.colorScheme = ''
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves light preference directly', () => {
    expect(resolveThemePreference('light')).toBe('light')
  })

  it('resolves dark preference directly', () => {
    expect(resolveThemePreference('dark')).toBe('dark')
  })

  it('resolves liquid preference directly', () => {
    expect(resolveThemePreference('liquid')).toBe('liquid')
  })

  it('resolves system preference based on matchMedia', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true })
    window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia
    expect(resolveThemePreference('system')).toBe('dark')
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-color-scheme: dark)')

    matchMediaMock.mockReturnValue({ matches: false })
    expect(resolveThemePreference('system')).toBe('light')
  })

  it('applies theme to document element', () => {
    applyThemePreference('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('applies liquid theme with light color-scheme', () => {
    applyThemePreference('liquid')
    expect(document.documentElement.getAttribute('data-theme')).toBe('liquid')
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('liquid')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('applies system theme with resolved value', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    applyThemePreference('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('system')
  })

  it('getSystemResolvedTheme returns dark when matchMedia matches', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    expect(getSystemResolvedTheme()).toBe('dark')
  })

  it('getSystemResolvedTheme returns light when matchMedia does not match', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    expect(getSystemResolvedTheme()).toBe('light')
  })

  it('getStoredThemePreference returns system when nothing stored', () => {
    expect(getStoredThemePreference()).toBe('system')
  })

  it('getStoredThemePreference reads from localStorage', () => {
    localStorage.setItem('generalSettings', JSON.stringify({ theme: 'dark' }))
    expect(getStoredThemePreference()).toBe('dark')
  })

  it('getStoredThemePreference reads liquid theme from localStorage', () => {
    localStorage.setItem('generalSettings', JSON.stringify({ theme: 'liquid' }))
    expect(getStoredThemePreference()).toBe('liquid')
  })

  it('getStoredThemePreference returns system for invalid JSON', () => {
    localStorage.setItem('generalSettings', 'not-json')
    expect(getStoredThemePreference()).toBe('system')
  })

  it('getStoredThemePreference returns system for missing theme key', () => {
    localStorage.setItem('generalSettings', JSON.stringify({ other: 'value' }))
    expect(getStoredThemePreference()).toBe('system')
  })

  it('getThemeMediaQuery returns matchMedia result', () => {
    const mq = { matches: false } as MediaQueryList
    window.matchMedia = vi.fn().mockReturnValue(mq) as unknown as typeof window.matchMedia
    expect(getThemeMediaQuery()).toBe(mq)
  })
})
