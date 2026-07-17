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
    // 等待主窗口（跳过 splash）
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect }
