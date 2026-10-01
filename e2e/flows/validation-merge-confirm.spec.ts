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
 * @fileoverview 全量校验「保存确认 → 发现未合并资源」链路回归测试
 *
 * 回归锁：useValidationTaskRunner 的 confirmSaveAndRun / runWithoutSave 曾在
 * finally 无条件清空 pendingTaskRequest——当保存/跳过保存后 continuePipeline
 * 因发现未入 manifest 的约束资源而弹出合并确认框时，pending 已被外层 finally
 * 提前清空，"直接校验 / 合并并校验"按钮点击后空转，校验进度永远停在 10%。
 * 修复：两个 finally 仅在 !showMergeConfirm.value 时才清 pending。
 *
 * 场景搭建（两条前提的组合）：
 * - 画布未保存更改：拖入 customers schema + 工具箱新建非空约束并**连线**
 *   （连线走 nodeDataBuilder connect 模式，约束节点 saveState 标 'draft'；
 *   仅新建不连线或仅幂等拖入 manifest 已有 schema 都不产生未保存更改）
 * - 未合并资源：向项目副本 constraints/ 写入孤儿约束文件（不写入 manifest），
 *   后端 coverage.unlisted.constraints 会报出该文件
 *
 * 三条用例分别覆盖缺陷的两条腿与两个合并选择：
 * 1. 保存并校验 → 未合并资源 → 直接校验：校验真正执行完毕，孤儿不入 manifest
 * 2. 保存并校验 → 未合并资源 → 合并并校验：校验执行 + 孤儿并入 manifest
 * 3. 不保存直接校验 → 未合并资源 → 直接校验：runWithoutSave 腿同缺陷
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'
import * as fs from 'fs'
import * as path from 'path'

type Page = import('@playwright/test').Page

/** 孤儿约束：存在于磁盘 constraints/ 但不写入 manifest（触发 coverage unlisted） */
const ORPHAN_CONSTRAINT_ID = 'e2e_orphan_notnull'
const ORPHAN_CONSTRAINT_YAML = `version: 2
id: ${ORPHAN_CONSTRAINT_ID}
type: NotNull
enabled: true
description: E2E 回归夹具：孤儿约束（磁盘存在但未入 manifest）
refs:
  table_id: users
  column_id: email
params: {}
`

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
    await page.waitForTimeout(400)
  }
}

/** 展开"数据模型 → 数据 Schema"两层文件夹 */
async function expandSchemasFolder(page: Page) {
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10_000 })
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
}

/**
 * 资源树 → 画布拖入 Schema（选择"只导 Schema"）。
 * 幂等导入本身不产生未保存更改，这里只为连线提供目标节点；
 * 拖拽期间并发处理"发现关联独立约束"确认框（全屏遮罩会拦截拖拽指针事件），
 * 模式取自 ui-canvas-interactions.spec.ts / demo/record-demo.spec.ts。
 */
async function dragSchemaToCanvas(page: Page, schemaName: string, schemaId: string) {
  const schemaItem = page
    .locator('.resource-tree .tree-row.file-row')
    .filter({ hasText: schemaName })
    .first()
  const canvas = page.locator('.vue-flow__pane')
  await expect(canvas).toBeVisible()

  let dismissOverlay = true
  let overlayHandled = false
  const dismissTask = (async () => {
    const overlay = page.locator('.global-confirm-overlay')
    while (dismissOverlay) {
      if (await overlay.isVisible().catch(() => false)) {
        await overlay.getByRole('button', { name: /只导 Schema/ }).click().catch(() => {})
        await expect(overlay).toBeHidden({ timeout: 5000 }).catch(() => {})
        overlayHandled = true
      }
      await page.waitForTimeout(150)
    }
  })()

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await schemaItem.dragTo(canvas, { timeout: 10_000 }).catch(() => {})
      if (overlayHandled) break
      const appeared = await page
        .locator(`.vue-flow__node-schema[data-id="${schemaId}"]`)
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false)
      if (appeared) return
      await page.waitForTimeout(400)
    }
    await page
      .locator(`.vue-flow__node-schema[data-id="${schemaId}"]`)
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
  } finally {
    dismissOverlay = false
    await dismissTask.catch(() => {})
    await expect(page.locator('.global-confirm-overlay')).toBeHidden({ timeout: 3000 }).catch(() => {})
  }
}

/** 工具箱 → 约束面板 → 点击指定约束类型，新建独立约束节点 */
async function createConstraintFromToolbox(page: Page, constraintName: string) {
  await page.locator('.activity-bar-nav .view-btn[title="工具箱"]').first().click()
  await expect(page.locator('.component-tile[title="约束"]')).toBeVisible({ timeout: 10_000 })
  await page.locator('.component-tile[title="约束"] .tile-expand-icon').click()
  const panel = page.locator('.constraint-panel')
  await expect(panel).toBeVisible({ timeout: 5000 })
  await panel
    .locator('.constraint-type-item')
    .filter({ hasText: constraintName })
    .first()
    .click()
  await page.waitForTimeout(800)
}

/** 基于 mouse 事件的 handle→handle 连线（Vue Flow 透明 handle 需要 mouse 路径） */
async function dragConnection(
  page: Page,
  from: import('@playwright/test').Locator,
  to: import('@playwright/test').Locator
) {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  if (!fromBox || !toBox) throw new Error('连线端点 handle 不存在或未渲染')
  const tx = toBox.x + toBox.width / 2
  const ty = toBox.y + toBox.height / 2
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tx, ty, { steps: 24 })
  await page.mouse.move(tx + 2, ty + 1, { steps: 2 })
  await page.mouse.move(tx, ty, { steps: 2 })
  await page.waitForTimeout(400)
  await page.mouse.up()
}

/** 抓节点标题栏拖动到指定视口坐标 */
async function moveNodeTo(
  page: Page,
  node: import('@playwright/test').Locator,
  x: number,
  y: number
) {
  const box = await node.boundingBox()
  if (!box) throw new Error('待拖动节点不存在')
  await page.mouse.move(box.x + 40, box.y + 14)
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 14, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const countEdges = (page: Page) => page.locator('.vue-flow__edge').count()

/**
 * 公共前置：写孤儿约束 + 打开项目 + 制造未保存更改 + 打开全量校验弹框
 * 并点击"开始校验"。返回弹框 locator。
 *
 * 未保存更改的制造：新建约束节点本身无 saveState（不算脏），必须**连线**——
 * 连线触发 nodeDataBuilder 的 connect 模式重建约束节点数据并标 saveState='draft'，
 * hasUnsavedChanges 才为 true、保存确认对话框才会出现。因此先拖入 customers
 * schema（幂等，仅提供列 handle 连线目标），再新建非空约束并连线，全程不保存。
 */
async function setupAndStartValidation(page: Page, projectPath: string) {
  fs.writeFileSync(
    path.join(projectPath, 'constraints', `${ORPHAN_CONSTRAINT_ID}.constraint.yaml`),
    ORPHAN_CONSTRAINT_YAML,
    'utf-8'
  )

  await openProjectOnCanvas(page, projectPath)
  await closeInspectionDrawer(page)

  // 1. 拖入 customers schema（提供连线目标）
  await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
  await expandSchemasFolder(page)
  await dragSchemaToCanvas(page, 'customers', 'customers')
  const customersNode = page.locator('.vue-flow__node-schema[data-id="customers"]').first()

  // 2. 工具箱新建非空约束节点，挪到 customers 下方空位避免重叠
  const notNullNodes = page.locator('.vue-flow__node-notNullConstraint')
  await createConstraintFromToolbox(page, '非空约束')
  await expect(notNullNodes.last()).toBeVisible({ timeout: 5000 })
  const newNode = notNullNodes.last()
  const customersBox = await customersNode.boundingBox()
  if (!customersBox) throw new Error('customers schema 节点不存在')
  await moveNodeTo(page, newNode, customersBox.x + 40, customersBox.y + customersBox.height + 70)

  // 3. 连线：customers 首列 → 约束 target handle（connect 模式 → saveState='draft'）
  const edgesBefore = await countEdges(page)
  await expect(async () => {
    if ((await countEdges(page)) < edgesBefore + 1) {
      await dragConnection(
        page,
        customersNode.locator('.column-source-handle').nth(0),
        newNode.locator('[data-handleid^="target-input-"]')
      )
      await page.waitForTimeout(700)
    }
    expect(await countEdges(page)).toBeGreaterThanOrEqual(edgesBefore + 1)
  }).toPass({ timeout: 20_000 })

  // 4. 触发全量校验
  await page.locator('.project-root-node').first().getByRole('button', { name: /全量校验/ }).click()
  const modal = page.locator('.fv-modal')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  await modal.getByRole('button', { name: /开始校验/ }).click()
  return modal
}

/** 读取 manifest 的约束 id 列表 */
async function fetchManifestConstraintIds(apiHelper: {
  get: (endpoint: string) => Promise<Response>
}): Promise<string[]> {
  const resp = await apiHelper.get('/project/manifest')
  expect(resp.ok).toBe(true)
  const manifest = await resp.json()
  return (manifest.constraints || []).map((c: { id: string }) => c.id)
}

test.describe('全量校验保存确认 → 未合并资源链路（pendingTaskRequest 回归）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 E2E 测试')
  })

  test('保存并校验 → 未合并资源 → 直接校验应真正执行（修复前按钮空转卡死）', async ({
    projectPage,
    isolatedProjectPath,
    apiHelper,
  }) => {
    test.setTimeout(180_000)
    const modal = await setupAndStartValidation(projectPage, isolatedProjectPath)

    // 画布有未保存更改 → 保存确认对话框
    const saveOverlay = projectPage.locator('.save-confirm-overlay')
    await expect(saveOverlay).toBeVisible({ timeout: 30_000 })
    await saveOverlay.getByRole('button', { name: /保存并校验/ }).click()

    // 保存后发现未入 manifest 的孤儿约束 → 合并确认对话框，且列出孤儿 id
    const mergeOverlay = projectPage.locator('.merge-confirm-overlay')
    await expect(mergeOverlay).toBeVisible({ timeout: 30_000 })
    await expect(mergeOverlay).toContainText(ORPHAN_CONSTRAINT_ID)
    await mergeOverlay.getByRole('button', { name: /直接校验/ }).click()

    // 核心回归断言：校验真正执行完毕。
    // 修复前 pendingTaskRequest 已被 confirmSaveAndRun 的 finally 清空，
    // runDirectly 空转、进度停在 10%，banner 永不出现（此处超时失败）
    await expect(modal.locator('.fv-status-banner')).toBeVisible({ timeout: 60_000 })

    // "直接校验"不合并：孤儿约束不得进入 manifest
    const constraintIds = await fetchManifestConstraintIds(apiHelper)
    expect(constraintIds).not.toContain(ORPHAN_CONSTRAINT_ID)
  })

  test('保存并校验 → 未合并资源 → 合并并校验应执行且孤儿并入 manifest', async ({
    projectPage,
    isolatedProjectPath,
    apiHelper,
  }) => {
    test.setTimeout(180_000)
    const modal = await setupAndStartValidation(projectPage, isolatedProjectPath)

    const saveOverlay = projectPage.locator('.save-confirm-overlay')
    await expect(saveOverlay).toBeVisible({ timeout: 30_000 })
    await saveOverlay.getByRole('button', { name: /保存并校验/ }).click()

    const mergeOverlay = projectPage.locator('.merge-confirm-overlay')
    await expect(mergeOverlay).toBeVisible({ timeout: 30_000 })
    await expect(mergeOverlay).toContainText(ORPHAN_CONSTRAINT_ID)
    await mergeOverlay.getByRole('button', { name: /合并并校验/ }).click()

    // 修复前 confirmMergeAndRun 同样因 pending 被清空而跳过 executeTask
    await expect(modal.locator('.fv-status-banner')).toBeVisible({ timeout: 60_000 })

    // 合并成功：孤儿约束已写入 manifest，coverage 不再报 unlisted
    const constraintIds = await fetchManifestConstraintIds(apiHelper)
    expect(constraintIds).toContain(ORPHAN_CONSTRAINT_ID)

    const fullResp = await apiHelper.get('/project/config/full')
    expect(fullResp.ok).toBe(true)
    const fullConfig = await fullResp.json()
    const unlistedIds = (
      fullConfig.coverage?.unlisted?.constraints || []
    ).map((c: { id: string }) => c.id)
    expect(unlistedIds).not.toContain(ORPHAN_CONSTRAINT_ID)
  })

  test('不保存直接校验 → 未合并资源 → 直接校验应真正执行（runWithoutSave 腿）', async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(180_000)
    const modal = await setupAndStartValidation(projectPage, isolatedProjectPath)

    const saveOverlay = projectPage.locator('.save-confirm-overlay')
    await expect(saveOverlay).toBeVisible({ timeout: 30_000 })
    await saveOverlay.getByRole('button', { name: /不保存直接校验/ }).click()

    // 跳过保存同样会做 preflight：孤儿约束触发合并确认对话框
    const mergeOverlay = projectPage.locator('.merge-confirm-overlay')
    await expect(mergeOverlay).toBeVisible({ timeout: 30_000 })
    await expect(mergeOverlay).toContainText(ORPHAN_CONSTRAINT_ID)
    await mergeOverlay.getByRole('button', { name: /直接校验/ }).click()

    // 修复前 runWithoutSave 的 finally 同样提前清空 pending
    await expect(modal.locator('.fv-status-banner')).toBeVisible({ timeout: 60_000 })
  })
})
