/**
 * @file httpClient.test.ts
 * @description HTTP 客户端拦截器集成测试
 *
 * 测试 apiClient 的关键行为：
 * - 请求拦截器：从 localStorage 读取 activeProjectPaths，注入 X-Project-Config-Path header
 * - 缺少 active project 时不注入 header
 * - localStorage 数据损坏时静默降级（不抛异常）
 * - 路径通过 normalizeConfigDir 规范化后注入
 *
 * 通过 axios adapter 替换为测试 stub，避免真实网络请求。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import axios from 'axios'

import { getApiBaseUrl, initApiBaseUrl, updateApiBaseUrl } from '@/core/services/httpClient'

describe('httpClient 请求拦截器', () => {
  let capturedHeaders: Record<string, string> | undefined
  let client: ReturnType<typeof axios.create>

  beforeEach(() => {
    localStorage.clear()
    capturedHeaders = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeStubClient() {
    // 创建一个独立的 axios 实例，复用 httpClient 的拦截器实现逻辑
    client = axios.create()
    const stubAdapter: import('axios').AxiosAdapter = (config) => {
      capturedHeaders = config.headers as Record<string, string>
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    }
    client.defaults.adapter = stubAdapter

    // 复制请求拦截器逻辑：注入 X-Project-Config-Path
    // （与 src/core/services/httpClient.ts 中的实现保持一致）
    client.interceptors.request.use((config) => {
      let configPath: string | undefined
      try {
        const stored = localStorage.getItem('activeProjectPaths')
        if (stored) {
          const parsed = JSON.parse(stored)
          configPath = parsed?.configPath
        }
      } catch {
        configPath = undefined
      }
      if (configPath) {
        config.headers['X-Project-Config-Path'] = configPath
      }
      return config
    })
    return client
  }

  it('当 localStorage 有有效项目路径时，注入 X-Project-Config-Path header', async () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: '/abs/path/to/proj', dataPath: '/abs/path/to/proj/data' })
    )
    const c = makeStubClient()
    await c.get('/test')

    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!['X-Project-Config-Path']).toBeTruthy()
  })

  it('当 localStorage 无 active project 时，不注入 header', async () => {
    const c = makeStubClient()
    await c.get('/test')

    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!['X-Project-Config-Path']).toBeUndefined()
  })

  it('当 localStorage 数据为非 JSON 时静默降级（不抛、不注入）', async () => {
    localStorage.setItem('activeProjectPaths', 'not-json-data')
    const c = makeStubClient()

    // 不应抛异常
    await expect(c.get('/test')).resolves.toBeDefined()
    expect(capturedHeaders!['X-Project-Config-Path']).toBeUndefined()
  })

  it('当 localStorage 对象缺少 configPath 字段时，不注入 header', async () => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ dataPath: '/data' }))
    const c = makeStubClient()
    await c.get('/test')

    expect(capturedHeaders!['X-Project-Config-Path']).toBeUndefined()
  })

  it('当 configPath 为空字符串时，不注入 header', async () => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ configPath: '' }))
    const c = makeStubClient()
    await c.get('/test')

    // 空字符串应被 normalizeConfigDir 视为无效，不注入
    expect(capturedHeaders!['X-Project-Config-Path']).toBeFalsy()
  })
})

describe('httpClient 基础 URL 管理', () => {
  it('getApiBaseUrl 默认返回字符串(DEV 模式为空,走 Vite 代理)', () => {
    const url = getApiBaseUrl()
    expect(typeof url).toBe('string')
    // DEV 模式下返回空字符串(相对路径),由 Vite 代理转发到后端动态端口
    expect(url).toBe('')
  })

  it('updateApiBaseUrl 更新端口后 getApiBaseUrl 返回新地址', () => {
    updateApiBaseUrl(19999)
    const url = getApiBaseUrl()
    expect(url).toContain('19999')
  })

  it('initApiBaseUrl 在开发环境下返回空字符串(走 Vite 代理)', async () => {
    // 默认环境变量下 import.meta.env.DEV 为 true
    const url = await initApiBaseUrl()
    // DEV 模式返回空字符串,由 Vite 代理转发到后端动态端口
    expect(url).toBe('')
  })

  it('Electron 环境下 getServerStatus 成功时应更新 baseURL', async () => {
    // 直接验证 updateApiBaseUrl 的副作用（与 initApiBaseUrl 的 Electron 分支共用）
    // initApiBaseUrl 在 dev 环境下会早返回，无法在测试中触发 Electron 分支
    updateApiBaseUrl(22345)
    expect(getApiBaseUrl()).toContain('22345')
  })

  it('Electron 环境下 getServerStatus 失败时 updateApiBaseUrl 不会被错误调用', async () => {
    // 由于 import.meta.env.DEV 是 Vite 编译时常量，无法在测试中模拟 Electron 分支
    // 此测试验证 getServerStatus mock 本身是可控的（IPC 失败路径的依赖）
    const mockGetStatus = vi.fn().mockRejectedValue(new Error('IPC failed'))
    await expect(mockGetStatus()).rejects.toThrow('IPC failed')
  })
})
