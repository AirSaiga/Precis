/**
 * @fileoverview splash-preload.ts IPC 接口测试
 *
 * 测试策略(镜像 preload.test.ts):
 * - Mock electron 模块(contextBridge + ipcRenderer)
 * - 捕获 exposeInMainWorld 接收的 splashAPI 对象
 * - 测试 onStage(监听注册 + 回调触发 + 取消监听)
 * - 测试 getVersion(invoke 调用 + 返回值透传)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockInvoke, mockOn, mockRemoveListener, exposedApi } = vi.hoisted(() => {
  return {
    mockInvoke: vi.fn(),
    mockOn: vi.fn(),
    mockRemoveListener: vi.fn(),
    exposedApi: {} as Record<string, unknown>,
  }
})

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      Object.assign(exposedApi, api)
    },
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
}))

// 导入 splash-preload 触发 side-effect(调用 exposeInMainWorld)
import '../src/splash-preload'

beforeEach(() => {
  mockInvoke.mockReset()
  mockOn.mockReset()
  mockRemoveListener.mockReset()
})

describe('splashAPI.onStage', () => {
  it('注册监听时调用 ipcRenderer.on,通道名为 splash:stage', () => {
    const cb = vi.fn()
    const onStage = exposedApi.onStage as (cb: (d: { stage: string }) => void) => () => void
    onStage(cb)
    expect(mockOn).toHaveBeenCalledTimes(1)
    expect(mockOn).toHaveBeenCalledWith('splash:stage', expect.any(Function))
  })

  it('当 ipcRenderer.on 注册的 handler 被调用时,回调收到数据', () => {
    const cb = vi.fn()
    const onStage = exposedApi.onStage as (cb: (d: { stage: string; error?: boolean }) => void) => () => void
    onStage(cb)
    // 取出 mockOn 收到的 handler(第二个参数),模拟主进程 send
    const handler = mockOn.mock.calls[0][1] as (e: unknown, d: { stage: string }) => void
    handler(null, { stage: 'connecting' })
    expect(cb).toHaveBeenCalledWith({ stage: 'connecting' })
  })

  it('返回的取消函数调用 ipcRenderer.removeListener', () => {
    const cb = vi.fn()
    const onStage = exposedApi.onStage as (cb: (d: { stage: string }) => void) => () => void
    const unsubscribe = onStage(cb)
    const handler = mockOn.mock.calls[0][1]
    unsubscribe()
    expect(mockRemoveListener).toHaveBeenCalledTimes(1)
    expect(mockRemoveListener).toHaveBeenCalledWith('splash:stage', handler)
  })
})

describe('splashAPI.getVersion', () => {
  it('调用 ipcRenderer.invoke,通道名为 splash:get-version', async () => {
    mockInvoke.mockResolvedValue('0.1.0')
    const getVersion = exposedApi.getVersion as () => Promise<string>
    const result = await getVersion()
    expect(mockInvoke).toHaveBeenCalledWith('splash:get-version')
    expect(result).toBe('0.1.0')
  })

  it('invoke 失败时错误透传', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'))
    const getVersion = exposedApi.getVersion as () => Promise<string>
    await expect(getVersion()).rejects.toThrow('boom')
  })
})
