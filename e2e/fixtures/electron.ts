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

// ---- 诊断缓冲：捕获打包应用的 stdout/stderr，供 window 超时时输出 ----
// 打包 Electron 在 CI 上首启较慢且无法本地复现；主进程日志与后端日志都走 stdout/stderr。
// 不捕获时，window fixture 超时只会留下 "timeout while setting up window"，无法定位根因。
const DIAG_CHUNK = 8 * 1024 // 环形缓冲末尾 8KB（含后端启动失败信息足够）
let diagStdout = ''
let diagStderr = ''
function appendDiag(buf: string, chunk: string): string {
  const next = buf + chunk
  return next.length > DIAG_CHUNK ? next.slice(next.length - DIAG_CHUNK) : next
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const execPath = resolveElectronExecutable()
    const app = await electron.launch({ executablePath: execPath })
    // 捕获主进程 + 子进程（后端）输出，用于超时诊断
    app.process().stdout?.on('data', (d: Buffer) => {
      diagStdout = appendDiag(diagStdout, d.toString())
    })
    app.process().stderr?.on('data', (d: Buffer) => {
      diagStderr = appendDiag(diagStderr, d.toString())
    })
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
    // 预留 5s 给 teardown，避免 "Tearing down electronApp exceeded test timeout"
    const deadline = Date.now() + 115_000
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
      // 超时未出现 #app 主窗口：输出诊断信息（窗口列表 + 应用输出末尾 + 端口文件），
      // 把不可复现的打包环境失败转化为可定位的日志。
      const windows = electronApp.windows().map((w) => {
        let url = '<unknown>'
        try {
          url = w.url()
        } catch {
          /* 窗口可能已销毁 */
        }
        return url
      })
      console.log(
        '\n========== [electron-smoke 诊断] 主窗口(#app) 115s 内未出现 ==========\n' +
          `窗口列表 (${windows.length}):\n${windows.map((u) => '  - ' + u).join('\n')}\n` +
          `\n---------- 应用 stdout 末尾 ----------\n${diagStdout || '(空)'}\n` +
          `\n---------- 应用 stderr 末尾 ----------\n${diagStderr || '(空)'}\n` +
          `========================================================\n`,
      )
      // 兜底：取最后一个窗口（splash 之后创建的），让测试能继续而非抛 null
      const all = electronApp.windows()
      mainWindow = all[all.length - 1]
    }
    await mainWindow!.waitForLoadState('domcontentloaded')
    await use(mainWindow!)
  },
})

export { expect }
