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
 * PyPI 管理控制台（pypi-gui）页面自动化测试
 *
 * 分层策略（镜像 release-gui.spec.ts）：
 * 1. 真实服务集成 —— beforeAll spawn `node scripts/release/pypi-gui.mjs`，验证导航与 /api/state 契约；
 *    外部数据源（PyPI/GitHub/pypistats）失败时返回独立 error 字段，测试不依赖外网成功
 * 2. Mock 状态渲染 —— route 拦截 /api/state 注入确定性夹具，覆盖对齐各档、
 *    流水线成败、统计缺失/错误、发布历史标记等形态
 * 3. 交互流验证 —— 验证确认弹窗与请求负载捕获（/api/run 拦截，绝不真实 pip install）
 * 4. 服务端防护 —— 注入向量/未知动作 400、外源 Origin POST 403（端到端复验白名单与来源边界）
 */
import { test, expect, Page, BrowserContext } from '@playwright/test'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 探测仓库根（避免 import.meta 在 Playwright CJS 转换下不可用） */
function findRepoRoot(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '..', '..')]
  return candidates.find((d) => fs.existsSync(path.join(d, 'scripts', 'release', 'pypi-gui.mjs'))) || process.cwd()
}

const ROOT = findRepoRoot()
const PORT = 3312

/** 版本载体数量从单一事实源 release.mjs 文本解析（不写死数字，随清单增项自动同步） */
function manifestCount(): number {
  const text = fs.readFileSync(path.join(ROOT, 'scripts', 'release.mjs'), 'utf-8')
  const start = text.indexOf('export const MANIFESTS')
  const block = text.slice(start, text.indexOf('];', start))
  return (block.match(/\{ file:/g) || []).length
}
const BASE = `http://127.0.0.1:${PORT}`

let serverProc: ReturnType<typeof spawn> | null = null

test.beforeAll(async () => {
  serverProc = spawn(`node scripts/release/pypi-gui.mjs --port ${PORT} --no-open`, {
    shell: true,
    cwd: ROOT,
    stdio: 'ignore',
  })
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/state`)
      if (res.ok) break
    } catch {
      /* 未就绪继续等 */
    }
    if (Date.now() > deadline) throw new Error('pypi-gui 服务启动超时')
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

function alignmentFixture(checks: Array<{ key: string; label: string; status: string; detail: string }>, overall: string) {
  return { checks, overall }
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    repo: 'AirSaiga/Precis',
    package: 'precis-cli',
    rootVersion: '0.1.5',
    allConsistent: true,
    latestTag: 'v0.1.5',
    versions: [
      { file: 'package.json', version: '0.1.5' },
      { file: 'frontend/package.json', version: '0.1.5' },
      { file: 'electron/package.json', version: '0.1.5' },
      { file: 'backend/pyproject.toml', version: '0.1.5' },
      { file: 'tui-rust/Cargo.toml', version: '0.1.5' },
      { file: 'tui-rust/Cargo.lock', version: '0.1.5' },
      { file: 'integrations/kimi.plugin.json', version: '0.1.5' },
      { file: '.kimi-plugin/plugin.json', version: '0.1.5' },
    ],
    alignment: alignmentFixture(
      [
        { key: 'manifests', label: '版本文件', status: 'ok', detail: '全部 manifest 一致（0.1.5）' },
        { key: 'local-tag', label: '本地 ↔ tag', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-release', label: 'tag ↔ GitHub', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'ok', detail: '一致（0.1.5）' },
      ],
      'ok',
    ),
    pypi: {
      latestVersion: '0.1.5',
      releases: [
        {
          version: '0.1.5',
          uploadTime: '2026-09-21T10:00:00Z',
          yanked: false,
          files: [
            { name: 'precis_cli-0.1.5-py3-none-any.whl', size: 2244321, sha256: 'a'.repeat(64), kind: 'wheel' },
            { name: 'precis_cli-0.1.5.tar.gz', size: 1988765, sha256: 'b'.repeat(64), kind: 'sdist' },
          ],
        },
        {
          version: '0.1.4',
          uploadTime: '2026-09-14T09:00:00Z',
          yanked: true,
          files: [{ name: 'precis_cli-0.1.4-py3-none-any.whl', size: 2200111, sha256: 'c'.repeat(64), kind: 'wheel' }],
        },
      ],
    },
    workflow: {
      latestTagRun: {
        tag: 'v0.1.5',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/AirSaiga/Precis/actions/runs/123',
        runNumber: 9,
      },
      pypiJob: {
        name: 'Publish precis-cli to PyPI',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/AirSaiga/Precis/actions/runs/123/job/456',
      },
    },
    githubReleases: [{ tag: 'v0.1.5', name: 'Precis v0.1.5', draft: false, prerelease: false, publishedAt: '2026-09-21T10:30:00Z' }],
    stats: {
      recent: { last_day: 12, last_week: 70, last_month: 300 },
      byPython: [
        { category: 'null', downloads: 263 },
        { category: '3.12', downloads: 20 },
        { category: '3.13', downloads: 6 },
      ],
      bySystem: [
        { category: 'null', downloads: 263 },
        { category: 'Linux', downloads: 25 },
        { category: 'Windows', downloads: 4 },
      ],
      totals: {
        withMirrors: { downloads: 851, date: '2026-09-20' },
        withoutMirrors: { downloads: 292, date: '2026-09-20' },
      },
    },
    changelogVersions: ['0.1.5', '0.1.4'],
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
// 1. 真实服务：加载、导航与 /api/state 契约（不依赖外网成功，数据源失败走独立 error 字段）
// ---------------------------------------------------------------------------

test.describe('真实服务 · 加载与导航', () => {
  test('页面加载：标题 + 三个导航项文案', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('Precis PyPI 管理控制台')
    for (const label of ['总览', '发布历史', '验证线上包']) {
      await expect(page.locator('.nav-item__label', { hasText: label })).toBeVisible()
    }
  })

  test('/api/state 契约：包名、manifest 数量与根版本', async ({ request }) => {
    const state = await (await request.get('/api/state')).json()
    expect(state.package).toBe('precis-cli')
    expect(state.versions).toHaveLength(manifestCount())
    expect(state.rootVersion).toBe(state.versions[0].version)
    expect(typeof state.allConsistent).toBe('boolean')
    // 外部数据源要么给数据要么给 error 字段，不缺字段、不抛 5xx
    for (const key of ['pypi', 'workflow', 'stats']) {
      expect(state[key]).toBeTruthy()
    }
  })

  test('切换标签页生效并记忆（刷新后保持）', async ({ page }) => {
    await page.goto('/')
    await page.click('.nav-item[data-tab="history"]')
    await expect(page.locator('#panel-history')).toBeVisible()
    await expect(page.locator('#panel-overview')).toBeHidden()
    await page.reload()
    await expect(page.locator('#panel-history')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. 外观系统（真实交互 + localStorage 持久化，键 pg-appearance）
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

  test('切换浅色 + 樱粉背景，刷新后仍保持', async ({ page }) => {
    await page.click('#btn-appearance')
    await expect(page.locator('#appearanceDialog')).toBeVisible()
    await page.click('[data-theme-value="light"]')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await page.click('[data-bg-value="sakura"]')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(true)
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(true)
  })

  test('恢复默认回到深夜/无背景', async ({ page }) => {
    await page.evaluate(() =>
      localStorage.setItem('pg-appearance', JSON.stringify({ theme: 'anime', bgType: 'gradient', bgValue: 'linear-gradient(160deg,#ffd9e8,#e3d5ff)', blur: 20, alpha: 80 })),
    )
    await page.reload()
    await page.click('#btn-appearance')
    await page.click('#ap-reset')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await page.evaluate(() => document.body.classList.contains('has-bg'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. 版本对齐卡（mock 各档形态）
// ---------------------------------------------------------------------------

test.describe('总览 · 版本对齐卡', () => {
  test('四方一致：绿徽标 + 四行检查', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await expect(page.locator('#overall-badge')).toHaveClass(/badge--ok/)
    await expect(page.locator('#overall-badge')).toContainText('四方对齐')
    expect(await page.locator('#align-body .check-row').count()).toBe(4)
    await expect(page.locator('#env-pypi')).toHaveText('0.1.5')
  })

  test('PyPI 落后于 tag：黄徽标 + tag↔PyPI 行给出来龙去脉', async ({ context }) => {
    const state = makeState()
    state.pypi = { latestVersion: '0.1.4', releases: state.pypi.releases.slice(1) }
    state.alignment = alignmentFixture(
      [
        { key: 'manifests', label: '版本文件', status: 'ok', detail: '全部 manifest 一致（0.1.5）' },
        { key: 'local-tag', label: '本地 ↔ tag', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-release', label: 'tag ↔ GitHub', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'warn', detail: 'PyPI（0.1.4）落后最新 tag（0.1.5）——pypi job 可能失败或仍在发布中' },
      ],
      'warn',
    )
    const page = await mockedPage(context, state)
    await expect(page.locator('#overall-badge')).toHaveClass(/badge--warn/)
    await expect(page.locator('.check-row', { hasText: 'tag ↔ PyPI' })).toContainText('落后')
  })

  test('manifest 漂移：红徽标 + 版本文件行异常', async ({ context }) => {
    const state = makeState()
    state.allConsistent = false
    state.alignment = alignmentFixture(
      [{ key: 'manifests', label: '版本文件', status: 'error', detail: 'manifest 版本不一致（以根 package.json 为准逐个核对）' }],
      'error',
    )
    const page = await mockedPage(context, state)
    await expect(page.locator('#overall-badge')).toHaveClass(/badge--err/)
    await expect(page.locator('.check-row', { hasText: '版本文件' })).toContainText('不一致')
  })

  test('数据源缺失记 unknown：不误报异常', async ({ context }) => {
    const state = makeState()
    state.pypi = { error: 'PyPI 元数据获取失败: HTTP 500' }
    state.alignment = alignmentFixture(
      [
        { key: 'manifests', label: '版本文件', status: 'ok', detail: '全部 manifest 一致（0.1.5）' },
        { key: 'local-tag', label: '本地 ↔ tag', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-release', label: 'tag ↔ GitHub', status: 'ok', detail: '一致（0.1.5）' },
        { key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'unknown', detail: 'PyPI 信息暂不可用' },
      ],
      'ok',
    )
    const page = await mockedPage(context, state)
    await expect(page.locator('#overall-badge')).toHaveClass(/badge--ok/)
  })
})

// ---------------------------------------------------------------------------
// 4. 流水线状态卡 + 下载统计卡（mock）
// ---------------------------------------------------------------------------

test.describe('总览 · 流水线与统计', () => {
  test('成功路径：run/job 链接 + PyPI 最新行', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await expect(page.locator('#wf-badge')).toContainText('成功')
    await expect(page.locator('#wf-body a[href*="/actions/runs/123"]')).toHaveCount(2)
    await expect(page.locator('#wf-body')).toContainText('PyPI 最新')
    await expect(page.locator('#wf-body')).toContainText('0.1.5')
  })

  test('pypi job 失败：给出排查指引', async ({ context }) => {
    const state = makeState()
    state.workflow.pypiJob.conclusion = 'failure'
    const page = await mockedPage(context, state)
    await expect(page.locator('#wf-badge')).toContainText('失败')
    await expect(page.locator('#wf-body .err-chip')).toContainText('PyPI 发布 job 失败')
  })

  test('GitHub 403：文案区分"拒绝"并提示 GITHUB_TOKEN', async ({ context }) => {
    const page = await mockedPage(context, makeState({ workflow: { error: 'CD 工作流状态获取失败: HTTP 403' } }))
    await expect(page.locator('#wf-body .err-chip')).toContainText('GitHub 拒绝了请求')
    await expect(page.locator('#wf-body .err-chip')).toContainText('GITHUB_TOKEN')
  })

  test('无 tag 运行：空态引导', async ({ context }) => {
    const page = await mockedPage(context, makeState({ workflow: { latestTagRun: null } }))
    await expect(page.locator('#wf-body')).toContainText('还没有 tag 发布运行')
  })

  test('统计数据：三总量 + 含/不含镜像行 + 双条形图（未知类别单独标注）', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await expect(page.locator('.stat-cell__value').first()).toHaveText('12')
    await expect(page.locator('#stats-body')).toContainText('不含镜像 292')
    await expect(page.locator('#stats-body')).toContainText('含镜像 851')
    expect(await page.locator('.bar-row').count()).toBe(6)
    await expect(page.locator('.bar-row__label', { hasText: '3.12' })).toBeVisible()
    await expect(page.locator('.bar-row__label', { hasText: '未知' })).toHaveCount(2)
    // 未知类弱化为灰条，与真实安装区分
    await expect(page.locator('.bar-row__fill.fill--muted')).toHaveCount(2)
    await expect(page.locator('#stats-body')).toContainText('爬虫、安全扫描器与归档项目')
  })

  test('统计错误：独立错误条不拖累其他卡片', async ({ context }) => {
    const page = await mockedPage(context, makeState({ stats: { error: '下载统计获取失败: fetch failed' } }))
    await expect(page.locator('#stats-body .err-chip')).toContainText('下载统计获取失败')
    await expect(page.locator('#align-body .check-row')).toHaveCount(4)
  })
})

// ---------------------------------------------------------------------------
// 5. 发布历史页（mock）
// ---------------------------------------------------------------------------

test.describe('发布历史页', () => {
  test('版本行：最新徽标 + pypi.org 链接 + 文件与 sha256', async ({ context }) => {
    const page = await mockedPage(context, makeState())
    await page.click('.nav-item[data-tab="history"]')
    await expect(page.locator('#history-body tbody tr')).toHaveCount(2)
    await expect(page.locator('#history-body a[href*="pypi.org/project/precis-cli/0.1.5/"]')).toBeVisible()
    await expect(page.locator('#history-body .sha').first()).toContainText('aaaaaaaaaaaa…')
    await expect(page.locator('#history-body .badge--accent')).toContainText('最新')
  })

  test('yanked 版本与"未记日志"标记', async ({ context }) => {
    const state = makeState()
    state.changelogVersions = ['0.1.5'] // 0.1.4 不在 CHANGELOG
    const page = await mockedPage(context, state)
    await page.click('.nav-item[data-tab="history"]')
    await expect(page.locator('#history-body tr', { hasText: '0.1.4' }).locator('.badge--err')).toContainText('已 yank')
    await expect(page.locator('#history-body tr', { hasText: '0.1.4' }).locator('.badge--warn')).toContainText('未记日志')
  })

  test('PyPI 数据源失败：错误条 + 空态', async ({ context }) => {
    const page = await mockedPage(context, makeState({ pypi: { error: 'PyPI 元数据获取失败: HTTP 500' } }))
    await page.click('.nav-item[data-tab="history"]')
    await expect(page.locator('#history-body .err-chip')).toContainText('PyPI 元数据获取失败')
  })

  test('无版本：空态引导文案', async ({ context }) => {
    const page = await mockedPage(context, makeState({ pypi: { latestVersion: null, releases: [] } }))
    await page.click('.nav-item[data-tab="history"]')
    await expect(page.locator('#history-body')).toContainText('PyPI 上还没有版本')
  })
})

// ---------------------------------------------------------------------------
// 6. 验证页：确认弹窗与请求负载（/api/run 被拦截，绝不真实 pip install）
// ---------------------------------------------------------------------------

test.describe('验证页 · 确认与负载', () => {
  let runs: unknown[]

  test.beforeEach(async ({ context, page }) => {
    runs = []
    await context.route('**/api/state*', (route) => route.fulfill({ json: makeState() }))
    await context.route('**/api/run', async (route) => {
      runs.push(route.request().postDataJSON())
      await route.fulfill({ json: { ok: true } })
    })
    await page.goto('/')
    await page.click('.nav-item[data-tab="verify"]')
  })

  test('版本下拉默认选中线上最新', async ({ page }) => {
    await expect(page.locator('#verify-version')).toHaveValue('0.1.5')
  })

  test('确认弹窗展示版本与安装来源，确认发出正确负载', async ({ page }) => {
    await page.click('#btn-verify')
    const dlg = page.locator('#verifyDialog')
    await expect(dlg).toBeVisible()
    await expect(page.locator('#vd-version')).toHaveText('precis-cli==0.1.5')
    await expect(dlg).toContainText('PyPI 官方源')
    // 关掉弹窗才能操作底下的版本下拉（原生 dialog 是模态的）
    await page.click('#verifyDialog .btn--secondary')
    await expect(dlg).toBeHidden()
    await page.selectOption('#verify-version', '0.1.4')
    await page.click('#btn-verify')
    await expect(page.locator('#vd-version')).toHaveText('precis-cli==0.1.4')
    await page.click('#verifyDialog .btn--primary')
    await expect(dlg).toBeHidden()
    await expect.poll(() => runs.length).toBe(1)
    expect(runs).toEqual([{ action: 'verify-pypi', params: { version: '0.1.4' } }])
  })

  test('取消不发请求', async ({ page }) => {
    await page.click('#btn-verify')
    await expect(page.locator('#verifyDialog')).toBeVisible()
    await page.click('#verifyDialog .btn--secondary')
    await expect(page.locator('#verifyDialog')).toBeHidden()
    expect(runs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. 任务状态与执行过程抽屉（mock SSE）
// ---------------------------------------------------------------------------

test.describe('任务状态与执行过程', () => {
  test('运行中：进度条/侧栏活动点/按钮禁用/终止可用，日志回放', async ({ context }) => {
    const page = await mockedPage(context, makeState(), {
      events: [
        { type: 'history', lines: [
          { stream: 'info', text: '▶ 验证线上包 precis-cli==0.1.5', ts: 1 },
          { stream: 'stdout', text: '  ✔ Python 3.13（python）', ts: 2 },
        ] },
        { type: 'status', job: { running: true, label: '验证线上包 precis-cli==0.1.5', startedAt: Date.now() - 5000, exitCode: null, done: false } },
      ],
    })
    await expect(page.locator('#topbarProgress')).toHaveClass(/is-active/)
    await expect(page.locator('#joblabel')).toHaveText('验证线上包 precis-cli==0.1.5')
    await expect(page.locator('#dot-verify')).toBeVisible()
    await expect(page.locator('#dot-overview')).toBeHidden()
    await expect(page.locator('#btn-verify')).toBeDisabled()
    await expect(page.locator('#btn-kill')).toBeEnabled()
    await expect(page.locator('#log')).toContainText('Python 3.13')
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
// 8. 服务端防护（端到端复验动作白名单与来源边界）
// ---------------------------------------------------------------------------

test.describe('服务端输入防护', () => {
  test('注入向量被 400 拒绝', async ({ request }) => {
    const res = await request.post('/api/run', {
      data: { action: 'verify-pypi', params: { version: '0.1.5; calc' } },
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

  test('外源 Origin 的 POST 被 403 拒绝（跨站无预检 POST 防护）', async ({ request }) => {
    const res = await request.post('/api/run', {
      data: { action: 'verify-pypi', params: { version: '0.1.5' } },
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status()).toBe(403)
  })

  test('GET 接口不受来源校验影响', async ({ request }) => {
    const res = await request.get('/api/state', { headers: { Origin: 'https://evil.example' } })
    expect(res.status()).toBe(200)
  })
})
