import { describe, it, expect, vi } from 'vitest'
import { ProjectNotFoundError, withConfigPathHeader, isProjectNotFound } from '@/api/projectV2Api/shared'

describe('ProjectNotFoundError', () => {
  it('包含默认错误消息', () => {
    const err = new ProjectNotFoundError()
    expect(err.message).toBe('项目未找到')
    expect(err.name).toBe('ProjectNotFoundError')
    expect(err.configPath).toBeUndefined()
  })

  it('包含 configPath 的错误消息', () => {
    const err = new ProjectNotFoundError('/path/to/project')
    expect(err.message).toBe('项目未找到: /path/to/project')
    expect(err.configPath).toBe('/path/to/project')
  })

  it('是 Error 的子类', () => {
    const err = new ProjectNotFoundError()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ProjectNotFoundError)
  })
})

describe('withConfigPathHeader', () => {
  it('configPath 存在时返回 headers', () => {
    const result = withConfigPathHeader('/test/project')
    expect(result).toEqual({
      headers: { 'X-Project-Config-Path': '/test/project' },
    })
  })

  it('configPath 为空字符串时返回 undefined', () => {
    expect(withConfigPathHeader('')).toBeUndefined()
  })

  it('configPath 为 undefined 时返回 undefined', () => {
    expect(withConfigPathHeader(undefined)).toBeUndefined()
  })
})

describe('isProjectNotFound', () => {
  function makeAxiosError(status: number): unknown {
    return {
      isAxiosError: true,
      response: { status },
    }
  }

  it('status 404 返回 true', () => {
    expect(isProjectNotFound(makeAxiosError(404))).toBe(true)
  })

  it('status 非 404 返回 false', () => {
    expect(isProjectNotFound(makeAxiosError(500))).toBe(false)
    expect(isProjectNotFound(makeAxiosError(400))).toBe(false)
    expect(isProjectNotFound(makeAxiosError(200))).toBe(false)
  })

  it('非 Axios 错误返回 false', () => {
    expect(isProjectNotFound(new Error('test'))).toBe(false)
    expect(isProjectNotFound('string')).toBe(false)
    expect(isProjectNotFound(null)).toBe(false)
    expect(isProjectNotFound(undefined)).toBe(false)
  })
})
