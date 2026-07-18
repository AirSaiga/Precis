import { test as base, expect, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Electron 打包 smoke 测试 fixture。
 *
 * launchPackagedApp 解析打包后的可执行文件路径并启动。
 * 路径解析优先级：
 * 1. E2E_ELECTRON_PATH 环境变量（绝对路径）
 * 2. electron/release/win-unpacked/*.exe（Windows）
 *    electron/release/mac/*.app/Contents/MacOS/*（macOS）
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ELECTRON_RELEASE = path.join(REPO_ROOT, 'electron', 'release')

function resolveElectronExecutable(): string {
  // 1. 环境变量绝对路径
  const envPath = process.env.E2E_ELECTRON_PATH
  if (envPath && fs.existsSync(envPath)) return envPath

  // 2. electron/release/ 下查找
  if (!fs.existsSync(ELECTRON_RELEASE)) {
    throw new Error(
      `Electron 打包产物未找到。请先运行 electron-builder --dir，或设置 E2E_ELECTRON_PATH 指向可执行文件。` +
        `（查找路径: ${ELECTRON_RELEASE}）`
    )
  }

  // Windows: release/win-unpacked/<AppName>.exe；macOS: release/mac/<AppName>.app/Contents/MacOS/<AppName>
  const candidates = process.platform === 'win32'
    ? [
        path.join(ELECTRON_RELEASE, 'win-unpacked', 'Precis.exe'),
        path.join(ELECTRON_RELEASE, 'win-unpacked', 'precis.exe'),
      ]
    : [
        path.join(ELECTRON_RELEASE, 'mac', 'Precis.app', 'Contents', 'MacOS', 'Precis'),
        path.join(ELECTRON_RELEASE, 'mac', 'precis.app', 'Contents', 'MacOS', 'precis'),
      ]

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error(
    `在 ${ELECTRON_RELEASE} 下未找到可执行文件（尝试过: ${candidates.join(', ')}）。` +
      `可设置 E2E_ELECTRON_PATH 显式指定。`
  )
}

type ElectronFixtures = {
  electronApp: ElectronApplication
  window: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const execPath = resolveElectronExecutable()
    const app = await electron.launch({ executablePath: execPath })
    await use(app)
    // 测试结束后关闭（确保后端子进程被清理）
    await app.close()
  },
  window: async ({ electronApp }, use) => {
    // 等待主窗口（跳过 splash）。
    // 应用启动顺序：createSplashWindow（第一个窗口）→ startPythonServer
    //   → createWindow（第二个窗口，加载 app://，含 #app）。
    // firstWindow() 返回的是 splash，不是主窗口；必须等待第二个窗口出现
    // 并确认其含 #app（打包后 Python 冷启动较慢，主窗口可能 30-60s 才出现）。
    const deadline = Date.now() + 120_000
    let mainWindow: Page | null = null
    while (Date.now() < deadline) {
      for (const w of electronApp.windows()) {
        try {
          // 主窗口加载 app:// 协议的前端 bundle，含 #app 根挂载点
          const url = w.url()
          if (url.startsWith('app://') || url.includes('index.html')) {
            const hasApp = await w.locator('#app').count()
            if (hasApp > 0) {
              mainWindow = w
              break
            }
          }
        } catch {
          // 窗口可能在加载中，继续轮询
        }
      }
      if (mainWindow) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (!mainWindow) {
      // 兜底：取最后一个窗口（splash 之后创建的）
      const all = electronApp.windows()
      mainWindow = all[all.length - 1]
    }
    await mainWindow!.waitForLoadState('domcontentloaded')
    await use(mainWindow!)
  },
})

export { expect }
