/**
 * @fileoverview 项目管理弹窗"打开/切换项目"路径回归
 *
 * 覆盖盲区：该路径的 useProjectReload 守卫在事件处理器上下文调用（历史上曾因
 * 内部 useI18n() 抛 MUST_BE_CALL_SETUP_TOP 导致整条路径不可用），且 e2e 均经
 * 环境变量/选择器注入项目、从不经过弹窗 UI，使其成为无 CI 覆盖的回归盲区。
 *
 * 入口选择：Chromium 支持 webkitdirectory → dialogApi.canSelectDirectoryEntries
 * 为 true → 弹窗渲染"选择项目文件夹"分支而非 Web 路径输入框。因此用"最近项目"
 * 列表驱动（handleOpenRecentProject → loadProject，与 Web 输入共用同一守卫路径），
 * 目标项目通过 localStorage 的 recentProjects 预置。
 *
 * 覆盖：
 * 1. 无草稿：经弹窗最近项目切换 → 弹窗关闭、状态栏项目名切换为目标项目
 * 2. 有草稿：切换前出现三选一确认（load 模式文案），丢弃并切换后加载目标项目
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { QA_SIMPLE_SOURCE } from '../fixtures/base'

const SOURCE_MANIFEST_PROJECT_BLOCK = '  id: qa_simple\n  name: QA 测试工程（统一测试集）'
const SECOND_PROJECT_ID = 'qa_switch_target'
const SECOND_PROJECT_NAME = 'QA 切换目标工程'

/** 制作第二个可区分的项目副本（改写 manifest 的 project.id/name），返回临时目录 */
function makeSecondProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-e2e-switch-'))
  fs.cpSync(QA_SIMPLE_SOURCE, dir, { recursive: true })
  const manifestPath = path.join(dir, 'project.precis.yaml')
  const content = fs.readFileSync(manifestPath, 'utf-8')
  // 原件结构漂移时立即失败，避免静默退化为"两个同名项目"使断言失去区分度
  if (!content.includes(SOURCE_MANIFEST_PROJECT_BLOCK)) {
    throw new Error(`qa_simple manifest 缺少预期的 project 块: ${SOURCE_MANIFEST_PROJECT_BLOCK}`)
  }
  fs.writeFileSync(
    manifestPath,
    content.replace(
      SOURCE_MANIFEST_PROJECT_BLOCK,
      `  id: ${SECOND_PROJECT_ID}\n  name: ${SECOND_PROJECT_NAME}`
    ),
    'utf-8'
  )
  return dir
}

async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await page.goto('/')
  await expect(page.locator('.project-selector')).toBeVisible({ timeout: 15000 })
  const input = page.locator('.project-selector-input')
  await input.fill('')
  await input.fill(projectPath.replace(/\\/g, '/'))
  await page.locator('.project-selector-open-btn').click()
  await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
}

async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  // blocker 级自检会让抽屉延迟自动展开（含入场动画），且可能晚于加载后 800ms 才
  // 出现并拦截后续点击——轮询约 3s，出现即关闭，直至窗口期内不再出现
  const drawer = page.locator('.inspection-drawer')
  for (let i = 0; i < 6; i++) {
    if (await drawer.isVisible().catch(() => false)) {
      await drawer
        .locator('button[title="关闭"]')
        .first()
        .click({ timeout: 5000 })
        .catch(() => {})
      await expect(drawer).toBeHidden({ timeout: 5000 }).catch(() => {})
    }
    await page.waitForTimeout(500)
  }
}

/** 从工具箱拖拽 Table Schema 到画布，产生一个草稿节点 */
async function dragToolboxTableSchema(page: import('@playwright/test').Page) {
  await page.locator('.activity-bar-nav .view-btn[title="工具箱"]').first().click()
  await page.waitForTimeout(500)
  const item = page
    .locator('.toolbox-content .component-tile')
    .filter({ hasText: 'Table Schema' })
    .first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.dragTo(page.locator('.vue-flow__pane'), { timeout: 10000 })
  await page.waitForTimeout(1200)
}

/** 把目标项目预置进 localStorage 的最近项目列表（recentProjects） */
async function seedRecentProject(page: import('@playwright/test').Page, dir: string) {
  await page.evaluate(
    ({ p, n }) => {
      localStorage.setItem(
        'recentProjects',
        JSON.stringify([{ name: n, path: p, lastOpened: Date.now() }])
      )
    },
    { p: dir.replace(/\\/g, '/'), n: SECOND_PROJECT_NAME }
  )
}

/** 经项目管理弹窗的最近项目条目切换到目标项目 */
async function switchViaModal(page: import('@playwright/test').Page, targetDir: string) {
  const targetPath = targetDir.replace(/\\/g, '/')
  await page.locator('.project-chip').click()
  const overlay = page.locator('.project-management-overlay')
  await expect(overlay).toBeVisible({ timeout: 5000 })

  const item = overlay.locator('.recent-project-item').filter({ hasText: targetPath })
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  return overlay
}

test.describe('项目管理弹窗切换项目', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
    // 起点断言：当前为源项目（后续切换断言才有区分度）
    await expect(projectPage.locator('.project-chip .project-name')).toHaveText(/QA 测试工程/, {
      timeout: 10000,
    })
  })

  test('无草稿时经弹窗最近项目直接切换到目标项目', async ({ projectPage }) => {
    const page = projectPage
    const secondDir = makeSecondProject()
    try {
      await seedRecentProject(page, secondDir)
      const overlay = await switchViaModal(page, secondDir)

      // 切换成功：弹窗关闭、画布根节点就位、状态栏项目名变为目标项目
      await expect(overlay).toBeHidden({ timeout: 15000 })
      await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('.project-chip .project-name')).toHaveText(SECOND_PROJECT_NAME, {
        timeout: 10000,
      })
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true })
    }
  })

  test('有草稿节点时切换出现三选一确认，丢弃并切换后加载目标项目', async ({ projectPage }) => {
    const page = projectPage
    const secondDir = makeSecondProject()
    try {
      await dragToolboxTableSchema(page)
      await expect(page.locator('.vue-flow__node-schema').first()).toBeVisible({ timeout: 5000 })

      await seedRecentProject(page, secondDir)
      await switchViaModal(page, secondDir)

      // load 模式三选一确认（区别于重载入口的"丢弃并重载"文案）
      const confirm = page.locator('.global-confirm-overlay')
      await expect(confirm).toBeVisible({ timeout: 5000 })
      await expect(confirm.getByText(/未保存的草稿节点/)).toBeVisible()
      await expect(confirm.getByRole('button', { name: '保存后切换' })).toBeVisible()
      await expect(confirm.getByRole('button', { name: '丢弃并切换' })).toBeVisible()

      await confirm.getByRole('button', { name: '丢弃并切换' }).click()

      // 丢弃后切换继续：确认框与弹窗关闭，目标项目加载完成
      await expect(confirm).toBeHidden({ timeout: 5000 })
      await expect(page.locator('.project-chip .project-name')).toHaveText(SECOND_PROJECT_NAME, {
        timeout: 15000,
      })
      await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 15000 })
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true })
    }
  })
})
