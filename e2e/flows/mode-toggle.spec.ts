/**
 * @fileoverview IDE / Agent 模式切换 E2E 测试
 *
 * 覆盖模式切换的核心行为：
 * 1. 默认 IDE 模式（四栏布局可见）
 * 2. IDE → Agent 切换（AgentLayout 出现，IDE 布局隐藏，ModeToggle 激活态切换）
 * 3. Agent → IDE 反向切换
 * 4. 切换后画布节点数据保留（graphStore 单例跨重建）
 * 5. AI 状态条（AgentStatusBar）在两种模式下都通过 AppStatusBar 共享渲染
 *
 * 注意：本测试需要后端服务运行在 http://localhost:18000；
 * 后端未启动时自动 skip（而非失败）。
 */

import { test, expect } from '../fixtures/base'

/**
 * 通过项目选择器打开 fixture 项目（Web 模式）。
 *
 * 复用自 ui-canvas-interactions.spec.ts 的同名 helper（项目惯例：本地定义而非抽公共）。
 */
async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await page.goto('/')
  await expect(page.locator('.project-selector')).toBeVisible({ timeout: 15000 })

  const input = page.locator('.project-selector-input')
  await input.fill('')
  await input.fill(projectPath.replace(/\\/g, '/'))

  await page.locator('.project-selector-open-btn').click()

  // 等待主应用加载完成（以项目根节点出现为标志）
  await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
}

/**
 * 关闭可能自动弹出的"配置自检"抽屉。
 *
 * 项目加载后若自检发现 blocker，InspectionDrawer 会以全屏遮罩自动打开，拦截后续点击。
 * 幂等：抽屉不可见时直接返回。复用自 ui-canvas-interactions.spec.ts。
 */
async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  const drawer = page.locator('.inspection-drawer')
  await page.waitForTimeout(800)
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.locator('button[title="关闭"]').first().click({ timeout: 5000 })
    await expect(drawer).toBeHidden({ timeout: 5000 })
  }
}

test.describe('IDE / Agent 模式切换', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过模式切换 E2E 测试')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('默认进入 IDE 模式，四栏布局可见', async ({ projectPage }) => {
    const page = projectPage
    // IDE 布局根节点可见
    await expect(page.locator('.app-layout')).toBeVisible()
    // Agent 布局不存在
    await expect(page.locator('.agent-layout')).toHaveCount(0)
    // ModeToggle 的 IDE 段处于激活态
    await expect(
      page.locator('.mode-toggle-option', { hasText: 'IDE' }).first()
    ).toHaveClass(/\bactive\b/)
    // 滑块未带 is-agent
    await expect(page.locator('.mode-toggle-thumb').first()).not.toHaveClass(/\bis-agent\b/)
  })

  test('IDE → Agent 切换：AgentLayout 出现，IDE 布局隐藏', async ({ projectPage }) => {
    const page = projectPage
    // 点击 Agent 段（按钮文案中英文均为 "Agent"）
    await page.locator('.mode-toggle-option', { hasText: 'Agent' }).first().click()

    // out-in 过渡需要等待旧布局淡出、新布局淡入（~500ms），给足超时
    await expect(page.locator('.agent-layout')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.app-layout')).toHaveCount(0)

    // Agent 段激活，滑块带 is-agent
    await expect(
      page.locator('.mode-toggle-option', { hasText: 'Agent' }).first()
    ).toHaveClass(/\bactive\b/)
    await expect(page.locator('.mode-toggle-thumb').first()).toHaveClass(/\bis-agent\b/)

    // Agent 模式下 AI 对话面板可见
    await expect(page.locator('.agent-chat-pane')).toBeVisible()
    // 画布仍在（NodeCanvas 在 agent-canvas-pane 内重建）
    await expect(page.locator('.vue-flow__pane')).toBeVisible({ timeout: 10000 })
  })

  test('Agent → IDE 反向切换', async ({ projectPage }) => {
    const page = projectPage
    // 先切到 Agent
    await page.locator('.mode-toggle-option', { hasText: 'Agent' }).first().click()
    await expect(page.locator('.agent-layout')).toBeVisible({ timeout: 5000 })

    // 再切回 IDE
    await page.locator('.mode-toggle-option', { hasText: 'IDE' }).first().click()
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.agent-layout')).toHaveCount(0)

    // IDE 段激活
    await expect(
      page.locator('.mode-toggle-option', { hasText: 'IDE' }).first()
    ).toHaveClass(/\bactive\b/)
  })

  test('切换后画布节点数据保留（graphStore 单例）', async ({ projectPage }) => {
    const page = projectPage
    // IDE 模式下项目根节点存在
    await expect(page.locator('.project-root-node')).toBeVisible()

    // 切到 Agent：NodeCanvas 重建，但 graphStore 是 Pinia 单例，节点数据应保留
    await page.locator('.mode-toggle-option', { hasText: 'Agent' }).first().click()
    await expect(page.locator('.agent-layout')).toBeVisible({ timeout: 5000 })
    // 重建后项目根节点仍在
    await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 15000 })

    // 切回 IDE：再次重建，节点仍在
    await page.locator('.mode-toggle-option', { hasText: 'IDE' }).first().click()
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 15000 })
  })

  test('AppStatusBar 在两种模式下都可见（AI 状态共享）', async ({ projectPage }) => {
    const page = projectPage
    // IDE 模式下状态栏可见（含项目信息）
    await expect(page.locator('.status-bar')).toBeVisible()
    await expect(page.locator('.project-chip')).toBeVisible()

    // 切到 Agent：AppStatusBar 仍可见（两种布局都渲染 AppStatusBar）
    await page.locator('.mode-toggle-option', { hasText: 'Agent' }).first().click()
    await expect(page.locator('.agent-layout')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.status-bar')).toBeVisible()
    await expect(page.locator('.project-chip')).toBeVisible()
  })
})
