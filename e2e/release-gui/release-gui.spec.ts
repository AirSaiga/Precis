/**
 * 发布控制台（release-gui）页面自动化测试
 *
 * 分层策略：
 * 1. 真实服务集成 —— beforeAll spawn `node scripts/release-gui.mjs`，跑导航/外观/真实任务生命周期
 * 2. Mock 状态渲染 —— 用 route 拦截 /api/state 与 /api/events 注入确定性夹具，
 *    覆盖各种数据形态（draft/prerelease/版本漂移/错误文案/空态）
 * 3. 交互流验证 —— 发布弹窗解锁与请求负载捕获（/api/run 拦截，绝不真实发布）
 * 4. 服务端防护 —— 注入向量/未知动作必须被 400 拒绝（端到端复验白名单）
 */
import { test, expect, Page, BrowserContext } from '@playwright/test'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 探测仓库根（避免 import.meta 在 Playwright CJS 转换下不可用） */
function findRepoRoot(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '..', '..')]
  return candidates.find((d) => fs.existsSync(path.join(d, 'scripts', 'release-gui.mjs'))) || process.cwd()
}

const ROOT = findRepoRoot()
const PORT = 3311
const BASE = `http://127.0.0.1:${PORT}`

let serverProc: ReturnType<typeof spawn> | null = null

test.beforeAll(async () => {
  serverProc = spawn(`node scripts/release-gui.mjs --port ${PORT} --no-open`, {
    shell: true,
    cwd: ROOT,
    stdio: 'ignore',
  })
  // 轮询直到 /api/state 可用（服务秒起，留足余量）
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/state`)
      if (res.ok) break
    } catch {
      /* 未就绪继续等 */
    }
    if (Date.now() > deadline) throw new Error('release-gui 服务启动超时')
    await new Promise((r) => setTimeout(r, 300))
  }
})

test.afterAll(async () => {
  if (serverProc?.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /T /F /PID ${serverProc.pid}`, { windowsHide: true, timeout: 5000 })
      } else {
        serverProc.kill('SIGTERM')
      }
    } catch {
      /* 已退出 */
    }
  }
})

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    repo: 'AirSaiga/Precis',
    platform: 'Windows NSIS',
    rootVersion: '0.1.1',
    allConsistent: true,
    latestTag: 'v0.1.1',
    suggestedNext: '0.1.2',
    branch: 'main',
    versions: [
      { file: 'package.json', version: '0.1.1' },
      { file: 'frontend/package.json', version: '0.1.1' },
      { file: 'electron/package.json', version: '0.1.1' },
      { file: 'backend/pyproject.toml', version: '0.1.1' },
      { file: 'tui-rust/Cargo.toml', version: '0.1.1' },
      { file: 'tui-rust/Cargo.lock', version: '0.1.1' },
    ],
    buildArtifacts: {
      dir: 'electron/release',
      files: [
        { name: 'Precis-Setup-0.1.1.exe', size: 227981660, mtime: '2026-08-30T12:00:00Z' },
        { name: 'Precis-Setup-0.1.1.exe.blockmap', size: 238507, mtime: '2026-08-30T11:58:00Z' },
      ],
      latestYml: { version: '0.1.1', files: [{ url: 'Precis-Setup-0.1.1.exe', sha512: 'AAA==', size: '227981660' }] },
    },
    github: {
      releases: [
        {
          tag: 'v0.1.1', name: 'Precis v0.1.1', draft: false, prerelease: false,
          publishedAt: '2026-08-30T11:46:45Z', assets: [{ name: 'Precis-Setup-0.1.1.exe', size: 227981660 }],
        },
        {
          tag: 'v0.2.0-alpha.1', name: 'Precis v0.2.0-alpha.1', draft: true, prerelease: false,
          publishedAt: null, assets: [],
        },
        {
          tag: 'v0.1.2-beta.1', name: 'x', draft: false, prerelease: true,
          publishedAt: '2026-08-29T10:00:00Z', assets: [{ name: 'a.zip', size: 10 }],
        },
      ],
    },
    serveUpdates: { running: false },
    job: { running: false },
    ...overrides,
  }
}

function sseBody(messages: unknown[]): string {
  return messages.map((m) => `data: ${JSON.stringify(m)}\n\n`).join('')
}

/** 拦截 /api/state（+ 可选 /api/events、/api/run 捕获）的确定性页面 */
async function mockedPage(
  context: BrowserContext,
  state: Record<string, unknown>,
  options: { events?: unknown[]; captureRuns?: unknown[] } = {},
): Promise<Page> {
  await context.route('**/api/state*', (route) => route.fulfill({ json: state }))
  if (options.events) {
    await context.route('**/api/events*', (route) =>
      route.fulfill({ contentType: 'text/event-stream; charset=utf-8', body: sseBody(options.events!) }),
    )
  }
  if (options.captureRuns) {
    await context.route('**/api/run', async (route) => {
      options.captureRuns!.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true } })
    })
  }
  const page = await context.newPage()
  await page.goto('/')
  await page.waitForTimeout(400)
  return page
}

// ---------------------------------------------------------------------------
// 1. 真实服务：基础与导航
// ---------------------------------------------------------------------------

test.describe('真实服务 · 加载与导航', () => {
  test('页面加载：标题 + 四个导航项文案', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('Precis 发布控制台')
    for (const label of ['制作安装包', '发布新版本', '测试自动更新', '发布结果']) {
      await expect(page.locator('.nav-item__label', { hasText: label })).toBeVisible()
    }
  })

  test('/api/state 返回六处 manifest 与真实根版本一致', async ({ request }) => {
    const state = await (await request.get('/api/state')).json()
    expect(state.versions).toHaveLength(6)
    expect(state.rootVersion).toBe(state.versions[0].version)
    expect(state.branch).toBe('main')
  })

  test('切换标签页生效并记忆（刷新后保持）', async ({ page }) => {
    await page.goto('/')
    await page.click('.nav-item[data-tab="drill"]')
    await expect(page.locator('#panel-drill')).toBeVisible()
    await expect(page.locator('#panel-build')).toBeHidden()
    await page.reload()
    await expect(page.locator('#panel-drill')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. 外观系统（真实交互 + localStorage 持久化）
// ---------------------------------------------------------------------------

test.describe('外观系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('默认为深夜主题、无背景', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(false)
  })

  test('切换浅色 + 樱粉背景 + 调整模糊，刷新后仍保持', async ({ page }) => {
    await page.click('#btn-appearance')
    await expect(page.locator('#appearanceDialog')).toBeVisible()
    // 色块有名字
    await expect(page.locator('#ap-themes .swatch-wrap span', { hasText: '二次元' })).toBeVisible()

    await page.click('[data-theme-value="light"]')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await page.click('[data-bg-value="sakura"]')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(true)

    await page.locator('#ap-blur').fill('24')
    await expect(page.locator('#ap-blur-val')).toHaveText('24px')

    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(true)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-blur').trim())).toBe('24px')
  })

  test('恢复默认回到深夜/无背景', async ({ page }) => {
    await page.evaluate(() =>
      localStorage.setItem('rg-appearance', JSON.stringify({ theme: 'anime', bgType: 'gradient', bgValue: 'linear-gradient(160deg,#ffd9e8,#e3d5ff)', blur: 20, alpha: 80 })),
    )
    await page.reload()
    await page.click('#btn-appearance')
    await page.click('#ap-reset')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(false)
  })

  test('不透明度滑杆下限 70（防止背景糊字）', async ({ page }) => {
    await page.click('#btn-appearance')
    expect(await page.locator('#ap-alpha').getAttribute('min')).toBe('70')
  })
})

// ---------------------------------------------------------------------------
// 3. 发布页：版本推导（mock 状态，根版本 0.1.1）
// ---------------------------------------------------------------------------

test.describe('发布页 · 版本号推导', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/state*', (route) => route.fulfill({ json: makeState() }))
    await page.goto('/')
    await page.click('.nav-item[data-tab="release"]')
  })

  test('默认 patch：预览显示 v0.1.2', async ({ page }) => {
    await expect(page.locator('#rel-preview')).toContainText('v0.1.2')
    await expect(page.locator('#rel-current')).toContainText('0.1.1')
  })

  test('minor → v0.2.0；major → v1.0.0', async ({ page }) => {
    await page.selectOption('#rel-mode', 'minor')
    await expect(page.locator('#rel-preview')).toContainText('v0.2.0')
    await page.selectOption('#rel-mode', 'major')
    await expect(page.locator('#rel-preview')).toContainText('v1.0.0')
  })

  test('手动模式 + 测试版标记组合', async ({ page }) => {
    await page.selectOption('#rel-mode', 'manual')
    await expect(page.locator('#rel-version')).toBeEnabled()
    await page.fill('#rel-version', '0.9.9')
    await page.fill('#rel-prerelease', 'alpha.1')
    await expect(page.locator('#rel-preview')).toContainText('v0.9.9-alpha.1')
  })

  test('自动 patch + 测试版标记 → v0.1.2-alpha.1', async ({ page }) => {
    await page.fill('#rel-prerelease', 'alpha.1')
    await expect(page.locator('#rel-preview')).toContainText('v0.1.2-alpha.1')
  })

  test('勾选先不上传，预览与弹窗摘要同步变化', async ({ page }) => {
    await page.check('#rel-nopush')
    await expect(page.locator('#rel-preview')).toContainText('先只在本地准备好')
    await page.click('#btn-release')
    await expect(page.locator('#rd-push')).toHaveText(/暂不上传/)
    await page.click('#releaseDialog .btn--secondary')
  })
})

// ---------------------------------------------------------------------------
// 4. 发布弹窗：解锁机制与请求负载（/api/run 被拦截，绝不真实发布）
// ---------------------------------------------------------------------------

test.describe('发布弹窗 · 防误触与负载', () => {
  let runs: unknown[]

  test.beforeEach(async ({ context, page }) => {
    runs = []
    await context.route('**/api/state*', (route) => route.fulfill({ json: makeState() }))
    await context.route('**/api/run', async (route) => {
      runs.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true } })
    })
    await page.goto('/')
    await page.click('.nav-item[data-tab="release"]')
  })

  test('输错不解锁，输对（带不带 v 均可）解锁；确认发出正确负载', async ({ page }) => {
    await page.click('#btn-release')
    const dlg = page.locator('#releaseDialog')
    await expect(dlg).toBeVisible()
    await expect(page.locator('#rd-confirm-btn')).toBeDisabled()
    // 摘要含反悔空间
    await expect(dlg).toContainText('反悔空间')
    await expect(dlg).toContainText('v0.1.2')

    await page.fill('#rd-confirm', '0.1.1')
    await expect(page.locator('#rd-confirm-btn')).toBeDisabled()
    await page.fill('#rd-confirm', 'v0.1.2')
    await expect(page.locator('#rd-confirm-btn')).toBeEnabled()

    await page.click('#rd-confirm-btn')
    await expect(dlg).toBeHidden()
    // close 事件 → Promise resolve → runAction 发 POST 是异步链，轮询等待请求落地
    await expect.poll(() => runs.length).toBe(1)
    expect(runs).toEqual([{ action: 'release', params: { version: '0.1.2', noPush: false } }])
  })

  test('取消不发请求', async ({ page }) => {
    await page.click('#btn-release')
    await page.fill('#rd-confirm', '0.1.2')
    await page.click('#releaseDialog .btn--secondary')
    await expect(page.locator('#releaseDialog')).toBeHidden()
    expect(runs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. 演练页（mock + 负载捕获）
// ---------------------------------------------------------------------------

test.describe('测试自动更新页', () => {
  let runs: unknown[]

  test.beforeEach(async ({ context, page }) => {
    runs = []
    await context.route('**/api/state*', (route) => route.fulfill({ json: makeState() }))
    await context.route('**/api/run', async (route) => {
      runs.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true } })
    })
    await page.goto('/')
    await page.click('.nav-item[data-tab="drill"]')
  })

  test('快速测试：版本预填 9.9.9-drill，点击直接发请求', async ({ page }) => {
    await expect(page.locator('#drill-lite-version')).toHaveValue('9.9.9-drill')
    await page.fill('#drill-lite-version', '8.8.8-x')
    await page.getByRole('button', { name: '准备一次模拟更新' }).click()
    expect(runs).toEqual([{ action: 'drill-lite', params: { version: '8.8.8-x' } }])
  })

  test('彻底测试：确认弹窗展示版本区间，取消不发、确认发负载', async ({ page }) => {
    await expect(page.locator('#drill-base')).toHaveValue('0.1.1')
    await page.getByRole('button', { name: '制作新旧两个安装包' }).click()
    await expect(page.locator('#drillDialog')).toBeVisible()
    await expect(page.locator('#dd-versions')).toHaveText('0.1.1 → 0.1.2')
    await page.click('#drillDialog .btn--secondary')
    expect(runs).toHaveLength(0)

    await page.getByRole('button', { name: '制作新旧两个安装包' }).click()
    await page.click('#drillDialog .btn--primary')
    await expect.poll(() => runs.length).toBe(1)
    expect(runs).toEqual([{ action: 'drill-full', params: { base: '0.1.1', next: '0.1.2' } }])
  })

  test('模拟服务器地址旁有复制按钮', async ({ page }) => {
    await expect(page.locator('#svc-copy')).toBeVisible()
    await expect(page.locator('#svc-url')).toHaveText('http://localhost:8080')
  })
})

// ---------------------------------------------------------------------------
// 6. 状态页渲染（mock 各数据形态）
// ---------------------------------------------------------------------------

test.describe('发布结果页 · 渲染形态', () => {
  test('正常数据：已发布/草稿/测试版徽标 + manifest 表', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await page.click('.nav-item[data-tab="status"]')
    await expect(page.locator('.rel', { hasText: 'v0.1.1' }).locator('.badge--ok')).toContainText('已发布')
    await expect(page.locator('.rel', { hasText: 'v0.2.0-alpha.1' }).locator('.badge--warn')).toContainText('草稿')
    await expect(page.locator('.rel', { hasText: 'v0.1.2-beta.1' }).locator('.badge--info')).toContainText('测试版')
    await expect(page.locator('#manifest-badge')).toContainText('全部一致')
    expect(await page.locator('#manifests-body tr').count()).toBe(6)
    await expect(page.locator('#verify-tag')).toHaveValue('v0.1.1')
  })

  test('版本漂移：badge 变红 + 漂移行高亮', async ({ context }) => {
    const state = makeState({
      allConsistent: false,
      versions: [
        { file: 'package.json', version: '0.1.1' },
        { file: 'frontend/package.json', version: '0.1.1' },
        { file: 'electron/package.json', version: '0.1.1' },
        { file: 'backend/pyproject.toml', version: '0.1.0' },
        { file: 'tui-rust/Cargo.toml', version: '0.1.1' },
        { file: 'tui-rust/Cargo.lock', version: '0.1.1' },
      ],
    })
    const page = await mockedPage(context, state)
    await page.click('.nav-item[data-tab="status"]')
    await expect(page.locator('#manifest-badge')).toContainText('不一致')
    await expect(page.locator('#manifests-body tr.is-bad')).toHaveCount(1)
  })

  test('GitHub 403：文案区分"拒绝"而非网络问题', async ({ context }) => {
    const page = await mockedPage(context, makeState({ github: { error: 'HTTP 403' } }))
    await page.click('.nav-item[data-tab="status"]')
    await expect(page.locator('#gh-list')).toContainText('GitHub 拒绝了请求')
  })

  test('尚无 Release：空态提供"去发布"跳转', async ({ context }) => {
    const page = await mockedPage(context, makeState({ github: { releases: [] } }))
    await page.click('.nav-item[data-tab="status"]')
    await page.click('#empty-go-release')
    await expect(page.locator('#panel-release')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 7. 制作安装包页 · 产物渲染形态
// ---------------------------------------------------------------------------

test.describe('制作安装包页 · 产物列表', () => {
  test('最新一批带"最新"徽标，latest.yml 版本与当前一致无警告', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await expect(page.locator('#artifacts-body tbody tr').first()).toContainText('最新')
    await expect(page.locator('#artifacts-body')).not.toContainText('旧版本')
    await expect(page.locator('#artifacts-body')).toContainText('latest.yml')
  })

  test('产物版本落后：出现旧版本警告', async ({ context }) => {
    const state = makeState({
      buildArtifacts: {
        dir: 'x',
        files: [{ name: 'Precis-Setup-0.1.0.exe', size: 1, mtime: '2026-07-18T00:00:00Z' }],
        latestYml: { version: '0.1.0', files: [{ url: 'Precis-Setup-0.1.0.exe', sha512: 'x', size: '1' }] },
      },
    })
    const page = await mockedPage(context, state)
    await expect(page.locator('#artifacts-body')).toContainText('旧版本 0.1.0')
    await expect(page.locator('#artifacts-body')).toContainText('0.1.1')
  })

  test('空产物：空态引导文案', async ({ context }) => {
    const page = await mockedPage(
      context,
      makeState({ buildArtifacts: { dir: 'x', files: [], latestYml: null } }),
    )
    await expect(page.locator('#artifacts-body')).toContainText('还没有安装包')
  })

  test('页头明示"发正式版不需要先做这一步"', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await expect(page.locator('#panel-build .page-head')).toContainText('发正式版不需要先做这一步')
  })
})

// ---------------------------------------------------------------------------
// 8. 任务状态与执行过程抽屉（mock SSE）
// ---------------------------------------------------------------------------

test.describe('任务状态与执行过程', () => {
  test('运行中：进度条/侧栏活动点/按钮禁用/终止可用，日志回放', async ({ context }) => {
    const page = await mockedPage(context, makeState(), {
      events: [
        { type: 'history', lines: [
          { stream: 'info', text: '▶ 正式发布 0.1.2', ts: 1 },
          { stream: 'stdout', text: '版本同步清单:', ts: 2 },
        ] },
        { type: 'status', job: { running: true, label: '正式发布 0.1.2', startedAt: Date.now() - 5000, exitCode: null, done: false } },
      ],
    })
    await expect(page.locator('#topbarProgress')).toHaveClass(/is-active/)
    await expect(page.locator('#joblabel')).toHaveText('正式发布 0.1.2')
    await expect(page.locator('#dot-release')).toBeVisible()
    await expect(page.locator('#dot-build')).toBeHidden()
    await expect(page.locator('#btn-release')).toBeDisabled()
    await expect(page.locator('#btn-kill')).toBeEnabled()
    await expect(page.locator('#log')).toContainText('版本同步清单')
  })

  test('抽屉折叠/展开（按钮 + Ctrl+`）与清空', async ({ page }) => {
    await page.goto('/')
    await page.click('#drawer-toggle')
    await expect(page.locator('#drawer')).toHaveClass(/is-collapsed/)
    await page.keyboard.press('Control+`')
    await expect(page.locator('#drawer')).not.toHaveClass(/is-collapsed/)
    await page.click('#log-clear')
    await expect(page.locator('#log')).toContainText('已清空')
  })
})

// ---------------------------------------------------------------------------
// 9. 真实任务生命周期（只读动作，安全）
// ---------------------------------------------------------------------------

test.describe('真实任务生命周期', () => {
  test('检查 6 个文件的版本号：真实执行 → 完成状态 → 页面回放呈现', async ({ page }) => {
    await page.goto('/')
    await page.click('.nav-item[data-tab="release"]')
    // 等状态就绪（侧栏"当前版本"渲染完成）再点击：
    // /api/state 内含 GitHub 查询，慢网下可能数秒才返回，STATE 未就绪时点击会被前端正确拦截
    await expect(page.locator('#env-version')).not.toHaveText('–')
    await page.getByRole('button', { name: '检查 6 个文件的版本号是否一致' }).click()
    // 等待服务端任务完成（轮询服务端状态，规避 SSE 实时推送与快速任务之间的时序抖动）
    await expect
      .poll(
        async () => {
          const state = await (await page.request.get('/api/state')).json()
          return state.job && state.job.done === true && state.job.exitCode === 0
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    // 刷新页面：SSE 连接即回放历史与最终状态，确定性渲染徽标/日志/抽屉
    await page.reload()
    await expect(page.locator('#exitbadge')).toHaveText('成功', { timeout: 10_000 })
    await expect(page.locator('#log')).toContainText('全部一致')
    await expect(page.locator('#drawer')).not.toHaveClass(/is-collapsed/)
    await expect(page.getByRole('button', { name: '检查 6 个文件的版本号是否一致' })).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// 10. 服务端防护（端到端复验 GUI 白名单）
// ---------------------------------------------------------------------------

test.describe('服务端输入防护', () => {
  test('注入向量被 400 拒绝', async ({ request }) => {
    const res = await request.post('/api/run', {
      data: { action: 'release-dry', params: { version: '0.1.1; calc' } },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('非法')
  })

  test('未知动作被 400 拒绝', async ({ request }) => {
    const res = await request.post('/api/run', { data: { action: 'rm-rf' } })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('未知动作')
  })

  test('目录参数白名单（open 仅允许 release/local-updates）', async ({ request }) => {
    const res = await request.post('/api/open', { data: { target: '../..' } })
    expect(res.status()).toBe(400)
  })
})
