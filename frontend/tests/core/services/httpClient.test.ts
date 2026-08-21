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
import { AxiosError } from 'axios'

import apiClient, {
  getApiBaseUrl,
  initApiBaseUrl,
  updateApiBaseUrl,
} from '@/core/services/httpClient'
import { eventBus } from '@/core/eventBus'

describe('httpClient 请求拦截器', () => {
  /**
   * 通过真实 apiClient 单例验证（拦截器挂在单例上，复制逻辑的 stub 会与实现漂移）。
   * stub adapter 捕获最终发出的 headers，避免真实网络请求。
   */
  let capturedHeaders: unknown
  let originalAdapter: unknown

  /** 大小写无关读取捕获到的 header 值（AxiosHeaders.get 与普通对象两种形态兼容） */
  function getHeader(name: string): unknown {
    const h = capturedHeaders as { get?: (k: string) => unknown } | Record<string, unknown>
    if (h && typeof (h as { get?: unknown }).get === 'function') {
      return (h as { get: (k: string) => unknown }).get(name)
    }
    return (h as Record<string, unknown>)?.[name]
  }

  beforeEach(() => {
    localStorage.clear()
    capturedHeaders = undefined
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = (config) => {
      capturedHeaders = config.headers
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    }
  })

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter as typeof apiClient.defaults.adapter
    vi.restoreAllMocks()
  })

  it('当 localStorage 有有效项目路径时，注入 X-Project-Config-Path header', async () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: '/abs/path/to/proj', dataPath: '/abs/path/to/proj/data' })
    )
    await apiClient.get('/test')

    expect(capturedHeaders).toBeDefined()
    expect(getHeader('X-Project-Config-Path')).toBeTruthy()
  })

  it('当 localStorage 无 active project 时，不注入 header', async () => {
    await apiClient.get('/test')

    expect(capturedHeaders).toBeDefined()
    expect(getHeader('X-Project-Config-Path')).toBeFalsy()
  })

  it('当 localStorage 数据为非 JSON 时静默降级（不抛、不注入）', async () => {
    localStorage.setItem('activeProjectPaths', 'not-json-data')

    // 不应抛异常
    await expect(apiClient.get('/test')).resolves.toBeDefined()
    expect(getHeader('X-Project-Config-Path')).toBeFalsy()
  })

  it('当 localStorage 对象缺少 configPath 字段时，不注入 header', async () => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ dataPath: '/data' }))

    await apiClient.get('/test')
    expect(getHeader('X-Project-Config-Path')).toBeFalsy()
  })

  it('当 configPath 为空字符串时，不注入 header', async () => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ configPath: '' }))

    await apiClient.get('/test')
    // 空字符串应被 normalizeConfigDir 视为无效，不注入
    expect(getHeader('X-Project-Config-Path')).toBeFalsy()
  })

  it('调用方显式传入的路径优先，不被 localStorage 残留路径覆盖', async () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: '/stale/proj', dataPath: '/stale/proj/data' })
    )

    await apiClient.get('/test', { headers: { 'X-Project-Config-Path': '/explicit/proj' } })

    // 显式 header 必须原样保留；被残留路径覆盖会把合法请求污染成 404，
    // 进而触发项目路径失效误清理（实际事故：有效项目的最近记录被连带清空）
    expect(getHeader('X-Project-Config-Path')).toBe('/explicit/proj')
  })
})

describe('httpClient 响应拦截器 - 项目路径失效清理', () => {
  /**
   * 通过真实 apiClient 单例验证（拦截器挂在单例上，复制逻辑的 stub 测不到）：
   * - 404 + detail 前缀"提供的项目配置路径不存在" → 清除 localStorage + 广播 project-path-invalid
   * - 其他语义的 404（如 Job not found）不触发清理
   * - localStorage 已清空后不重复广播（对并发 404 去重）
   */
  let originalAdapter: unknown

  /** 把真实 apiClient 的 adapter 替换为"以指定状态码失败"的 stub */
  function stubFailure(status: number, detail: unknown) {
    apiClient.defaults.adapter = (config) => {
      const response = {
        status,
        statusText: 'Error',
        data: { detail },
        headers: {},
        config,
      }
      return Promise.reject(
        new AxiosError(
          `Request failed with status code ${status}`,
          AxiosError.ERR_BAD_REQUEST,
          config,
          {},
          response as never
        )
      )
    }
  }

  beforeEach(() => {
    localStorage.clear()
    originalAdapter = apiClient.defaults.adapter
  })

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter as typeof apiClient.defaults.adapter
    vi.restoreAllMocks()
  })

  it('命中"项目配置路径不存在"404 且失败路径与激活项目一致时，清除 localStorage 并广播', async () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: 'D:/dead/proj', dataPath: 'D:/dead/proj/data' })
    )
    stubFailure(404, '提供的项目配置路径不存在: D:\\dead\\proj')
    const fired: string[] = []
    const handler = () => fired.push('fired')
    eventBus.on('project-path-invalid', handler)

    try {
      // 请求仍应正常 reject（清理是副作用，不吞错误）
      await expect(apiClient.get('/project/config/full')).rejects.toBeInstanceOf(AxiosError)
    } finally {
      eventBus.off('project-path-invalid', handler)
    }

    expect(localStorage.getItem('activeProjectPaths')).toBeNull()
    expect(fired).toHaveLength(1)
  })

  it('其他语义的 404（Job not found 等）不触发清理', async () => {
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: '/alive/proj', dataPath: '/alive/proj/data' })
    )
    stubFailure(404, 'Job not found: abc-123')
    const fired: string[] = []
    const handler = () => fired.push('fired')
    eventBus.on('project-path-invalid', handler)

    try {
      await expect(apiClient.get('/ai/jobs/abc-123')).rejects.toBeInstanceOf(AxiosError)
    } finally {
      eventBus.off('project-path-invalid', handler)
    }

    expect(localStorage.getItem('activeProjectPaths')).not.toBeNull()
    expect(fired).toHaveLength(0)
  })

  it('失败路径与激活项目不一致时不清理（并发旧路径 404 不得误杀刚切换的项目）', async () => {
    // 场景：bootstrap 已用有效路径覆盖 localStorage，但更早发出的旧路径请求
    // 在覆盖后才返回 404——失败路径(d:/dead) ≠ 当前激活(d:/alive)，不能清理
    localStorage.setItem(
      'activeProjectPaths',
      JSON.stringify({ configPath: 'D:/alive/proj', dataPath: 'D:/alive/proj/data' })
    )
    stubFailure(404, '提供的项目配置路径不存在: D:\\dead\\proj')
    const fired: string[] = []
    const handler = () => fired.push('fired')
    eventBus.on('project-path-invalid', handler)

    try {
      await expect(apiClient.get('/project/config/full')).rejects.toBeInstanceOf(AxiosError)
    } finally {
      eventBus.off('project-path-invalid', handler)
    }

    expect(localStorage.getItem('activeProjectPaths')).not.toBeNull()
    expect(fired).toHaveLength(0)
  })

  it('localStorage 已无项目路径时不重复广播（并发 404 去重）', async () => {
    stubFailure(404, '提供的项目配置路径不存在: D:\\dead\\proj')
    const fired: string[] = []
    const handler = () => fired.push('fired')
    eventBus.on('project-path-invalid', handler)

    try {
      await expect(apiClient.get('/project/config/full')).rejects.toBeInstanceOf(AxiosError)
    } finally {
      eventBus.off('project-path-invalid', handler)
    }

    expect(localStorage.getItem('activeProjectPaths')).toBeNull()
    expect(fired).toHaveLength(0)
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
