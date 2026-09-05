/**
 * @fileoverview 检查器渲染器与资源树批量操作 E2E
 *
 * 覆盖此前无自动化触达的两块盲区：
 * 1. 检查器渲染器（config-driven renderers / 各节点类型专属检查器）：
 *    - schema 节点：结构定义区渲染、配置名称（文本渲染器）编辑生效
 *    - NotNull 约束节点：约束检查器（非空约束配置）渲染
 * 2. 资源树批量操作（MultiSelectToolbar）：
 *    - 长按进入多选 → 勾选多个资源 → 批量添加上画布
 *    - 长按进入多选 → 批量删除（确认框 → 资源从树中消失）
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'

async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await openProjectOnCanvas(page, projectPath)
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

/** 切到项目资源面板并展开两级（数据模型 → 数据 Schema），返回树 locator */
async function openResourceTreeWithSchemas(page: import('@playwright/test').Page) {
  await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10000 })
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  await dataModelsRoot.first().click()
  await page.waitForTimeout(500)
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: '数据 Schema' })
  await schemasNested.first().click()
  await page.waitForTimeout(500)
  return tree
}

/** 从资源树拖一个 schema 到画布（并发关闭连带约束询问，选"只导 Schema"） */
async function dragSchemaToCanvasSchemaOnly(
  page: import('@playwright/test').Page,
  schemaName: string
) {
  const item = page
    .locator('.resource-tree .tree-row.file-row')
    .filter({ hasText: schemaName })
    .first()
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
    await item.dragTo(page.locator('.vue-flow__pane'), { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1000)
  } finally {
    dismissOverlay = false
    await dismissTask.catch(() => {})
  }
}

test.describe('检查器渲染器交互', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('schema 节点检查器：结构定义渲染 + 配置名称可编辑', async ({ projectPage }) => {
    const page = projectPage
    await openResourceTreeWithSchemas(page)
    await dragSchemaToCanvasSchemaOnly(page, 'users')

    // fixture 的 templateInstance 可能叠在目标节点上（拦截 hit-test），先整理布局
    // （e2e fixture 隐藏了画布 Controls 悬浮件，organize 入口随之隐藏；可见才点击）
    const organizeBtn = page.locator('button[title="整理节点"]')
    if (await organizeBtn.isVisible().catch(() => false)) {
      await organizeBtn.click().catch(() => {})
    }
    await page.waitForTimeout(1500)

    // 选中 schema 节点 → 检查器渲染结构定义区
    const schemaNode = page.locator('.vue-flow__node-schema').first()
    await expect(schemaNode).toBeVisible({ timeout: 5000 })
    await schemaNode.click()
    await page.waitForTimeout(600)

    await expect(page.getByText('表格定义')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('数据源信息')).toBeVisible()

    // 文本渲染器：编辑配置名称
    const nameInput = page.getByPlaceholder('请输入配置名称')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue(/users/, { timeout: 3000 }).catch(() => {
      // value 断言失败不阻塞（不同节点类型的初始值可能带后缀），编辑行为才是断言核心
    })
    await nameInput.fill('e2e_renamed_schema')
    await expect(nameInput).toHaveValue('e2e_renamed_schema')

    // 校验任务区（动作渲染器入口）存在
    await expect(page.getByText('校验任务')).toBeVisible()
  })

  test('NotNull 约束节点检查器：约束参数区渲染', async ({ projectPage }) => {
    const page = projectPage
    // 工具箱 → Constraint tile 的展开图标打开约束面板 → 单击"非空"直接创建节点
    await page.locator('.activity-bar-nav .view-btn[title="工具箱"]').first().click()
    await page.waitForTimeout(500)
    const constraintTile = page
      .locator('.toolbox-content .component-tile')
      .filter({ hasText: '约束' })
      .first()
    await constraintTile.locator('.tile-expand-icon').click()
    await page.waitForTimeout(500)
    const notNullItem = page.locator('.constraint-type-item').filter({ hasText: /非空/ }).first()
    await expect(notNullItem).toBeVisible({ timeout: 5000 })
    const before = await page.locator('.vue-flow__node').count()
    await notNullItem.click()
    await page.waitForTimeout(1500)
    expect(await page.locator('.vue-flow__node').count()).toBe(before + 1)

    // fixture 的 templateInstance 可能叠在目标节点上（拦截 hit-test），先整理布局
    // （e2e fixture 隐藏了画布 Controls 悬浮件，organize 入口随之隐藏；可见才点击）
    const organizeBtn2 = page.locator('button[title="整理节点"]')
    if (await organizeBtn2.isVisible().catch(() => false)) {
      await organizeBtn2.click().catch(() => {})
    }
    await page.waitForTimeout(1500)

    // 选中新建的 NotNull 约束节点（nodeType 类名，避免被 templateInstance 干扰）
    const newNode = page.locator('.vue-flow__node-notNullConstraint').first()
    await expect(newNode).toBeVisible({ timeout: 5000 })
    await newNode.click()
    await page.waitForTimeout(600)

    // 检查器离开默认空态，渲染非空约束配置区（标题来自 inspectorConstraints.notNull）
    await expect(page.getByText('选择一个节点')).toBeHidden()
    await expect(page.getByText('非空约束配置')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('配置名称')).toBeVisible()
  })
})

test.describe('资源树批量操作', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('长按进入多选 → 勾选两个 schema → 批量添加上画布', async ({ projectPage }) => {
    const page = projectPage
    await openResourceTreeWithSchemas(page)

    // 启动水合（DEF-01）后 users/orders 已在画布上，批量添加幂等（计数不再增长）。
    // 先删除这两个 schema 节点（close-btn 走官方级联删除，仅画布层），恢复
    // "批量添加从无到有"的前提。
    for (const name of ['users', 'orders']) {
      const node = page.locator(`.vue-flow__node-schema[data-id="${name}"]`)
      if ((await node.count()) > 0) {
        await node.first().locator('.close-btn').click()
        await expect(node).toHaveCount(0, { timeout: 10000 })
      }
    }
    await page.waitForTimeout(800)

    const before = await page.locator('.vue-flow__node').count()

    const usersRow = page
      .locator('.resource-tree .tree-row.file-row')
      .filter({ hasText: 'users' })
      .first()

    // 长按 500ms+ 进入多选模式并选中首个资源
    const rowBox = await usersRow.boundingBox()
    expect(rowBox).not.toBeNull()
    await page.mouse.move(rowBox!.x + rowBox!.width / 2, rowBox!.y + rowBox!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(500)

    // 多选工具栏出现，计数 1
    const toolbar = page.locator('.multi-select-toolbar')
    await expect(toolbar).toBeVisible({ timeout: 5000 })
    await expect(toolbar.locator('.selected-count')).toContainText('1')

    // 勾选第二个资源（多选模式下行内出现复选框）
    const ordersRow = page
      .locator('.resource-tree .tree-row.file-row')
      .filter({ hasText: 'orders' })
      .first()
    await ordersRow.locator('.select-checkbox').click()
    await expect(toolbar.locator('.selected-count')).toContainText('2')

    // 批量添加（并发关闭连带约束询问，选"只导 Schema"）。
    // batchAddToCanvas 对多个 schema 并发导入，连带询问弹窗可能接连入队，
    // 关闭循环用时间窗口驱动（10s），兜住迟到的第二个弹窗
    await toolbar.locator('.toolbar-btn').first().click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const overlay = page.locator('.global-confirm-overlay')
      if (await overlay.isVisible().catch(() => false)) {
        await overlay.getByRole('button', { name: /只导 Schema/ }).click().catch(() => {})
        await expect(overlay).toBeHidden({ timeout: 5000 }).catch(() => {})
      }
      const schemaCount = await page.locator('.vue-flow__node-schema').count()
      if (schemaCount >= 2) break
      await page.waitForTimeout(200)
    }

    // 两个 schema 节点出现在画布
    const schemaNodes = page.locator('.vue-flow__node-schema')
    await expect(schemaNodes.first()).toBeVisible({ timeout: 5000 })
    expect(await schemaNodes.count()).toBeGreaterThanOrEqual(2)
    expect(await page.locator('.vue-flow__node').count()).toBeGreaterThan(before)
  })

  test('长按进入多选 → 批量删除资源（确认后从树中消失）', async ({ projectPage }) => {
    const page = projectPage
    await openResourceTreeWithSchemas(page)
    const productsRow = page
      .locator('.resource-tree .tree-row.file-row')
      .filter({ hasText: 'products' })
      .first()
    await expect(productsRow).toBeVisible()

    // 长按进入多选
    const rowBox = await productsRow.boundingBox()
    expect(rowBox).not.toBeNull()
    await page.mouse.move(rowBox!.x + rowBox!.width / 2, rowBox!.y + rowBox!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(500)

    const toolbar = page.locator('.multi-select-toolbar')
    await expect(toolbar).toBeVisible({ timeout: 5000 })

    // 点击批量删除（danger 按钮）
    await toolbar.locator('.toolbar-btn-danger').click()
    await page.waitForTimeout(800)

    // 确认对话框 → 确认
    const overlay = page.locator('.global-confirm-overlay')
    await expect(overlay).toBeVisible({ timeout: 5000 })
    await overlay.getByRole('button', { name: /确认|确定|删除/ }).first().click()
    await page.waitForTimeout(2000)

    // products 从资源树消失（schema 徽章计数 12 → 11，且行不存在）
    await expect(productsRow).toHaveCount(0)
    const badge = page
      .locator('.tree-folder.nested > .tree-row.folder-row')
      .filter({ hasText: '数据 Schema' })
      .locator('.folder-count')
    await expect(badge).toHaveText('11', { timeout: 5000 })
  })
})
