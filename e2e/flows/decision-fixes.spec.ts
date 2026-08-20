/**
 * @fileoverview 三项决策修复的回归 E2E
 *
 * 1. 撤销覆盖扩展：工具箱拖建节点（草稿）可通过 Ctrl+Z 撤销
 * 2. 校验与配置检查分离：草稿节点（无数据源）导致保存失败时，
 *    校验显示"校验未执行"而非"校验已完成，发现错误 0.0%"
 * 3. 重载草稿守卫：存在草稿节点时点击 ↻ 重载出现三选一提示，
 *    选择"丢弃并重载"后草稿节点消失
 */

import { test, expect } from '../fixtures/base'

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

test.describe('三项决策修复回归', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('工具箱拖建的草稿节点可被 Ctrl+Z 撤销', async ({ projectPage }) => {
    const page = projectPage
    const before = await page.locator('.vue-flow__node').count()

    await dragToolboxTableSchema(page)
    const after = await page.locator('.vue-flow__node').count()
    expect(after).toBeGreaterThan(before)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1200)
    expect(await page.locator('.vue-flow__node').count()).toBe(before)

    await page.keyboard.press('Control+y')
    await page.waitForTimeout(1000)
    expect(await page.locator('.vue-flow__node').count()).toBe(after)
  })

  test('草稿节点不阻断全量校验：保存自动跳过草稿后校验正常执行', async ({ projectPage }) => {
    const page = projectPage
    await dragToolboxTableSchema(page)
    // 草稿 Table Schema 无数据源。d68a7c2（D-1 方案 B）之前：自动保存被草稿
    // BLOCKER 一票否决 → 校验中止显示"校验未执行"；之后：保存自动跳过未完成
    // 草稿，全量校验正常执行到完成态。本用例锁定新契约（旧契约用例随行为废弃）。

    await page.locator('.project-root-node button').filter({ hasText: '全量校验' }).click()
    await page.waitForTimeout(800)
    // 配置视图点击"开始校验"
    await page.locator('.fv-config, [class*="full-validation"], .fv-view')
      .getByRole('button', { name: /开始校验/ }).first().click()

    // 校验应执行到终态（执行完成/校验已完成，含发现错误的完成文案）
    await expect(page.getByText(/执行完成|校验已完成/).first()).toBeVisible({ timeout: 30_000 })
    // 不得停留在"校验未执行"，也不得出现保存失败阶段错误（草稿已跳过、保存成功）
    expect(await page.getByText('校验未执行').count()).toBe(0)
    expect(await page.getByText('保存失败，无法执行全量校验').count()).toBe(0)
  })

  test('存在草稿节点时重载出现三选一提示，丢弃后草稿消失', async ({ projectPage }) => {
    const page = projectPage
    await dragToolboxTableSchema(page)
    const withDraft = await page.locator('.vue-flow__node').count()
    expect(withDraft).toBeGreaterThanOrEqual(2)

    // 草稿断言用类型定向定位（.vue-flow__node-schema）而非总节点数比较：
    // 重载会按 manifest 水合全部节点（qa_simple 含 5 个 templateInstance），
    // 各环境下初始画布对它们的可见性不一致，总数控数（afterReload < withDraft）
    // 在 CI 上会因水合节点多于初始节点而误报
    const draftNodes = page.locator('.vue-flow__node-schema')
    await expect(draftNodes.first()).toBeVisible({ timeout: 5000 })

    // fixture 项目的 templateInstance 节点可能叠在根节点按钮上（拦截 hit-test），
    // 先"整理节点"展开布局，再点击根节点上的 ↻ 重载按钮。
    // 慢环境（CI）下整理动画可持续数秒、按钮长期 not-stable——用重试点击
    // 等待布局稳定，固定等待 + 单次点击会超时。
    await page.locator('button[title="整理节点"]').click().catch(() => {})
    const reloadBtn = page.locator('.project-root-node button.btn-icon').first()
    await expect(async () => {
      await reloadBtn.click({ timeout: 4000 })
    }).toPass({ timeout: 30000 })

    // 三选一确认框出现
    const overlay = page.locator('.global-confirm-overlay')
    await expect(overlay).toBeVisible({ timeout: 5000 })
    await expect(overlay.getByText(/未保存的草稿节点/)).toBeVisible()
    await expect(overlay.getByRole('button', { name: '丢弃并重载' })).toBeVisible()

    // 选择丢弃并重载
    await overlay.getByRole('button', { name: '丢弃并重载' }).click()
    await page.waitForTimeout(3000)

    // 草稿节点消失（manifest 水合的节点数与初始可见性无关，只看草稿类型）
    await expect(draftNodes).toHaveCount(0, { timeout: 10000 })

    // 重载后若配置自检抽屉（blocker 自动展开）遮挡，先关闭再验证工作区切换
    await closeInspectionDrawer(page)
    // 切换工作区 Tab 不复活草稿（快照已被重载结果覆盖）
    const tabs = page.locator('.tab-list .tab-item')
    if ((await tabs.count()) >= 1) {
      await tabs.first().click()
      await page.waitForTimeout(1500)
      await expect(draftNodes).toHaveCount(0)
    }
  })
})
