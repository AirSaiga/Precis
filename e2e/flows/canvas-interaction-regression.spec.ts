/**
 * @fileoverview 画布交互防回归 E2E 测试（2026-08 前端审查修复批次的回归锁）
 *
 * 交叉验证发现：全部 33 个既有 spec 无任何"画布 handle 拖拽连线"用例，
 * 约束/正则全部经 API + 配置文件创建——交互层缺陷因此长期存活。本文件补齐
 * 上一批修复（commit 30da8d5）覆盖的核心手势路径：
 *
 * 1. Conditional 连 IF + THEN 两条边（B4：allowMultiple 判重改 handle 四元组，
 *    修复前同一 Schema→同一 Conditional 的第二条边被静默拒绝）
 * 2. 跨工作区 Tab 切换后 Ctrl+Z 不串味 + 重启恢复激活 Tab 画布
 *    （A2：撤销栈随画布切换清空 + initialize 恢复快照，修复前跨 Tab undo
 *    会把 A 标签节点图灌进 B 标签并经快照覆盖污染持久化数据）
 * 3. Ctrl+D 复制选中节点（A3：修复前 reactive proxy 直接 structuredClone
 *    必抛 DataCloneError，功能 100% 失败）
 * 4. 多选后新建节点选择收敛（C12：修复前框选/多选残留，新建节点后
 *    Delete/Ctrl+C 仍作用于旧集合）
 * 5. Pattern 右键删除走专用 API（B6：修复前误调 /project/regex/{patterns/x}
 *    经 encodeURIComponent 后必然 404，删除永远失败）
 *
 * 注意：需要后端服务运行（config.ts BACKEND_URL）；未启动时自动 skip。
 */

import { test, expect } from '../fixtures/base'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

// ============================================================================
// 公共辅助（模式取自 resource-tree-filter.spec.ts）
// ============================================================================

async function openFixtureProject(page: Page, projectPath: string) {
  await page.goto('/')
  await expect(page.locator('.project-selector')).toBeVisible({ timeout: 15000 })

  const input = page.locator('.project-selector-input')
  await input.fill('')
  await input.fill(projectPath.replace(/\\/g, '/'))

  await page.locator('.project-selector-open-btn').click()

  await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
}

async function closeInspectionDrawer(page: Page) {
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

async function openResourceTree(page: Page) {
  await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10000 })
  return tree
}

async function openToolbox(page: Page) {
  await page.locator('.activity-bar-nav .view-btn[title="工具箱"]').first().click()
  await expect(page.locator('.component-tile[title="Constraint"]')).toBeVisible({ timeout: 10000 })
}

/** 拖拽资源树 Schema 到画布，期间自动关闭"是否连带导入关联约束"确认框（选"只导 Schema"）。
 *  目录展开做幂等处理：已展开时跳过点击（重复点击会折叠）。 */
async function dragSchemaToCanvas(page: Page, schemaName: string) {
  const tree = page.locator('.resource-tree')
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: '数据 Schema' })

  if (!(await schemasNested.first().isVisible().catch(() => false))) {
    await dataModelsRoot.first().click()
    await page.waitForTimeout(500)
  }
  if (!(await schemasNested.first().isVisible().catch(() => false))) {
    throw new Error('数据 Schema 文件夹未展开')
  }
  // 嵌套文件夹的点击同样幂等：schema 文件行已可见时跳过（重复点击会折叠）。
  // 注意只检查嵌套目录内的文件行——"项目配置"根行同样带 file-row class，会误判。
  const anySchemaFileVisible = await tree
    .locator('.tree-folder.nested .tree-row.file-row')
    .first()
    .isVisible()
    .catch(() => false)
  if (!anySchemaFileVisible) {
    await schemasNested.first().click()
    await page.waitForTimeout(500)
  }

  const schemaItem = tree
    .locator('.tree-row.file-row')
    .filter({ hasText: schemaName })
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
}

/** 工具箱 → 约束面板 → 点击指定约束类型，创建独立约束节点 */
async function createConstraintFromToolbox(page: Page, constraintName: string) {
  await openToolbox(page)
  await page.locator('.component-tile[title="Constraint"] .tile-expand-icon').click()
  const panel = page.locator('.constraint-panel')
  await expect(panel).toBeVisible({ timeout: 5000 })
  await panel
    .locator('.constraint-type-item')
    .filter({ hasText: constraintName })
    .first()
    .click()
  await page.waitForTimeout(800)
}

/**
 * 基于 mouse 事件的 handle→handle 连线（绕开 Playwright dragTo 的可见性断言——
 * Vue Flow handle 常以透明样式渲染，boundingBox 仍存在）。
 * drop 前在目标附近微移并留足 hover 注册时间：慢环境（CI）下 Vue Flow
 * 需要若干帧处理 pointermove 才把目标 handle 标记为可投放，150ms 不够时
 * 连线会被静默丢弃（边数不增加）。
 */
async function dragConnection(page: Page, from: Locator, to: Locator) {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  if (!fromBox || !toBox) {
    throw new Error('连线端点 handle 不存在或未渲染')
  }
  const tx = toBox.x + toBox.width / 2
  const ty = toBox.y + toBox.height / 2
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tx, ty, { steps: 20 })
  // 微移两次刷新 hover 状态 + 给 Vue Flow 足够的 drop 目标注册时间
  await page.mouse.move(tx + 2, ty + 1, { steps: 2 })
  await page.mouse.move(tx, ty, { steps: 2 })
  await page.waitForTimeout(400)
  await page.mouse.up()
}

/** 把节点拖到指定视口坐标（抓取标题栏区域，避开右侧操作按钮） */
async function moveNodeTo(page: Page, node: Locator, x: number, y: number) {
  const box = await node.boundingBox()
  if (!box) throw new Error('待拖动节点不存在')
  await page.mouse.move(box.x + 30, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(x + 30, y + 12, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const countNodes = (page: Page) => page.locator('.vue-flow__node').count()
const countEdges = (page: Page) => page.locator('.vue-flow__edge').count()

// ============================================================================
// 用例
// ============================================================================

test.describe('画布交互防回归（2026-08 修复批次回归锁）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 E2E 测试')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('Conditional 可从同一 Schema 连出 IF 与 THEN 两条边（handle 粒度判重）', async ({
    projectPage,
  }) => {
    const page = projectPage
    // 加大视口：默认 1280×720 下，放在 Schema 下方的 Conditional 节点
    // 其 IF handle（节点高度 30% 处）会超出视口底部，连线落点无法解析
    await page.setViewportSize({ width: 1760, height: 1100 })

    // 1. 拖入 customers schema（6 列，含多个列输出 handle）
    await openResourceTree(page)
    await dragSchemaToCanvas(page, 'customers')
    const nodeCount = await countNodes(page)
    expect(nodeCount).toBeGreaterThan(1)

    // 2. 工具箱创建独立 Conditional 节点，移到 Schema 正下方的空白区域
    //    （默认创建位置可能靠近右侧检查器面板，handle 落点会被面板遮挡导致连线失败）
    await createConstraintFromToolbox(page, '条件约束')
    const condNode = page.locator('.vue-flow__node-conditionalConstraint')
    await expect(condNode).toHaveCount(1, { timeout: 5000 })
    const schemaNode = page.locator('.vue-flow__node-schema').first()
    const schemaBox = await schemaNode.boundingBox()
    if (!schemaBox) throw new Error('schema 节点不存在')
    await moveNodeTo(page, condNode, schemaBox.x - 40, schemaBox.y + schemaBox.height + 90)

    // 3. 连第一条边：列 1 → IF handle
    const colHandles = schemaNode.locator('.column-source-handle')
    expect(await colHandles.count()).toBeGreaterThanOrEqual(2)
    const ifHandle = condNode.locator('[data-handleid^="target-if-"]')
    const thenHandle = condNode.locator('[data-handleid^="target-then-"]')
    await expect(ifHandle).toHaveCount(1)
    await expect(thenHandle).toHaveCount(1)

    const edgesBefore = await countEdges(page)
    await dragConnection(page, colHandles.nth(0), ifHandle)
    await page.waitForTimeout(800)
    // 第一条边建立成功
    expect(await countEdges(page)).toBeGreaterThanOrEqual(edgesBefore + 1)

    // 第一条边会触发约束节点的异步校验与 schema 列表的自动滚动（已连列
    // 滚入视野 → 虚拟锚点同步 → handle 位移），慢环境下恰在第二条拖拽的
    // boundingBox 读取与 mouse.down 之间发生，拖拽落空、边被静默丢弃。
    // 等两个节点几何都稳定后，用"重试拖拽直到边出现"兜底。
    await expect(async () => {
      const read = async () => {
        const c = await condNode.boundingBox()
        const s = await schemaNode.boundingBox()
        return c && s ? `${c.y},${c.height};${s.y},${s.height}` : 'null'
      }
      const a = await read()
      await page.waitForTimeout(500)
      expect(await read()).toBe(a)
    }).toPass({ timeout: 10000 })

    // 4. 回归锁：第二条边（列 2 → THEN handle）不再被节点对判重静默拒绝
    await expect(async () => {
      if ((await countEdges(page)) < edgesBefore + 2) {
        await dragConnection(page, colHandles.nth(1), thenHandle)
        await page.waitForTimeout(600)
      }
      expect(await countEdges(page)).toBeGreaterThanOrEqual(edgesBefore + 2)
    }).toPass({ timeout: 20000 })
  })

  test('跨工作区 Tab 切换后 Ctrl+Z 不串味；重启后激活 Tab 画布恢复', async ({ projectPage }) => {
    const page = projectPage

    // 1. Tab 1 拖入 schema（产生撤销历史）
    await openResourceTree(page)
    await dragSchemaToCanvas(page, 'customers')
    const afterAdd = await countNodes(page)
    expect(afterAdd).toBeGreaterThan(1)

    // 2. 新建 Tab 2：画布重置为仅 projectRoot
    await page.locator('button.tab-add').click()
    await page.waitForTimeout(1000)
    expect(await countNodes(page)).toBe(1)

    // 3. 回归锁：Tab 2 内 Ctrl+Z 是空操作（修复前会把 Tab 1 的节点图灌进来）
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1200)
    expect(await countNodes(page)).toBe(1)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(800)
    expect(await countNodes(page)).toBe(1)

    // 4. 切回 Tab 1：schema 快照仍在（未被脏数据覆盖）
    await page.locator('.tab-list .tab-item').first().click()
    await page.waitForTimeout(1200)
    expect(await countNodes(page)).toBe(afterAdd)

    // 5. 回归锁：刷新重启后，激活 Tab（Tab 1）的上次画布被恢复而非仅 projectRoot
    await page.reload()
    await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
    await closeInspectionDrawer(page)
    await page.waitForTimeout(1500)
    expect(await countNodes(page)).toBe(afterAdd)
    await expect(page.locator('.vue-flow__node-schema').first()).toBeVisible({ timeout: 10000 })
  })

  test('Ctrl+D 复制选中节点成功且可撤销（修复前必抛 DataCloneError）', async ({ projectPage }) => {
    const page = projectPage

    await openResourceTree(page)
    await dragSchemaToCanvas(page, 'customers')
    const afterAdd = await countNodes(page)

    // 选中 schema 节点
    const schemaNode = page.locator('.vue-flow__node-schema').first()
    await schemaNode.click()
    await page.waitForTimeout(500)
    await expect(page.locator('.vue-flow__node.selected').first()).toBeVisible({ timeout: 3000 })

    // 回归锁：复制成功，节点数 +1（修复前 structuredClone(proxy) 抛错，无新节点）
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(1000)
    expect(await countNodes(page)).toBe(afterAdd + 1)

    // 复制已正确入撤销栈
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(800)
    expect(await countNodes(page)).toBe(afterAdd)
  })

  test('多选后新建节点：选中集收敛为新节点（修复前旧多选残留）', async ({ projectPage }) => {
    const page = projectPage

    // 画布放入两个 schema（默认都落在画布中心，移开第二个避免重叠遮挡点击）
    await openResourceTree(page)
    await dragSchemaToCanvas(page, 'customers')
    await dragSchemaToCanvas(page, 'products')
    const schemas = page.locator('.vue-flow__node-schema')
    await expect(schemas).toHaveCount(2, { timeout: 5000 })
    const productsBox = await schemas.nth(1).boundingBox()
    if (productsBox) {
      await moveNodeTo(page, schemas.nth(1), Math.max(60, productsBox.x - 420), Math.max(60, productsBox.y - 220))
    }

    // 普通点击 A 选中；Ctrl 按住点击 B 追加为多选。
    // Vue Flow 的点击多选键是 multiSelectionKeyCode（Windows 默认 Control，Mac 为 Meta），
    // Shift 仅是框选键。注意：click({modifiers}) 不派发 keydown，VF 的按键监听
    // 收不到——必须用 keyboard.down 显式按键。
    await schemas.nth(0).click()
    await page.waitForTimeout(400)
    await page.keyboard.down('Control')
    await schemas.nth(1).click()
    await page.keyboard.up('Control')
    await page.waitForTimeout(600)
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(2)

    // 新建 Conditional 节点（工厂 autoSelect）
    await createConstraintFromToolbox(page, '条件约束')
    await expect(page.locator('.vue-flow__node-conditionalConstraint')).toHaveCount(1, {
      timeout: 5000,
    })

    // 回归锁：选中集收敛为新建节点（修复前旧的两个 schema 仍处于选中态）
    await page.waitForTimeout(500)
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(1)
    await expect(page.locator('.vue-flow__node-conditionalConstraint.selected')).toHaveCount(1)
  })

  test('Pattern 右键删除走专用 API 后资源树条目消失（修复前必然 404）', async ({ projectPage }) => {
    const page = projectPage

    const tree = await openResourceTree(page)

    // 展开层级：校验资产库 → 正则中心 → 正则表达式注册表，找到 fixture 中的 semver Pattern
    const expandFolder = async (label: string) => {
      const folder = tree.locator('.tree-row.folder-row').filter({ hasText: label }).first()
      await expect(folder).toBeVisible({ timeout: 5000 })
      await folder.click()
      await page.waitForTimeout(600)
    }
    await expandFolder('校验资产库')
    await expandFolder('正则中心')
    await expandFolder('正则表达式注册表')

    const semverRow = tree.locator('.tree-row.file-row').filter({ hasText: 'semver' }).first()
    await expect(semverRow).toBeVisible({ timeout: 5000 })

    // 右键 → 删除 → 确认
    await semverRow.click({ button: 'right' })
    const menu = page.locator('.resource-context-menu')
    await expect(menu).toBeVisible({ timeout: 5000 })
    await menu.getByText('删除', { exact: true }).first().click()

    const overlay = page.locator('.global-confirm-overlay')
    await expect(overlay).toBeVisible({ timeout: 5000 })
    await overlay.getByRole('button', { name: '确认' }).click()
    await expect(overlay).toBeHidden({ timeout: 5000 })

    // 回归锁：删除成功，条目从资源树消失（修复前 DELETE /project/regex/patterns%2Fsemver 404，
    // 错误 toast + 条目保留）
    await page.waitForTimeout(1500)
    await expect(tree.locator('.tree-row.file-row').filter({ hasText: 'semver' })).toHaveCount(0)
  })
})
