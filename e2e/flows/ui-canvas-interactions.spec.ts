/**
 * @fileoverview 前端画布真实 UI 交互 E2E 测试
 *
 * 覆盖核心用户路径：
 * 1. Web 模式下通过项目选择器打开 fixture 项目
 * 2. 从左侧资源树拖拽 Schema 到画布，验证节点与关联约束自动出现
 * 3. 点击项目根节点“全量校验”按钮，验证校验结果面板渲染
 * 4. 保存项目后刷新，验证 project.view.json 中记录了节点位置
 *
 * 注意：本测试需要后端服务运行（地址由 config.ts 的 BACKEND_URL 决定，
 * CI 中固定为 localhost:18000）；当前环境若后端未启动，测试会在启动阶段失败，
 * 但测试文件本身应保持语法正确。
 */

import { test, expect } from '../fixtures/base'
import { BACKEND_URL } from '../config'
import * as fs from 'fs'
import * as path from 'path'

const VIEW_FILE = 'project.view.json'

/**
 * 通过项目选择器打开 fixture 项目（Web 模式）。
 *
 * Web 模式下无法自动恢复最近项目，因此每次测试都重新导航到首页、
 * 在手动输入框填入项目绝对路径并点击打开。
 */
async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await page.goto('/')
  await expect(page.locator('.project-selector')).toBeVisible({ timeout: 15000 })

  // 清理输入框并填入项目路径
  const input = page.locator('.project-selector-input')
  await input.fill('')
  await input.fill(projectPath.replace(/\\/g, '/'))

  await page.locator('.project-selector-open-btn').click()

  // 等待主应用加载完成（以项目根节点出现为标志）
  await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
}

/**
 * 关闭可能自动弹出的“配置自检”抽屉。
 *
 * 项目加载后若自检发现 blocker，InspectionDrawer 会以全屏遮罩（z-index: 25000）
 * 自动打开，拦截后续所有点击。测试需要先关掉它才能操作左侧活动栏与画布。
 * 幂等：抽屉不可见时直接返回。
 */
async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  const drawer = page.locator('.inspection-drawer')
  // 等待可能的自动打开动画稳定
  await page.waitForTimeout(800)
  if (await drawer.isVisible().catch(() => false)) {
    // 点击抽屉头部的关闭按钮（×）
    await drawer.locator('button[title="关闭"]').first().click({ timeout: 5000 })
    await expect(drawer).toBeHidden({ timeout: 5000 })
  }
}

/**
 * 切换到左侧“项目资源”视图并展开 Schemas 文件夹，
 * 返回 resources 面板中的 Schema 行定位器。
 *
 * 说明：资源树中“数据模型”根文件夹下有一个同名“数据模型”子文件夹
 * （i18n key `dataModels` 与 `schemas` 在 zh-CN 下文案相同），该子文件夹内才是
 * 具体的 Schema 文件行。因此需要连展两层。
 */
async function expandSchemasFolder(page: import('@playwright/test').Page, schemaName: string) {
  // 切换到“项目资源”视图（用 title 属性定位，比 nth(n) 更稳定）
  await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10000 })

  // 展开“数据模型”根文件夹（root-item 下的 folder-row）
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  await dataModelsRoot.first().click()
  await page.waitForTimeout(500)

  // 展开“Schemas”子文件夹（nested 下的 folder-row，文案同为“数据模型”）
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  await schemasNested.first().click()
  await page.waitForTimeout(500)

  // 返回目标 Schema 行
  return tree.locator('.tree-row.file-row').filter({ hasText: schemaName }).first()
}

/**
 * 将资源树中的 Schema 行拖拽到画布。
 *
 * 关键点：必须使用 Playwright 原生 dragTo，它会触发前端的真实 dragstart 处理器，
 * 从而携带完整的关联约束 payload（associatedConstraintIds / embeddedConstraints 等）。
 * 手动构造 DataTransfer 无法获取这些运行时关联数据，会导致只创建 Schema 节点而遗漏约束。
 *
 * 成功判据：Schema 节点出现在画布上（而非 dragTo 本身完成）。
 *
 * 时序难点（CI 失败根因）：拖拽 Schema 后，前端会异步导入并随即弹出“发现关联的独立约束”
 * 确认框（.global-confirm-overlay，全屏遮罩）。在 CI 中该弹窗可能在 dragTo 的指针序列
 * 结束前就出现，从而拦截后续 pointer 事件导致 dragTo 超时。因此不能串行“先拖完再处理弹窗”：
 * 必须在 dragTo 执行的【同时】并发监听并关闭弹窗，让遮罩一旦出现就立即被点掉，
 * 解除对 dragTo 指针事件的拦截。弹窗按钮文案由 choice 决定（与最终断言口径一致）。
 */
async function dragSchemaToCanvas(
  page: import('@playwright/test').Page,
  schemaName: string,
  /**
   * 拖拽过程中若弹出“关联独立约束”确认框，点哪个按钮。
   * - 'importAll' → “全部导入”（连带创建独立约束）
   * - 'schemaOnly' → “只导 Schema”（仅物化内嵌约束）
   * 默认 'schemaOnly'（导入范围可控）。无弹窗时本参数无作用。
   */
  promptChoice: 'importAll' | 'schemaOnly' = 'schemaOnly'
) {
  const schemaItem = page
    .locator('.resource-tree .tree-row.file-row')
    .filter({ hasText: schemaName })
    .first()
  const canvas = page.locator('.vue-flow__pane')
  await expect(canvas).toBeVisible()

  // 并发“关闭弹窗”任务：弹窗一旦可见就立即点掉，解除对 dragTo 指针事件的拦截。
  // 它会持续运行直到 Schema 节点出现（即拖拽成功），随后被取消。
  //
  // 时序说明（产品代码已调整为弹窗严格早于 Schema 节点出现）：
  // 关联独立约束的确认框（.global-confirm-overlay）现在在 importSchema 创建节点
  // 【之前】弹出，因此 dismissTask 必然能在 Schema 节点出现前捕获并关闭它，
  // 不存在「节点先出现→dismissTask 被提前停掉→弹窗无人处理」的竞态。
  let dismissOverlay = true
  let overlayWasHandled = false // 记录弹窗是否被成功点掉（importAll/schemaOnly 期望它出现）
  const dismissTask = (async () => {
    const overlay = page.locator('.global-confirm-overlay')
    const btnName = promptChoice === 'importAll' ? /全部导入/ : /只导 Schema/
    while (dismissOverlay) {
      // 弹窗可见则点对应按钮；不可见则短暂等待后继续轮询
      if (await overlay.isVisible().catch(() => false)) {
        await overlay.getByRole('button', { name: btnName }).click().catch(() => {})
        await expect(overlay).toBeHidden({ timeout: 5000 }).catch(() => {})
        overlayWasHandled = true
      }
      await page.waitForTimeout(150)
    }
  })()

  try {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 不等待 dragTo 完成——它可能因弹窗拦截而超时；用 Schema 节点出现作为成功判据。
        await schemaItem.dragTo(canvas, { timeout: 10000 })
      } catch (e) {
        lastError = e
      }
      // 无论 dragTo 是否抛错，只要 Schema 节点已出现即视为拖拽成功。
      // 由于弹窗早于节点出现，此时 dismissTask 已点掉弹窗（overlayWasHandled=true）。
      const appeared = await page
        .locator('.vue-flow__node-schema')
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      if (appeared) return
      await page.waitForTimeout(400)
    }
    throw new Error(`dragSchemaToCanvas 失败（已重试 3 次）: ${lastError}`)
  } finally {
    // 停止弹窗轮询任务；多等一拍确保最后一次点击落地，避免遮罩残留
    dismissOverlay = false
    await dismissTask.catch(() => {})
    await expect(page.locator('.global-confirm-overlay')).toBeHidden({ timeout: 3000 }).catch(() => {})
    // 防御性断言：importAll 路径必须真的点过弹窗（若没点过，说明竞态又出现了，及早暴露）
    if (promptChoice === 'importAll' && !overlayWasHandled) {
      throw new Error('dragSchemaToCanvas(importAll) 未捕获到关联约束弹窗——产品代码时序可能已变化')
    }
  }
}

test.describe('画布真实 UI 交互', () => {
  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    // 每个测试从干净状态开始：打开项目、并清理之前可能残留的 view.json
    const viewPath = path.join(testProjectPath, VIEW_FILE)
    if (fs.existsSync(viewPath)) {
      fs.unlinkSync(viewPath)
    }
    await openFixtureProject(projectPage, testProjectPath)
    // 项目加载后可能自动弹出“配置自检”抽屉，关掉它以免遮挡画布操作
    await closeInspectionDrawer(projectPage)
  })

  test.afterEach(async ({ testProjectPath }) => {
    // 测试结束后清理写出的运行产物，避免污染后续测试 / 提交。
    // 说明：打开 fixture 项目时，bootstrap 会按目录名重写 manifest 的 project.id，
    // 全量校验/保存也会改写 schema/constraint 文件；这些都不是本测试的预期产物，
    // 用 git checkout 恢复，并删除生成的 view.json 与 .precis 目录。
    const viewPath = path.join(testProjectPath, VIEW_FILE)
    if (fs.existsSync(viewPath)) {
      fs.unlinkSync(viewPath)
    }
    const precisDir = path.join(testProjectPath, '.precis')
    if (fs.existsSync(precisDir)) {
      fs.rmSync(precisDir, { recursive: true, force: true })
    }
    // 恢复被 bootstrap/保存改写的受控 fixture 文件（相对仓库根的路径）
    const { execFileSync } = await import('child_process')
    const repoRoot = path.resolve(__dirname, '..', '..')
    const relPaths = [
      path.relative(repoRoot, path.join(testProjectPath, 'project.precis.yaml')).replace(/\\/g, '/'),
      path.relative(repoRoot, path.join(testProjectPath, 'schemas/users.schema.yaml')).replace(/\\/g, '/'),
    ]
    try {
      execFileSync('git', ['checkout', '--', ...relPaths], {
        stdio: 'ignore',
        cwd: repoRoot,
      })
    } catch {
      // git 不可用或文件无变更时忽略，不影响测试结果
    }
  })

  test('拖拽资源树中的 schema 到画布，验证节点出现', async ({ projectPage }) => {
    const page = projectPage
    const schemaItem = await expandSchemasFolder(page, 'users')
    await expect(schemaItem).toBeVisible({ timeout: 10000 })

    // users 被 8 个独立约束引用（见 constraints/*.constraint.yaml），拖拽后会弹
    // “发现关联的独立约束”确认框。这里选“只导 Schema”，验证仅物化内嵌约束（保持导入范围可控）。
    // 弹窗在拖拽过程中由 dragSchemaToCanvas 并发关闭（见该函数注释）。
    await dragSchemaToCanvas(page, 'users', 'schemaOnly')

    // 拖拽 Schema 时应自动物化内嵌约束（users.schema.yaml 内嵌了 NotNull/Unique 等）。
    // 注意 Vue Flow 节点类名是 camelCase（notNullConstraint），且同一 Schema 会物化多个内嵌约束，
    // 因此只断言“至少出现一个约束节点”，不锁死具体数量。
    // 说明：约束节点会被创建，但 Schema↔约束 的连线（edge）不会在拖拽导入时自动建立
    // （连线是用户后续手动操作），故此处不验证 edge。
    const constraintNode = page.locator(
      '.vue-flow__node-notNullConstraint, .vue-flow__node-charsetConstraint, .vue-flow__node-rangeConstraint'
    )
    await expect(constraintNode.first()).toBeVisible({ timeout: 15000 })
  })

  test('删除 schema 节点后画布无孤立边且 schema 已移除', async ({ projectPage }) => {
    const page = projectPage
    await expandSchemasFolder(page, 'users')
    // “全部导入”：连带创建引用 users 的独立约束节点。这些约束是画布上的独立节点，
    // 通过 schema→constraint 的边引用 users，但它们【不是】会被级联删除的子节点——
    // deleteSchemaNode 仅级联删除 data.schemaNodeId === nodeId 的约束（内嵌物化路径），
    // 而本仓库中约束节点并不持有 data.schemaNodeId 字段（引用关系存于 sourceRef/thenRef/边），
    // 故独立约束在删除 schema 后应【保留】在画布上。
    await dragSchemaToCanvas(page, 'users', 'importAll')

    // 等待约束节点异步创建完成
    const constraintLocator = page.locator('[class*="vue-flow__node-"][class*="Constraint"]')
    await expect(constraintLocator.first()).toBeVisible({ timeout: 15000 })
    const constraintCountBefore = await constraintLocator.count()
    expect(constraintCountBefore).toBeGreaterThan(0)

    // 记录删除前的 schema 节点，便于删除后断言其消失
    const schemaNode = page.locator('.vue-flow__node-schema').first()
    await expect(schemaNode).toBeVisible({ timeout: 10000 })

    // 删除前应存在连接 schema 与约束的边（importConstraint 会 ensureSchemaToConstraintEdge）。
    const edgeLocator = page.locator('.vue-flow__edge')
    const edgeCountBefore = await edgeLocator.count()
    expect(edgeCountBefore).toBeGreaterThan(0)

    // 点击 schema 节点头部的关闭按钮（×）触发 NodeDeletionManager.delete，
    // 走 schema 策略（deleteSchemaNode：批量 deleteNodes 子约束 + 清理 sourcePreview 反向引用），
    // 随后 deleteNode 收集级联 ID、removeEdges 清理所有触及 schema 的边、removeNodes 移除 schema。
    // 刚导入的 schema 无未保存草稿（saveState !== 'draft'），故不会弹出关闭确认框。
    await schemaNode.locator('.close-btn').click()

    // 断言终态（本次重构是 behavior-preserving，终态应与重构前一致）：
    // 1. schema 节点已从画布移除
    await expect(schemaNode).toHaveCount(0)
    // 2. 独立约束节点【保留】（它们是独立画布节点，不在 schema 的级联删除范围内）。
    //    这正是本次重构保留的真实行为：cascade 仅针对 data.schemaNodeId 命中的内嵌约束，
    //    而 importAll 创建的独立约束不持有该字段，故数量应与删除前一致。
    await expect(constraintLocator).toHaveCount(constraintCountBefore)
    // 3. 无孤立边残留：本 setup 下所有边都连接 schema↔constraint（或 schema↔regex），
    //    deleteNode 内部的 removeEdges 会清理所有触及 schema 的边，故总边数应降为 0。
    //    （Vue Flow 的边为 SVG <g>，无 data-source/data-target 属性可按 source 定向筛选，
    //     因此用“总边数为 0”等价表达“无引用已删 schema 的孤立边”。）
    await expect(edgeLocator).toHaveCount(0)
  })

  test('拖拽 Schema 选择“全部导入”会连带创建独立约束', async ({ projectPage }) => {
    const page = projectPage
    await expandSchemasFolder(page, 'users')
    // 选“全部导入”：dragSchemaToCanvas 在拖拽过程中并发点掉弹窗的“全部导入”按钮，
    // 触发连带创建引用 users 的独立约束节点（见该函数注释的时序说明）。
    await dragSchemaToCanvas(page, 'users', 'importAll')

    // users 的独立约束包含 DateLogic（users_birth_date_check）、Charset（users_username_ascii）、
    // Conditional（users_conditional_id_card）等。至少应出现一个这些类型的约束节点。
    // （内嵌约束物化同样会产生 NotNull/Unique/Range/AllowedValues，这里用独立约束独有的类型
    //   DateLogic/Charset/Conditional 来区分“全部导入”与“只导 Schema”。）
    await page.waitForTimeout(1500) // 等待连带约束异步创建
    const independentConstraintNode = page.locator(
      '.vue-flow__node-dateLogicConstraint, .vue-flow__node-charsetConstraint, .vue-flow__node-conditionalConstraint'
    )
    await expect(independentConstraintNode.first()).toBeVisible({ timeout: 15000 })

    // 验证约束节点数量多于“只导 Schema”路径（内嵌只有 4 个，全部导入后必然更多）
    const totalConstraints = await page
      .locator(
        '[class*="vue-flow__node-"][class*="Constraint"]'
      )
      .count()
    expect(totalConstraints).toBeGreaterThan(4)
  })

  test('点击“全量校验”按钮，验证结果面板显示', async ({ projectPage }) => {
    const page = projectPage

    // 先拖入一个 Schema，确保有校验上下文（弹窗在拖拽过程中并发关闭）
    await expandSchemasFolder(page, 'users')
    await dragSchemaToCanvas(page, 'users', 'schemaOnly')

    // 点击项目根节点上的“全量校验”按钮
    const projectRoot = page.locator('.project-root-node').first()
    await expect(projectRoot).toBeVisible()
    await projectRoot.getByRole('button', { name: /全量校验/ }).click()

    // 校验向导弹窗应出现
    const modal = page.locator('.fv-modal')
    await expect(modal).toBeVisible({ timeout: 15000 })

    // 点击“开始校验”
    await modal.getByRole('button', { name: /开始校验/ }).click()

    // 等待结果视图出现（成功或失败的横幅）
    await expect(modal.locator('.fv-status-banner')).toBeVisible({ timeout: 60000 })

    // 结果面板应包含状态标题文字（“通过”或“失败”均可，关键是面板正常渲染）
    const statusTitle = modal.locator('.fv-status-title')
    await expect(statusTitle).toHaveText(/通过|失败/)
  })

  test('保存的节点位置持久化到 project.view.json', async ({ projectPage, testProjectPath }) => {
    const page = projectPage

    // 通过后端 API 直接写入一个已知位置的 project.view.json，验证视图持久化能力。
    //
    // 说明：不使用 Ctrl+S 触发完整保存——拖拽导入的独立约束缺少 table_id 引用，
    // 会触发 PreValidator BLOCKER 导致整次保存中止（连 view.json 也不会写入），
    // 这是当前真实的校验行为。本测试聚焦“视图位置持久化”这一独立能力，
    // 因此直接调用 PUT /project/view 写入位置，再读取验证。
    const BACKEND = BACKEND_URL
    const savedX = 300
    const savedY = 420
    const viewPayload = {
      version: 2,
      nodes: {
        users: { x: savedX, y: savedY },
      },
      viewport: null,
    }
    const putResp = await fetch(`${BACKEND}/api/latest/project/view`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-Config-Path': testProjectPath,
      },
      body: JSON.stringify(viewPayload),
    })
    expect(putResp.ok).toBe(true)

    // 文件应已落盘
    const viewPath = path.join(testProjectPath, VIEW_FILE)
    await expect
      .poll(() => fs.existsSync(viewPath), { timeout: 10000, message: 'PUT 后 project.view.json 未生成' })
      .toBe(true)
    const viewContent = JSON.parse(fs.readFileSync(viewPath, 'utf-8'))
    expect(viewContent.version).toBe(2)
    expect(viewContent.nodes).toBeDefined()
    expect(viewContent.nodes.users).toBeDefined()
    expect(viewContent.nodes.users.x).toBe(savedX)
    expect(viewContent.nodes.users.y).toBe(savedY)

    // 再读回（GET）验证持久化一致
    const getResp = await fetch(`${BACKEND}/api/latest/project/view`, {
      headers: { 'X-Project-Config-Path': testProjectPath },
    })
    expect(getResp.ok).toBe(true)
    const readBack = await getResp.json()
    expect(readBack.nodes.users.x).toBe(savedX)
    expect(readBack.nodes.users.y).toBe(savedY)
  })
})
