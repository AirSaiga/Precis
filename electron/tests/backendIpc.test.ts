/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
/**
 * @fileoverview backend IPC（restart-python-server）单元测试
 *
 * 覆盖 F3 修复契约：restart 结果必须携带 appState.backendApiToken 新 token，
 * 供渲染进程刷新内存态（软重启会重新生成一次性 token，不下发则旧 token 全请求被拒）。
 *
 * 测试策略：mock 外部边界（electron ipcMain / pythonProcess / logger），
 * appState 用真实模块（纯状态容器），每次 vi.resetModules 隔离。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  /** ipcMain.handle 注册表 */
  handlers: {} as Record<string, () => unknown>,
  startPythonServer: vi.fn(),
  stopPythonServer: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => {
      mocks.handlers[channel] = handler
    },
  },
}))

vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../src/pythonProcess', () => ({
  startPythonServer: mocks.startPythonServer,
  stopPythonServer: mocks.stopPythonServer,
}))

/** 重置模块图并重新注册 IPC（每次测试独立的 appState 与注册表） */
async function freshBackend() {
  vi.resetModules()
  for (const key of Object.keys(mocks.handlers)) delete mocks.handlers[key]
  mocks.startPythonServer.mockReset()
  mocks.stopPythonServer.mockReset().mockResolvedValue(undefined)
  // 默认模拟一次成功重启（mockReset 后需重设默认实现）
  mocks.startPythonServer.mockResolvedValue(8765)
  const backendMod = await import('../src/ipc/backend')
  backendMod.registerBackendIpc({ backendPath: '/mock/backend', frontendDevPort: 5173 })
  const { appState } = await import('../src/app-state')
  return appState
}

describe('restart-python-server（F3：结果携带新 token）', () => {
  it('重启成功时返回 ready/port 与 appState 当前 token', async () => {
    const appState = await freshBackend()
    // startPythonServer 每次启动重新生成 token 并存入 appState（真实行为由被测模块消费）
    appState.backendApiToken = 'fresh-token-after-restart'

    const result = (await mocks.handlers['restart-python-server']()) as Record<string, unknown>

    expect(result.ready).toBe(true)
    expect(result.port).toBe(8765)
    expect(result.token).toBe('fresh-token-after-restart')
    expect(mocks.stopPythonServer).toHaveBeenCalledTimes(1)
    expect(mocks.startPythonServer).toHaveBeenCalledTimes(1)
  })

  it('重启失败时仍返回当前 token，渲染进程可与主进程对齐', async () => {
    const appState = await freshBackend()
    appState.backendApiToken = 'regen-token-then-fail'
    appState.currentPythonServerPort = 4321
    mocks.startPythonServer.mockRejectedValue(new Error('spawn failed'))

    const result = (await mocks.handlers['restart-python-server']()) as Record<string, unknown>

    expect(result.ready).toBe(false)
    expect(result.error).toBe('spawn failed')
    expect(result.token).toBe('regen-token-then-fail')
  })

  it('并发调用复用同一次重启（互斥），两次 invoke 拿到同一 token', async () => {
    const appState = await freshBackend()
    let resolveStart: ((port: number) => void) | null = null
    mocks.startPythonServer.mockImplementation(
      () => new Promise<number>((resolve) => (resolveStart = resolve)),
    )

    const first = mocks.handlers['restart-python-server']() as Promise<Record<string, unknown>>
    const second = mocks.handlers['restart-python-server']() as Promise<Record<string, unknown>>
    appState.backendApiToken = 'concurrent-token'
    // handler 内先 await stopPythonServer 才调 startPythonServer：等微任务跑完，
    // mock 的 pending Promise 建立后再放行
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveStart!(9000)

    const [r1, r2] = await Promise.all([first, second])
    expect(mocks.startPythonServer).toHaveBeenCalledTimes(1)
    expect(r1.token).toBe('concurrent-token')
    expect(r2).toEqual(r1)
  })
})
