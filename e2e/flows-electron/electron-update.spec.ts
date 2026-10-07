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
 * @fileoverview 自动更新端到端实测（Windows 链路，lite 演练模式）
 *
 * 前置（缺任一则整组 skip，不影响 CI electron-smoke job）：
 * - electron/local-updates/latest.yml 存在（`npm run update:drill -- lite` 生成）
 * - 本地更新源可达（`npm run serve:updates`，默认 http://localhost:8080）
 *
 * 覆盖链路：
 * - U1: 非法更新源白名单拒绝（save-config 闸门，换源劫持防线回归）
 * - U2: 检测新版本（custom 源 + latest.yml → update-available）
 * - U3: 下载 + sha512 正向校验（下载成功且 pending 产物哈希与清单一致）
 * - U4: sha512 负向校验（篡改源产物 → 下载失败进入 error）
 * - U5: 启动重放 setFeedURL（重启后 custom 源仍生效）
 * - U6: 组件级安装验证（/S 静默安装 + 用户数据不丢；需 E2E_UPDATE_DO_INSTALL=1，
 *   会真实覆盖本机已安装的 Precis，仅在演练机开启）
 *
 * macOS 不在范围（未签名，Squirrel.Mac 不支持，见 graduation-plan S1）。
 */
import { test, expect } from '../fixtures/electron'
import { _electron } from '@playwright/test'
import { createHash } from 'crypto'
import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FEED_DIR = path.join(REPO_ROOT, 'electron', 'local-updates')
const FEED_URL = process.env.E2E_UPDATE_FEED || 'http://localhost:8080'

/** 最小 latest.yml 解析（version/url/sha512 必需，size 可选——顶层无 size 时取 files 条目内值） */
function parseFeed(): { version: string; url: string; sha512: string; size?: number } | null {
  const ymlPath = path.join(FEED_DIR, 'latest.yml')
  if (!fs.existsSync(ymlPath)) return null
  const yml = fs.readFileSync(ymlPath, 'utf-8')
  const version = /^version:\s*(\S+)$/m.exec(yml)?.[1]
  const url = /^path:\s*(\S+)$/m.exec(yml)?.[1] ?? /^- url:\s*(\S+)$/m.exec(yml)?.[1]
  const sha512 = /^sha512:\s*(\S+)$/m.exec(yml)?.[1]
  const size = /(^\s+size:\s*(\d+)$)/m.exec(yml)?.[2]
  if (!version || !url || !sha512) return null
  return { version, url, sha512, size: size ? Number(size) : undefined }
}

/** 本地更新源是否可达（不可达则 skip，避免误报为更新链路缺陷） */
async function feedServerReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${FEED_URL}/latest.yml`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

const feed = parseFeed()

/** 就绪标志：latest.yml 存在且本地更新源可达（beforeAll 内异步探测） */
let feedReady = false

/** updater 缓存目录（updaterCacheDirName 来自打包产物的 app-update.yml） */
function updaterCacheDir(): string {
  return path.join(os.homedir(), 'AppData', 'Local', 'precis-desktop-updater')
}

/** 流式计算文件 sha512（安装包数百 MB，避免整读入内存） */
function sha512File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (c) => hash.update(c))
    stream.on('end', () => resolve(hash.digest('base64')))
    stream.on('error', reject)
  })
}

/**
 * 硬终止打包应用进程树（taskkill /T /F，连带 Python 后端子进程）。
 *
 * 优雅 close() 在"已成功下载更新"后会挂死：autoInstallOnAppQuit=true 使应用退出时
 * 静默执行 quit-install，fixture teardown 等 120s 超时（实测两次复现），且 quit-install
 * 与用例自身的安装验证互相干扰。更新已下载的用例在断言完成后一律硬终止。
 */
function hardKillApp(electronApp: import('@playwright/test').ElectronApplication): void {
  const pid = electronApp.process()?.pid
  if (pid) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* 进程可能已退出 */
    }
  }
}

/** 在 updater 缓存目录下找最新下载的安装包（pending 目录） */
function findPendingInstaller(): string | null {
  const pendingDir = path.join(updaterCacheDir(), 'pending')
  if (!fs.existsSync(pendingDir)) return null
  const exes = fs
    .readdirSync(pendingDir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => {
      const p = path.join(pendingDir, f)
      return { p, mtime: fs.statSync(p).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return exes[0]?.p ?? null
}

test.describe('Electron 自动更新端到端（lite 演练）', () => {
  test.beforeAll(async () => {
    feedReady = !!feed && (await feedServerReachable())
  })
  test.beforeEach(async () => {
    // 钩子内 skip：条件在 beforeAll 异步探测后才可用
    test.skip(!feedReady, '需要本地演练源：npm run update:drill -- lite && npm run serve:updates')
  })

  test('U1: 非法更新源被白名单拒绝（http + 非回环地址）', async ({ window }) => {
    // 换源劫持防线回归：http 且 host 非 127.0.0.1/localhost 必须拒绝保存
    const configBefore = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.getConfig()
    })
    const rejected = await window.evaluate(
      (url: string) => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.saveConfig({ sourceType: 'custom', sourceUrl: url })
      },
      'http://evil.com/updates'
    )
    expect(rejected, 'http + 非回环 host 的源应被拒绝保存').toBe(false)

    // 拒绝后配置不应被污染（与拒绝前完全一致——不能假设初始是 github，
    // 上一轮演练可能已把持久化配置切到 custom）
    const configAfter = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.getConfig()
    })
    expect(configAfter, '拒绝保存后配置应保持原值不被污染').toEqual(configBefore)
  })

  test('U2: 检测到新版本（custom 源 latest.yml）', async ({ window }) => {
    const saved = await window.evaluate(
      (url: string) => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.saveConfig({ sourceType: 'custom', sourceUrl: url })
      },
      FEED_URL
    )
    expect(saved, '本地演练源（http + localhost）应允许保存').toBe(true)

    const state = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.check()
    })
    expect(state.status, `检测应命中 update-available，实际: ${JSON.stringify(state)}`).toBe(
      'update-available'
    )
    expect(state.version, '检测到的版本号应与演练源 latest.yml 一致').toBe(feed!.version)
  })

  test('U3: 下载成功且 sha512 与清单一致', async ({ electronApp, window }) => {
    // 前置：已保存 custom 源（saveConfig 幂等，重放一次保证状态）
    await window.evaluate(
      (url: string) => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.saveConfig({ sourceType: 'custom', sourceUrl: url })
      },
      FEED_URL
    )
    await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.check()
    })
    await expect
      .poll(
        () =>
          window.evaluate(() => {
            // @ts-expect-error electronAPI 由 preload 注入
            return window.electronAPI.update.getStatus()
          }),
        { timeout: 120_000 }
      )
      .toMatchObject({ status: 'update-available' })

    const downloadResult = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.download()
    })
    expect(downloadResult.success, `下载应成功: ${JSON.stringify(downloadResult)}`).toBe(true)

    const state = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.getStatus()
    })
    expect(state.status, '下载完成后状态应为 downloaded（安装就绪）').toBe('downloaded')
    expect(state.version).toBe(feed!.version)

    // 组件级显式校验：pending 产物实测 sha512 与 latest.yml 全等
    // （electron-updater 下载后本就做该校验，此处独立复核一遍，防"校验逻辑被绕过"）
    const installer = findPendingInstaller()
    expect(installer, `updater 缓存应出现 pending 安装包（${updaterCacheDir()}\\pending）`).toBeTruthy()
    const actual = await sha512File(installer!)
    expect(
      actual,
      'pending 安装包实测 sha512 应与 latest.yml 声明一致'
    ).toBe(feed!.sha512)

    // 清掉 pending 缓存并硬终止进程树：autoInstallOnAppQuit=true 时优雅退出会静默
    // 执行 quit-install，拖死 fixture teardown（实测 120s 超时 + 安装目录被意外覆盖）。
    // U6 需要安装包时会重新走 check+download 全链路。
    fs.rmSync(path.join(updaterCacheDir(), 'pending'), { recursive: true, force: true })
    hardKillApp(electronApp)
  })

  test('U4: 源产物被篡改时下载失败（sha512 负向）', async ({ window }) => {
    const ymlPath = path.join(FEED_DIR, 'latest.yml')
    const exePath = path.join(FEED_DIR, feed!.url)
    const ymlBak = fs.readFileSync(ymlPath, 'utf-8')
    const tamperedVersion = `${feed!.version}-tampered`
    // 篡改清单：版本号 + sha512 都要改——只改版本号时 electron-updater 会按
    // sha512 命中 pending 缓存里已下载的合法旧文件直接复用（首跑实证 success:true），
    // 负向用例必须让缓存判定失效（sha512 与缓存/实际内容都不一致）才会真下载并触发校验
    const garbageSha = Buffer.alloc(64).toString('base64')
    const ymlTampered = ymlBak
      .replace(/^version:\s*\S+$/m, `version: ${tamperedVersion}`)
      .replace(/^sha512:\s*\S+$/gm, `sha512: ${garbageSha}`)
    // 篡改前字节级备份文件头：truncate 只能还原长度不能还原内容；且 writeSync 会
    // 推进 fd 位置，还原必须显式指定偏移 0（首跑因位置漂移把文件头写坏）
    const fd = fs.openSync(exePath, 'r+')
    const TAMPER_LEN = 19
    const headBak = Buffer.alloc(TAMPER_LEN)
    fs.readSync(fd, headBak, 0, TAMPER_LEN, 0)
    try {
      fs.writeFileSync(ymlPath, ymlTampered, 'utf-8')
      // 覆写文件头：内容变了但仍是合法 PE 文件结构上可读，确保触发的是哈希校验失败
      fs.writeSync(fd, Buffer.from('PRECIS-DRILL-TAMPER'), 0, TAMPER_LEN, 0)

      await window.evaluate(
        (url: string) => {
          // @ts-expect-error electronAPI 由 preload 注入
          return window.electronAPI.update.saveConfig({ sourceType: 'custom', sourceUrl: url })
        },
        FEED_URL
      )
      await window.evaluate(() => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.check()
      })
      await expect
        .poll(
          () =>
            window.evaluate(() => {
              // @ts-expect-error electronAPI 由 preload 注入
              return window.electronAPI.update.getStatus()
            }),
          { timeout: 60_000 }
        )
        .toMatchObject({ status: 'update-available', version: tamperedVersion })

      const downloadResult = await window.evaluate(() => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.download()
      })
      expect(
        downloadResult.success,
        `被篡改的产物下载必须失败（sha512 校验拦截），实际: ${JSON.stringify(downloadResult)}`
      ).toBe(false)
      expect(
        /sha512|checksum|signature|mismatch/i.test(downloadResult.error ?? ''),
        `失败原因应为校验不匹配: ${downloadResult.error}`
      ).toBe(true)
    } finally {
      // 恢复演练源（对齐 drill 约定：演练完源目录不留篡改状态）——
      // 显式偏移 0 字节级还原文件头 + 关闭句柄；还原失败会让后续用例全部 sha512 mismatch
      fs.writeSync(fd, headBak, 0, TAMPER_LEN, 0)
      fs.closeSync(fd)
      fs.writeFileSync(ymlPath, ymlBak, 'utf-8')
    }
  })

  test('U5: 重启后自定义更新源仍生效（启动重放 setFeedURL）', async ({ window }) => {
    // 不再 saveConfig，仅凭上轮持久化的 update-config.json + 启动重放
    const config = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.getConfig()
    })
    expect(config.sourceType, '重启后配置应仍为 custom（持久化）').toBe('custom')
    expect(config.sourceUrl).toBe(FEED_URL)

    // 检查更新仍应命中本地源（若重放失效会回退 GitHub 源：
    // 线上最新 0.1.11 == 应用版本 → not-available；本地源 0.1.12 → update-available）
    const state = await window.evaluate(() => {
      // @ts-expect-error electronAPI 由 preload 注入
      return window.electronAPI.update.check()
    })
    expect(
      ['update-available', 'downloaded'],
      `重启后检查应仍命中本地源（available 或复用 pending 缓存的 downloaded），实际: ${JSON.stringify(state)}`
    ).toContain(state.status)
    expect(state.version).toBe(feed!.version)
  })

  test('U6: 静默安装且用户数据不丢（组件级，需 E2E_UPDATE_DO_INSTALL=1）', async ({
    electronApp,
    window,
  }) => {
    test.skip(process.env.E2E_UPDATE_DO_INSTALL !== '1', '会覆盖本机已安装的 Precis，仅演练机开启')
    test.setTimeout(600_000)

    // 1) 用户数据标记：写入 marker 文件（真实用户数据目录，跨安装应保留）
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const markerPath = path.join(userData, 'drill-marker.txt')
    fs.writeFileSync(markerPath, `precis-update-drill ${new Date().toISOString()}`, 'utf-8')
    const installedExe = path.join(
      os.homedir(), 'AppData', 'Local', 'Programs', 'precis', 'Precis.exe'
    )
    test.skip(!fs.existsSync(installedExe), '本机无已安装的 Precis，跳过覆盖安装验证')
    // 安装"确实发生"的哨兵：lite 模式是同一二进制，NSIS 又保留源文件 mtime，
    // 不能用 mtime 判断——改为删除安装目录内一个必随安装包回归的文件，
    // /S 安装后它被重新写回即证明整目录覆盖真实发生
    const sentinelPath = path.join(path.dirname(installedExe), 'resources', 'app-update.yml')
    test.skip(!fs.existsSync(sentinelPath), '安装目录缺少 app-update.yml 哨兵文件')
    fs.rmSync(sentinelPath, { force: true })

    // 2) 确保 pending 安装包就绪（前序用例已下载；幂等兜底再走一遍）
    let installer = findPendingInstaller()
    if (!installer) {
      await window.evaluate(() => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.check()
      })
      await window.evaluate(() => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.download()
      })
      installer = findPendingInstaller()
    }
    expect(installer, '应有待安装的更新包（pending）').toBeTruthy()

    // 3) 硬终止应用进程树（优雅 close 会触发 quit-install 挂死，见 hardKillApp 注释）
    //    后以 /S 静默安装（与 electron-updater quitAndInstall 的静默路径同机制；
    //    quitAndInstall 的非静默 NSIS 向导 UI 无法用 Playwright 驱动 → 需人工确认环节）
    hardKillApp(electronApp)
    await new Promise<void>((resolve, reject) => {
      const p = spawn(installer!, ['/S'], { stdio: 'ignore', detached: false })
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`安装器退出码 ${code}`))))
      p.on('error', reject)
    })
    // NSIS /S 安装器父进程立即退出、子进程继续复制文件——轮询等待哨兵文件回归
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline && !fs.existsSync(sentinelPath)) {
      await new Promise((r) => setTimeout(r, 2000))
    }
    expect(
      fs.existsSync(sentinelPath),
      '/S 静默安装应覆盖安装目录（哨兵 app-update.yml 回归）'
    ).toBe(true)

    // 4) 用户数据不丢
    expect(fs.existsSync(markerPath), '安装后用户数据 marker 应保留').toBe(true)

    // 5) 安装版可正常启动且仍记得 custom 更新源（userData 跨安装保留的进一步证据）
    //    同样剥离 ELECTRON_RUN_AS_NODE（宿主环境注入会让打包 exe 以纯 Node 启动）
    const { ELECTRON_RUN_AS_NODE, ...childEnv } = process.env
    const app2 = await _electron.launch({ executablePath: installedExe, env: childEnv })
    try {
      const deadline2 = Date.now() + 115_000
      let mainWindow: import('@playwright/test').Page | null = null
      while (Date.now() < deadline2 && !mainWindow) {
        for (const w of app2.windows()) {
          try {
            if ((await w.locator('#app').count()) > 0) mainWindow = w
          } catch {
            /* loading */
          }
        }
        if (!mainWindow) await new Promise((r) => setTimeout(r, 1000))
      }
      expect(mainWindow, '安装版应正常启动出主窗口').toBeTruthy()
      const config = await mainWindow!.evaluate(() => {
        // @ts-expect-error electronAPI 由 preload 注入
        return window.electronAPI.update.getConfig()
      })
      expect(config.sourceType, '安装版应仍读取到 userData 中的 custom 更新源').toBe('custom')
    } finally {
      await app2.close()
      // 演练收尾：更新源切回 github（对齐 drill 步骤 6），清掉 marker
      const configPath = path.join(userData, 'update-config.json')
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        fs.writeFileSync(
          configPath,
          JSON.stringify({ ...cfg, sourceType: 'github', sourceUrl: undefined }, null, 2),
          'utf-8'
        )
      }
      fs.rmSync(markerPath, { force: true })
    }
  })
})
