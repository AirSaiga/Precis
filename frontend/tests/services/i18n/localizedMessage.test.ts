/**
 * @file localizedMessage.test.ts
 * @description LocalizedMessage 结构与 loc 工厂的纯逻辑单测
 *
 * 镜像源文件路径：src/services/i18n/localizedMessage.ts
 */
import { describe, it, expect } from 'vitest'
import { loc, type LocalizedMessage } from '@/services/i18n/localizedMessage'

describe('loc()', () => {
  it('构造基础 LocalizedMessage（key + fallback）', () => {
    const msg = loc('validation.notNull.valueEmpty', '值不能为空')
    expect(msg).toEqual({ key: 'validation.notNull.valueEmpty', fallback: '值不能为空' })
  })

  it('带 params 时透传', () => {
    const msg = loc('validation.rowError', '第 N 行错误', { row: 3 })
    expect(msg.params).toEqual({ row: 3 })
  })

  it('fallback 为空时抛错（保证 UI 不空白）', () => {
    expect(() => loc('some.key', '')).toThrow('fallback 不能为空')
  })

  it('返回值满足 LocalizedMessage 类型', () => {
    const msg: LocalizedMessage = loc('a.b', 'c')
    expect(msg.key).toBe('a.b')
    expect(msg.fallback).toBe('c')
  })
})
