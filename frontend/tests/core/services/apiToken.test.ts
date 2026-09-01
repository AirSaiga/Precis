/**
 * @file apiToken.test.ts
 * @description 后端 API token 模块级存取单元测试（纯逻辑）
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { setApiToken, getApiToken, hasApiToken } from '@/core/services/apiToken'

describe('apiToken 模块级存取', () => {
  beforeEach(() => {
    // 模块级单例状态：每个用例前重置，保证测试隔离
    setApiToken('')
  })

  it('初始状态（未设置）时 token 为空串且 hasApiToken 为 false', () => {
    expect(getApiToken()).toBe('')
    expect(hasApiToken()).toBe(false)
  })

  it('setApiToken 后可读回同一值，hasApiToken 为 true', () => {
    const token = 'a'.repeat(64)
    setApiToken(token)
    expect(getApiToken()).toBe(token)
    expect(hasApiToken()).toBe(true)
  })

  it('setApiToken 传空串表示清除，hasApiToken 回到 false', () => {
    setApiToken('token-value')
    setApiToken('')
    expect(hasApiToken()).toBe(false)
  })

  it('重复 setApiToken 以后设置的值为准', () => {
    setApiToken('first')
    setApiToken('second')
    expect(getApiToken()).toBe('second')
  })
})
