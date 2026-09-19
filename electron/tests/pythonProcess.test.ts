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
 * @fileoverview pythonProcess.startPythonServer 单元测试
 *
 * 覆盖附表12 修复契约：cleanupAndReject 必须清理闭包 proc（本次 spawn 的进程），
 * 而非 appState.pythonProcess——并发二次 start 时全局引用可能已指向 B 的新进程，
 * 按全局清理会误杀 B 并清空其全局引用。
 *
 * 测试策略：mock 外部边界（electron / child_process.spawn / startup-probe / fs / logger），
 * 用 FakeProc（EventEmitter）模拟子进程；killProcessTree 走真实 win32 分支时由
 * spawn mock 对 taskkill 命令自动发 close 放行（非 win32 平台由 try/catch + 2s 宽限兜底）。
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { EventEmitter } from 'events'

const mocks = vi.hoisted(() => {
  return {
    /** spawn 调用记录 */
    spawnCalls: [] as Array<{ cmd: string; args: string[] }>,
    /** 创建的 FakeProc 实例（按创建顺序） */
    procs: [] as unknown[],
  }
})

class FakeProc extends EventEmitter {
  pid: number
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  /** removeAllListeners 被调次数（验证未误清理 B 的进程） */
  removeAllListenersCalls = 0

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  override removeAllListeners(event?: string | symbol): this {
    this.removeAllListenersCalls++
    return super.removeAllListeners(event)
  }
}

let nextPid = 100

/** spawn mock：python 命令创建常驻 FakeProc；taskkill 命令创建后异步发 close 放行 */
function fakeSpawn(cmd: string, args: string[]): FakeProc {
  mocks.spawnCalls.push({ cmd, args: args as string[] })
  const proc = new FakeProc(nextPid++)
  mocks.procs.push(proc)
  if (cmd === 'taskkill') {
    queueMicrotask(() => proc.emit('close', 0))
  }
  return proc
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0-test',
  },
}))

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => fakeSpawn(cmd, args)),
  execSync: vi.fn(),
}))

vi.mock('../src/startup-probe', () => ({
  readBackendPortFile: vi.fn(async () => null),
  waitForApiReady: vi.fn(async () => true),
  containsStartupSignal: vi.fn(() => false),
  looksLikeStderrError: vi.fn(() => false),
  SIGNAL_SCAN_TAIL_CHARS: 4096,
  BACKEND_PORT_FILE: '.backend-port',
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** 重置模块图并导入被测模块（appState 随之隔离） */
async function freshModule() {
  vi.resetModules()
  mocks.spawnCalls.length = 0
  mocks.procs.length = 0
  nextPid = 100
  const mod = await import('../src/pythonProcess')
  const { appState } = await import('../src/app-state')
  return { startPythonServer: mod.startPythonServer, appState }
}

beforeEach(() => {
  vi.clearAllMocks()
})

function taskkillCalls(): Array<{ cmd: string; args: string[] }> {
  return mocks.spawnCalls.filter((c) => c.cmd === 'taskkill')
}

describe('startPythonServer 启动失败清理（附表12：不误杀并发二次 start 的新进程）', () => {
  // 本组用例断言 taskkill 调用（win32 分支的确定性路径——Unix 分支无 taskkill、
  // 且带 2s 宽限期）。附表12 的清理语义（闭包 proc + 全局指针校验）两平台同构，
  // 故在非 Windows 环境（CI Linux runner）也固定 mock 为 win32 验证同一逻辑。
  const realPlatform = process.platform
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })
  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  it('A 清理时 B 已启动：只杀 A 的闭包进程，appState.pythonProcess 仍指向 B', async () => {
    const { startPythonServer, appState } = await freshModule()

    const promiseA = startPythonServer('/mock/backend')
    const procA = mocks.procs[0] as FakeProc
    expect(appState.pythonProcess).toBe(procA)

    // 模拟并发交错：A 尚未失败前，B 的 spawn 已完成并覆写全局引用
    const procB = new FakeProc(202)
    procB.on('exit', () => {}) // B 注册的监听器，验证不被 A 的清理误删
    appState.pythonProcess = procB as never

    procA.emit('error', new Error('boom'))

    await expect(promiseA).rejects.toThrow('Failed to spawn Python server: boom')

    // 只杀了 A（PID 100），未杀 B（PID 202）
    const kills = taskkillCalls()
    expect(kills).toHaveLength(1)
    expect(kills[0].args).toEqual(['/T', '/F', '/PID', '100'])
    // 全局引用仍指向 B，且 B 的监听器未被 removeAllListeners 清掉
    expect(appState.pythonProcess).toBe(procB)
    expect(procB.removeAllListenersCalls).toBe(0)
    expect(procB.listenerCount('exit')).toBe(1)
  })

  it('单次启动失败仍清理全局引用（既有行为回归）', async () => {
    const { startPythonServer, appState } = await freshModule()

    const promiseA = startPythonServer('/mock/backend')
    const procA = mocks.procs[0] as FakeProc
    procA.emit('error', new Error('boom'))

    await expect(promiseA).rejects.toThrow('Failed to spawn Python server: boom')

    expect(appState.pythonProcess).toBeNull()
    expect(appState.isPythonServerReady).toBe(false)
    const kills = taskkillCalls()
    expect(kills).toHaveLength(1)
    expect(kills[0].args).toEqual(['/T', '/F', '/PID', String(procA.pid)])
  })
})
