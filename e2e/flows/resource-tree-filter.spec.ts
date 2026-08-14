/**
 * @fileoverview 资源树过滤 / projectRoot 选中 / undo-redo / i18n 切换 / 工作区 E2E 测试
 *
 * 覆盖 GUI 手测轮次中发现的回归项与此前自动化无法触达的交互：
 * 1. 资源树过滤框输入关键词 → 命中文件夹自动展开、仅显示匹配条目；清空后恢复
 *    （回归：resourceTreeStore.searchQuery 曾为只读 computed，v-model 写入静默失败）
 * 2. 点击 projectRoot 节点 → 选中态出现、检查器跟随
 *    （回归：projectRoot draggable=false 无 nopan class，d3-zoom 抑制点击）
 * 3. Ctrl+Z 撤销拖入的 Schema 节点、Ctrl+Y 重做恢复（键盘快捷键链路）
 * 4. English 按钮切换界面语言后可切回
 * 5. 新建画布工作区 → 工作区标签出现
 *
 * 注意：本测试需要后端服务运行（地址由 config.ts 的 BACKEND_URL 决定）；
 * 后端未启动时自动 skip（而非失败）。
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

/** 切换到“项目资源”面板并等待资源树可见 */
async function openResourceTree(page: import('@playwright/test').Page) {
  await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10000 })
  return tree
}

/** 展开“数据模型”根文件夹（返回 schemas 子文件夹 locator） */
async function expandDataModelsRoot(page: import('@playwright/test').Page) {
  const tree = page.locator('.resource-tree')
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  await dataModelsRoot.first().click()
  await page.waitForTimeout(500)
  return tree.locator('.tree-folder.nested > .tree-row.folder-row').filter({ hasText: '数据 Schema' })
}

test.describe('GUI 回归补充用例', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 E2E 测试')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('过滤框输入 users：命中文件夹自动展开且仅显示匹配 Schema', async ({ projectPage }) => {
    const page = projectPage
    const tree = await openResourceTree(page)
    const filterInput = page.locator('.search-input')
    await expect(filterInput).toBeVisible()

    // 输入过滤词（v-model 写入链路；修复前该写入静默失败，树无任何变化）
    await filterInput.fill('users')
    await page.waitForTimeout(600)

    // 数据模型根文件夹与 schemas 子文件夹应自动展开
    await expect(
      tree.locator('.tree-row.file-row').filter({ hasText: 'users' }).first()
    ).toBeVisible({ timeout: 5000 })

    // 过滤后 schema 行（排除“项目配置”根行）应全部包含 users
    const visibleSchemaRows = tree.locator('.tree-row.file-row:not(.root-item)')
    const count = await visibleSchemaRows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const text = await visibleSchemaRows.nth(i).textContent()
      expect(text).toContain('users')
    }

    // 清空过滤：orders（fixture 中存在、与 users 无关）应重新可见
    await filterInput.fill('')
    await page.waitForTimeout(600)
    // 展开子文件夹后验证全量恢复
    const schemasNested = await expandDataModelsRoot(page)
    await schemasNested.first().click()
    await page.waitForTimeout(500)
    await expect(
      tree.locator('.tree-row.file-row').filter({ hasText: 'orders' }).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('点击 projectRoot 节点：选中态出现且检查器显示项目信息', async ({ projectPage }) => {
    const page = projectPage
    const rootNode = page.locator('.vue-flow__node').first()
    await expect(rootNode).toBeVisible({ timeout: 10000 })

    // 修复前：draggable=false 节点无 nopan class，点击被 d3-zoom 抑制，永不选中
    await rootNode.click()
    await page.waitForTimeout(600)

    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(1)
    // 检查器应跟随显示项目基本信息（projectRoot 专属检查器）
    await expect(page.getByText('项目基本信息')).toBeVisible({ timeout: 5000 })
  })

  test('undo/redo：拖入 Schema 后 Ctrl+Z 撤销、Ctrl+Y 恢复；粘贴撤销同样有效', async ({
    projectPage,
  }) => {
    const page = projectPage
    await openResourceTree(page)
    const schemasNested = await expandDataModelsRoot(page)
    await schemasNested.first().click()
    await page.waitForTimeout(500)

    const before = await page.locator('.vue-flow__node').count()

    // 拖拽 orders schema 到画布（复用并发关弹窗模式，选“只导 Schema”）
    const schemaItem = page
      .locator('.resource-tree .tree-row.file-row')
      .filter({ hasText: 'orders' })
      .first()
    const canvas = page.locator('.vue-flow__pane')
    let dismissOverlay = true
    const dismissTask = (async () => {
      const overlay = page.locator('.global-confirm-overlay')
      while (dismissOverlay) {
        if (await overlay.isVisible().catch(() => false)) {
          await overlay.getByRole('button', { name: /只导 Schema/ }).click().catch(() => {})
          await expect(overlay).toBeHidden({ timeout: 5000 }).catch(() => {})
        }
        await page.waitForTimeout(150)
      }
    })()
    try {
      await schemaItem.dragTo(canvas, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(1000)
    } finally {
      dismissOverlay = false
      await dismissTask.catch(() => {})
    }

    // 拖拽可能连带物化内嵌约束等关联节点，用相对增量断言
    const afterAdd = await page.locator('.vue-flow__node').count()
    expect(afterAdd).toBeGreaterThan(before)

    // Ctrl+Z 撤销拖入 → 节点数回到拖拽前（撤销覆盖节点创建）
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1200)
    const afterUndo = await page.locator('.vue-flow__node').count()
    expect(afterUndo).toBe(before)

    // Ctrl+Y 重做拖入 → 节点恢复
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(1200)
    const afterRedo = await page.locator('.vue-flow__node').count()
    expect(afterRedo).toBe(afterAdd)

    // 粘贴路径：选中 schema 节点 → 复制粘贴 → 撤销/重做
    const schemaNode = page.locator('.vue-flow__node-schema').first()
    await schemaNode.click()
    await page.waitForTimeout(500)
    await expect(page.locator('.vue-flow__node.selected').first()).toBeVisible({ timeout: 3000 })
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(1000)
    const afterPaste = await page.locator('.vue-flow__node').count()
    expect(afterPaste).toBe(afterAdd + 1)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(800)
    expect(await page.locator('.vue-flow__node').count()).toBe(afterAdd)

    await page.keyboard.press('Control+y')
    await page.waitForTimeout(800)
    expect(await page.locator('.vue-flow__node').count()).toBe(afterAdd + 1)
  })

  test('English 按钮切换语言后可切回中文', async ({ projectPage }) => {
    const page = projectPage
    const nav = page.locator('.activity-bar-nav')

    // 中文模式下语言按钮 title 指示“切到 English”
    const langBtn = nav.locator('button.language-btn')
    await expect(langBtn).toHaveAttribute('title', 'English')

    // 切到英文：导航 title 变为 Toolbox，语言按钮反向指示“简体中文”
    await langBtn.click()
    await expect(nav.locator('.view-btn[title="Toolbox"]')).toBeVisible({ timeout: 5000 })
    await expect(langBtn).toHaveAttribute('title', '简体中文')

    // 切回中文：工具箱 title 恢复
    await langBtn.click()
    await expect(nav.locator('.view-btn[title="工具箱"]')).toBeVisible({ timeout: 5000 })
    await expect(langBtn).toHaveAttribute('title', 'English')
  })

  test('新建画布工作区：点击后新工作区标签出现', async ({ projectPage }) => {
    const page = projectPage
    const tabs = page.locator('.tab-list .tab-item')
    const tabsBefore = await tabs.count()
    expect(tabsBefore).toBeGreaterThanOrEqual(1)

    await page.locator('button.tab-add').click()
    await page.waitForTimeout(800)
    await expect(tabs).toHaveCount(tabsBefore + 1)
    // 新工作区标题为“工作区 N”（N 为最小未占用编号）
    await expect(page.locator('.tab-list .tab-item .tab-title').filter({ hasText: /工作区/ }).last()).toBeVisible()
  })
})
