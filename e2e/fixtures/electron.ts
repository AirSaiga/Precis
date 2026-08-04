import { test as base, expect, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
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

/**
 * 读取打包应用主进程日志尾部（userData/logs/main.log）。
 *
 * 打包版 Windows GUI 应用无 console，stdout/stderr 不可捕获——真实日志在文件里。
 * 主进程可能阻塞在错误对话框上（后端启动失败时 showErrorBox 同步阻塞），
 * evaluate 用 5s 竞速兜底，避免诊断本身挂死。
 */
async function readMainLogTail(electronApp: ElectronApplication): Promise<string> {
  try {
    const userData = await Promise.race([
      electronApp.evaluate(({ app }) => app.getPath('userData')),
      new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!userData) return ''
    const logFile = path.join(userData, 'logs', 'main.log')
    if (!fs.existsSync(logFile)) return ''
    const stat = fs.statSync(logFile)
    if (stat.size === 0) return ''
    const readSize = Math.min(stat.size, 32 * 1024)
    const buf = Buffer.alloc(readSize)
    const fd = fs.openSync(logFile, 'r')
    try {
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize)
    } finally {
      fs.closeSync(fd)
    }
    return buf.toString('utf-8')
  } catch {
    return ''
  }
}

/**
 * 创建最小合法项目（供打包应用直接进入画布视图）。
 *
 * CI 打包环境是全新 userData（无最近项目记录），bootstrap 会停在项目选择界面，
 * 画布/资源树不出现——T3 等用例需要应用真正加载一个项目。
 * 通过 PRECIS_RECENT_CONFIG 环境变量注入（见 electron/src/ipc/config.ts），
 * 让应用启动即进入画布。ProjectManifest 仅 project 为必填，空 schema 列表合法。
 */
function createSmokeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-smoke-project-'))
  const projectYaml = [
    'version: 2',
    'project:',
    '  id: smoke_project',
    '  name: Smoke 测试工程',
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'project.precis.yaml'), projectYaml, 'utf-8')
  return dir
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const execPath = resolveElectronExecutable()
    // 清理上次运行残留的 .backend-port：否则 T2 可能读到旧端口文件（对应后端已退出），
    // 健康检查对死端口直接失败，误报为打包产物异常
    try {
      const portFile = path.join(path.dirname(execPath), 'resources', 'backend', '.backend-port')
      fs.rmSync(portFile, { force: true })
    } catch {
      /* 清理失败不影响启动 */
    }
    // 创建临时项目注入为"最近项目"，让应用启动即进入画布视图
    const smokeProjectDir = createSmokeProject()
    const app = await electron.launch({
      executablePath: execPath,
      env: {
        ...process.env,
        PRECIS_RECENT_CONFIG: smokeProjectDir,
      },
    })
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
    // 清理临时项目目录
    fs.rmSync(smokeProjectDir, { recursive: true, force: true })
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
      const mainLogTail = await readMainLogTail(electronApp)
      console.log(
        '\n========== [electron-smoke 诊断] 主窗口(#app) 115s 内未出现 ==========\n' +
          `窗口列表 (${windows.length}):\n${windows.map((u) => '  - ' + u).join('\n')}\n` +
          `\n---------- 应用 stdout 末尾 ----------\n${diagStdout || '(空)'}\n` +
          `\n---------- 应用 stderr 末尾 ----------\n${diagStderr || '(空)'}\n` +
          `\n---------- 应用日志文件(main.log)末尾 ----------\n${mainLogTail || '(无)'}\n` +
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
