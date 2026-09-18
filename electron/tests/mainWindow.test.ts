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
 * @fileoverview mainWindow 渲染进程崩溃处理单元测试
 *
 * 覆盖附表14 修复契约：崩溃重启分支走 app.exit()，跳过 before-quit/quit 钩子，
 * 必须在退出前同步 flushLogs()（main.ts 正常退出链是 stopPythonServerSync +
 * flushLogs 成对）；崩溃原因刚被 logger.error 记录，恰是最需落盘的日志。
 * 正常"退出"分支（app.quit）不在本处理器内 flush（由 before-quit 钩子负责）。
 *
 * 测试策略：mock 外部边界（electron BrowserWindow/app/dialog / logger / pythonProcess /
 * splashWindow / paths / feedback / fs），真实 appState，经 webContents 事件发射驱动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const mocks = vi.hoisted(() => ({
  flushLogs: vi.fn(),
  stopPythonServerSync: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
  showMessageBoxSync: vi.fn(),
  writeFileSync: vi.fn(),
  ensureFeedbackDir: vi.fn(),
  getPendingCrashPath: vi.fn(() => '/mock/userData/feedback/pending-crash.json'),
  closeSplashWindow: vi.fn(),
  sendSplashStage: vi.fn(),
  getPreloadPath: vi.fn(() => '/mock/preload.js'),
}))

class FakeWebContents extends EventEmitter {
  send = vi.fn()
  openDevTools = vi.fn()
  setWindowOpenHandler = vi.fn()
  loadURL = vi.fn()
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = []
  webContents = new FakeWebContents()
  show = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn()

  constructor() {
    super()
    FakeBrowserWindow.instances.push(this)
  }
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    relaunch: mocks.relaunch,
    exit: mocks.exit,
    quit: mocks.quit,
  },
  BrowserWindow: FakeBrowserWindow,
  shell: {},
  dialog: {
    showMessageBoxSync: mocks.showMessageBoxSync,
  },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  writeFileSync: mocks.writeFileSync,
}))

vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  flushLogs: mocks.flushLogs,
  getLogFilePath: vi.fn(() => '/mock/userData/logs/main.log'),
  readLogFile: vi.fn(() => ''),
}))

vi.mock('../src/i18n', () => ({ t: (key: string) => key }))

vi.mock('../src/ipc/feedback', () => ({
  ensureFeedbackDir: mocks.ensureFeedbackDir,
  getPendingCrashPath: mocks.getPendingCrashPath,
}))

vi.mock('../src/pythonProcess', () => ({
  stopPythonServerSync: mocks.stopPythonServerSync,
}))

vi.mock('../src/windows/splashWindow', () => ({
  closeSplashWindow: mocks.closeSplashWindow,
  sendSplashStage: mocks.sendSplashStage,
}))

vi.mock('../src/utils/paths', () => ({
  getPreloadPath: mocks.getPreloadPath,
}))

async function freshCreateWindow() {
  vi.resetModules()
  FakeBrowserWindow.instances = []
  const { appState } = await import('../src/app-state')
  const mainWindowMod = await import('../src/windows/mainWindow')
  return { appState, createWindow: mainWindowMod.createWindow }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.showMessageBoxSync.mockReturnValue(0)
})

function emitRenderProcessGone(details: { reason: string; exitCode: number }) {
  const win = FakeBrowserWindow.instances[0]
  win.webContents.emit('render-process-gone', {}, details)
}

describe('render-process-gone 崩溃处理（附表14：崩溃重启前 flushLogs）', () => {
  it('用户选择重启：stopPythonServerSync → flushLogs → relaunch/exit 顺序执行', async () => {
    const { appState, createWindow } = await freshCreateWindow()
    createWindow({ frontendPath: '/mock/frontend', frontendDevPort: 5173 })
    expect(FakeBrowserWindow.instances).toHaveLength(1)

    emitRenderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(mocks.stopPythonServerSync).toHaveBeenCalledWith(appState.pythonProcess)
    expect(mocks.flushLogs).toHaveBeenCalledTimes(1)
    expect(mocks.relaunch).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledWith(0)
    // 与 main.ts 正常退出链一致：先清进程、flush 日志落盘，最后才退出
    const order = [
      mocks.stopPythonServerSync.mock.invocationCallOrder[0],
      mocks.flushLogs.mock.invocationCallOrder[0],
      mocks.exit.mock.invocationCallOrder[0],
    ]
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  it('用户选择退出：走 app.quit 由 before-quit 钩子负责 flush，本处理器不再 flushLogs', async () => {
    mocks.showMessageBoxSync.mockReturnValue(1)
    const { createWindow } = await freshCreateWindow()
    createWindow({ frontendPath: '/mock/frontend', frontendDevPort: 5173 })

    emitRenderProcessGone({ reason: 'killed', exitCode: 3 })

    expect(mocks.quit).toHaveBeenCalledTimes(1)
    expect(mocks.flushLogs).not.toHaveBeenCalled()
    expect(mocks.relaunch).not.toHaveBeenCalled()
    expect(mocks.exit).not.toHaveBeenCalled()
  })
})
