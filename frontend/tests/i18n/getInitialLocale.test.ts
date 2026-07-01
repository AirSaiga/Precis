/**
 * @file getInitialLocale.test.ts
 * @description B1 修复:i18n 启动 locale 从 localStorage 恢复的单测
 *
 * 验证 getInitialLocale 直接读 localStorage 原始字符串(不依赖 store),
 * 正确恢复用户语言偏好,失败时安全回退 zh-CN。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 用动态导入 + vi.resetModules 确保每个测试拿到干净的模块实例
async function loadGetInitialLocale() {
  vi.resetModules()
  const mod = await import('@/i18n')
  return (mod as unknown as { __getInitialLocaleForTest?: () => string }).__getInitialLocaleForTest
}

describe('getInitialLocale (B1 i18n 启动恢复)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('localStorage 有 en-US 时返回 en-US', async () => {
    localStorage.setItem('generalSettings', JSON.stringify({ language: 'en-US' }))
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale).toBeDefined()
    expect(getInitialLocale!()).toBe('en-US')
  })

  it('localStorage 有 zh-CN 时返回 zh-CN', async () => {
    localStorage.setItem('generalSettings', JSON.stringify({ language: 'zh-CN' }))
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale!()).toBe('zh-CN')
  })

  it('localStorage 为空时回退 zh-CN', async () => {
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale!()).toBe('zh-CN')
  })

  it('language 字段为非法值时回退 zh-CN', async () => {
    localStorage.setItem('generalSettings', JSON.stringify({ language: 'fr-FR' }))
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale!()).toBe('zh-CN')
  })

  it('localStorage 是损坏的 JSON 时静默回退 zh-CN', async () => {
    localStorage.setItem('generalSettings', '{not valid json')
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale!()).toBe('zh-CN')
  })

  it('generalSettings 无 language 字段时回退 zh-CN', async () => {
    localStorage.setItem('generalSettings', JSON.stringify({ theme: 'dark' }))
    const getInitialLocale = await loadGetInitialLocale()
    expect(getInitialLocale!()).toBe('zh-CN')
  })
})
