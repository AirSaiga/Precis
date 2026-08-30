/**
 * @fileoverview update.ts（UpdateManager）单元测试
 *
 * 覆盖本次生产化加固的三个关键行为：
 * 1. 持久化的自定义更新源在启动时重放 setFeedURL（修复重启失效 bug）
 * 2. 更新状态变化经 update:state-changed 推送至所有未销毁窗口
 * 3. update:install 在 quitAndInstall 前同步终止 Python 后端进程树
 *
 * 测试策略：mock 外部边界（electron / electron-updater / fs / logger / i18n / pythonProcess），
 * 通过 mock 的 autoUpdater 事件发射器手动触发事件流。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 构造跨 mock 工厂共享的可变状态（在 vi.mock 工厂执行前初始化）
const mocks = vi.hoisted(() => {
  // 极简事件发射器（避免在 hoisted 阶段依赖 node:events）
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {}
  const autoUpdater: Record<string, unknown> = {
    setFeedURL: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    on: (event: string, handler: (arg?: unknown) => void) => {
      ;(listeners[event] ??= []).push(handler)
      return autoUpdater
    },
  }
  return {
    autoUpdater,
    /** 手动触发 autoUpdater 事件（模拟 electron-updater 的 emit） */
    emitAutoUpdater: (event: string, arg?: unknown) => {
      for (const handler of listeners[event] ?? []) handler(arg)
    },
    /** 监听器注册表（freshManager 时清空，避免跨实例累积） */
    listeners,
    /** ipcMain.handle 注册表 */
    handlers: {} as Record<string, (event?: unknown, arg?: unknown) => unknown>,
    /** BrowserWindow.getAllWindows 返回值 */
    windows: [] as Array<Record<string, unknown>>,
    /** fs 状态：update-config.json 内容（null = 文件不存在） */
    configJson: null as string | null,
    stopSync: vi.fn(),
  }
})

vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    isPackaged: true,
  },
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  ipcMain: {
    handle: (channel: string, handler: (event?: unknown, arg?: unknown) => unknown) => {
      mocks.handlers[channel] = handler
    },
  },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => p.includes('update-config.json') && mocks.configJson !== null),
  readFileSync: vi.fn(() => mocks.configJson ?? '{}'),
  writeFileSync: vi.fn(),
}))

vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../src/i18n', () => ({ t: (key: string) => key }))

vi.mock('../src/pythonProcess', () => ({ stopPythonServerSync: mocks.stopSync }))

/** 重置模块图并重新实例化 UpdateManager 单例（每次测试独立的配置与状态） */
async function freshManager() {
  vi.resetModules()
  for (const key of Object.keys(mocks.listeners)) delete mocks.listeners[key]
  mocks.autoUpdater.setFeedURL = vi.fn()
  mocks.autoUpdater.quitAndInstall = vi.fn()
  mocks.autoUpdater.checkForUpdates = vi.fn().mockResolvedValue(undefined)
  mocks.stopSync.mockClear()
  mocks.windows.length = 0
  const mod = await import('../src/update')
  return mod.updateManager
}

beforeEach(() => {
  mocks.configJson = null
})

describe('自定义更新源持久化（重启重放 setFeedURL）', () => {
  it('持久化 custom 源在 init 时应用 setFeedURL', async () => {
    mocks.configJson = JSON.stringify({
      sourceType: 'custom',
      sourceUrl: 'http://localhost:8080',
      autoCheck: true,
      autoDownload: false,
    })
    await freshManager()
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://localhost:8080',
    })
  })

  it('github 源（默认/持久化）不调用 setFeedURL', async () => {
    mocks.configJson = JSON.stringify({ sourceType: 'github', autoCheck: true, autoDownload: false })
    await freshManager()
    expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('saveConfig 切换到 custom 源时立即应用 setFeedURL', async () => {
    const manager = await freshManager()
    manager.saveConfig({ sourceType: 'custom', sourceUrl: 'http://192.168.1.10:9000' })
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://192.168.1.10:9000',
    })
  })
})

describe('更新状态推送（update:state-changed）', () => {
  it('状态变化推送至所有未销毁窗口', async () => {
    await freshManager()
    const send1 = vi.fn()
    const send2 = vi.fn()
    mocks.windows.push(
      { isDestroyed: () => false, webContents: { send: send1 } },
      { isDestroyed: () => false, webContents: { send: send2 } },
    )

    mocks.emitAutoUpdater('update-available', { version: '0.2.0', releaseDate: '2026-08-30' })

    expect(send1).toHaveBeenCalledWith(
      'update:state-changed',
      expect.objectContaining({ status: 'update-available', version: '0.2.0' }),
    )
    expect(send2).toHaveBeenCalledWith(
      'update:state-changed',
      expect.objectContaining({ status: 'update-available' }),
    )
  })

  it('已销毁窗口被跳过（不触发 webContents.send）', async () => {
    await freshManager()
    const send = vi.fn()
    mocks.windows.push({ isDestroyed: () => true, webContents: { send } })

    mocks.emitAutoUpdater('checking-for-update')

    expect(send).not.toHaveBeenCalled()
  })

  it('下载进度事件携带 progress 字段推送', async () => {
    await freshManager()
    const send = vi.fn()
    mocks.windows.push({ isDestroyed: () => false, webContents: { send } })

    mocks.emitAutoUpdater('download-progress', {
      percent: 42.5,
      bytesPerSecond: 1024,
      transferred: 100,
      total: 235,
    })

    expect(send).toHaveBeenCalledWith(
      'update:state-changed',
      expect.objectContaining({ status: 'downloading', progress: 42.5, total: 235 }),
    )
  })
})

describe('update:install 安装前清理', () => {
  it('状态非 downloaded 时拒绝安装且不触发清理', async () => {
    const manager = await freshManager()
    const result = (await mocks.handlers['update:install']()) as { success: boolean }
    expect(result.success).toBe(false)
    expect(mocks.stopSync).not.toHaveBeenCalled()
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(manager.getState().status).toBe('idle')
  })

  it('downloaded 状态下先杀后端再 quitAndInstall（顺序保证）', async () => {
    await freshManager()
    const stopSync = mocks.stopSync as ReturnType<typeof vi.fn>
    const quitAndInstall = mocks.autoUpdater.quitAndInstall as ReturnType<typeof vi.fn>

    mocks.emitAutoUpdater('update-downloaded', { version: '0.2.0' })
    const result = (await mocks.handlers['update:install']()) as { success: boolean }

    expect(result.success).toBe(true)
    expect(stopSync).toHaveBeenCalled()
    expect(quitAndInstall).toHaveBeenCalled()
    // 铁律顺序：先终止 Python 进程树（释放 resources 文件占用），后启动安装器
    expect(stopSync.mock.invocationCallOrder[0]).toBeLessThan(quitAndInstall.mock.invocationCallOrder[0])
  })
})

describe('update:check', () => {
  it('调用 autoUpdater.checkForUpdates 并返回状态', async () => {
    await freshManager()
    const result = (await mocks.handlers['update:check']()) as { status: string }
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalled()
    expect(result.status).toBe('idle')
  })
})
