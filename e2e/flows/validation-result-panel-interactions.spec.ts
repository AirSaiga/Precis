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
 * @fileoverview 全量校验结果面板交互 E2E（P1 行交互 / P2 面板化 / P3 三级定位）
 *
 * 覆盖三条新交互链路：
 * - P1：单击错误行就地展开详情（位置/原始值/错误码），再点收起，不触发跳转关闭
 * - P2：定位成功 → 弹框进入右侧面板模式（遮罩穿透、画布可交互）；面板可最小化为
 *   右下角胶囊（含错误计数）再恢复（筛选/展开状态保留）；返回总览回 modal；Esc 最小化
 * - P3：列级定位（inspector 展开对应列滚动高亮 + 2s 后消退）；节点不在画布时定位
 *   自动创建节点并 toast 提示；定位成功的错误行加 is-located"已定位"徽标
 *
 * 数据策略：项目上下文（打开/水合/manifest/保存）走真实后端（与现有 spec 一致），
 * 仅 mock `POST /api/latest/project/validate/full` 的响应——用确定性的错误集
 * （table_id/column/column_id/row_index/value 齐全、含画布上与画布外两种表）
 * 覆盖 L1/L2/L3 与自动创建路径，避免依赖 fixture 数据与后端校验行为的漂移。
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'

/** 造数标记：写进错误 message，用于在结果列表中唯一定位错误行 */
const MARK_A = 'E2E-ERR-A'
const MARK_B = 'E2E-ERR-B'
const MARK_C = 'E2E-ERR-C'

/**
 * mock 错误集：
 * - A/B 属 users 表（画布上，列 email/age 真实存在于 users.schema.yaml）→ L1/L2 定位
 * - C 属 employees 表（用例内先删节点再定位）→ 自动创建路径
 *
 * A 用已注册错误码 COLUMN_NOT_FOUND（造数标记经 error_params.column 注入渲染文案），
 * 顺带覆盖"错误码 chip"渲染；B/C 无错误码走 message 原文（造数标记直接在文案里）。
 */
const MOCK_ERRORS = [
  {
    stage: 'constraint',
    error_type: 'ColumnNotFound',
    check_type: 'NotNull',
    message: `${MARK_A}：email 列存在空值（造数标记 A，兜底文案）`,
    table: 'users',
    table_id: 'users',
    column: 'email',
    column_id: 'email',
    row_index: 3,
    value: 'not-an-email',
    source_file: 'users.csv',
    error_code: 'COLUMN_NOT_FOUND',
    error_params: { column: 'E2E-ERR-A' },
  },
  {
    stage: 'constraint',
    error_type: 'RangeViolation',
    check_type: 'Range',
    message: `${MARK_B}：age 超出允许范围（造数标记 B）`,
    table: 'users',
    table_id: 'users',
    column: 'age',
    column_id: 'age',
    row_index: 5,
    value: '999',
    source_file: 'users.csv',
  },
  {
    stage: 'constraint',
    error_type: 'NotNullViolation',
    check_type: 'NotNull',
    message: `${MARK_C}：emp_name 列存在空值（造数标记 C）`,
    table: 'employees',
    table_id: 'employees',
    column: 'emp_name',
    column_id: 'emp_name',
    row_index: 1,
    value: '',
    source_file: 'employees.csv',
  },
]

function buildMockValidationResponse() {
  return {
    success: false,
    summary: {
      files_total: 8,
      files_loaded: 8,
      tables_loaded: 12,
      loading_error_count: 0,
      format_error_count: 0,
      constraint_error_count: 3,
      total_error_count: 3,
      duration_ms: 1234,
    },
    errors: MOCK_ERRORS,
    statistics: {
      total_checks: 10,
      passed_count: 7,
      failed_count: 3,
      pass_rate: 70,
      by_type: {},
      by_table: {},
    },
  }
}

/** mock 校验执行端点：其余 API（项目打开/manifest/保存/导入）仍走真实后端 */
async function mockValidationEndpoint(page: import('@playwright/test').Page) {
  await page.route('**/api/latest/project/validate/full', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMockValidationResponse()),
    })
  })
}

/**
 * 关闭可能自动弹出的"配置自检"抽屉（与 ui-canvas-interactions.spec 同款）。
 */
async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  const drawer = page.locator('.inspection-drawer')
  await page.waitForTimeout(800)
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.locator('button[title="关闭"]').first().click({ timeout: 5000 })
    await expect(drawer).toBeHidden({ timeout: 5000 })
  }
}

/**
 * 切到"项目资源"视图并展开两层文件夹（数据模型 → 数据 Schema），
 * 返回目标 Schema 行定位器（与 ui-canvas-interactions.spec 同款）。
 */
async function expandSchemasFolder(page: import('@playwright/test').Page, schemaName: string) {
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

  return tree.locator('.tree-row.file-row').filter({ hasText: schemaName }).first()
}

/**
 * 把资源树中的 Schema 拖到画布（L2 列级定位需要目标表真实在画布上）。
 * users 有关联独立约束，拖拽会弹"关联独立约束"确认框——并发任务点"只导 Schema"
 * 解除遮罩对 dragTo 指针事件的拦截（模式取自 ui-canvas-interactions.spec）。
 */
async function dragSchemaToCanvas(page: import('@playwright/test').Page, schemaName: string) {
  const schemaItem = await expandSchemasFolder(page, schemaName)
  const canvas = page.locator('.vue-flow__pane')
  await expect(canvas).toBeVisible()

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
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await schemaItem.dragTo(canvas, { timeout: 10000 })
      } catch (e) {
        lastError = e
      }
      const appeared = await page
        .locator(`.vue-flow__node-schema[data-id="${schemaName}"]`)
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      if (appeared) return
      await page.waitForTimeout(400)
    }
    throw new Error(`dragSchemaToCanvas 失败（已重试 3 次）: ${lastError}`)
  } finally {
    dismissOverlay = false
    await dismissTask.catch(() => {})
    await expect(page.locator('.global-confirm-overlay')).toBeHidden({ timeout: 3000 }).catch(() => {})
  }
}

/**
 * 从项目根节点打开全量校验弹框 → 开始校验 → 处理可能出现的中间弹层
 * （画布有未保存修改时的保存确认 / 未入清单资源的合并询问）→ 等结果横幅。
 */
async function runValidationToResults(page: import('@playwright/test').Page) {
  const projectRoot = page.locator('.project-root-node').first()
  await projectRoot.getByRole('button', { name: /全量校验/ }).click()

  const modal = page.locator('.fv-modal')
  await expect(modal).toBeVisible({ timeout: 15000 })
  await modal.getByRole('button', { name: /开始校验/ }).click()

  const saveOverlay = page.locator('.save-confirm-overlay')
  const mergeOverlay = page.locator('.merge-confirm-overlay')
  const banner = modal.locator('.fv-status-banner')

  // 中间弹层最多两层（保存确认 → 合并询问），逐个处理后等结果横幅
  for (let round = 0; round < 3; round++) {
    const first = await Promise.race([
      banner.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'banner'),
      saveOverlay.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'save'),
      mergeOverlay.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'merge'),
    ]).catch(() => 'timeout')
    if (first === 'banner') break
    expect(first).not.toBe('timeout')
    if (first === 'save') {
      await saveOverlay.getByRole('button', { name: /保存并校验/ }).click({ timeout: 5000 })
    } else {
      await mergeOverlay.getByRole('button', { name: /直接校验/ }).click({ timeout: 5000 })
    }
  }
  await expect(banner).toBeVisible({ timeout: 60000 })
}

/** 按造数标记定位结果列表中的错误行 */
function errorRow(page: import('@playwright/test').Page, mark: string) {
  return page.locator('.fv-error-item').filter({ hasText: mark })
}

test.describe('全量校验结果面板交互（P1 行交互 / P2 面板化 / P3 三级定位）', () => {
  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    test.setTimeout(120_000)
    await openProjectOnCanvas(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
    await mockValidationEndpoint(projectPage)
  })

  test('P1：单击错误行就地展开详情（位置/原始值/错误码），再点收起，不触发跳转', async ({
    projectPage,
  }) => {
    const page = projectPage
    await runValidationToResults(page)

    const rowA = errorRow(page, MARK_A)
    await expect(rowA).toBeVisible()
    const overlay = page.locator('.fv-overlay')

    // 单击：行选中 + 详情区就地展开（不跳转、不关弹框）
    await rowA.click()
    await expect(rowA).toHaveClass(/is-selected/)
    const detail = rowA.locator('.fv-error-detail')
    await expect(detail).toBeVisible()
    // 完整位置（source_file 文件名）/ 原始值（<code>）/ 错误码 chip（已注册码）
    await expect(detail).toContainText('users.csv')
    await expect(detail.locator('.fv-error-detail-value')).toHaveText('not-an-email')
    await expect(detail.locator('.fv-error-detail-code')).toHaveText('COLUMN_NOT_FOUND')

    // 未触发导航：弹框仍在且仍是 modal 全屏形态（遮罩在、未进面板模式）
    await expect(page.locator('.fv-modal')).toBeVisible()
    await expect(overlay).not.toHaveClass(/is-panel-mode/)

    // 再点一次：收起
    await rowA.click()
    await expect(detail).toBeHidden()
    await expect(rowA).not.toHaveClass(/is-selected/)
  })

  test('P2+P3：定位进入面板模式（遮罩穿透）+ 列级高亮 + 已定位徽标 + 胶囊/返回总览/Esc', async ({
    projectPage,
  }) => {
    const page = projectPage
    // L2 列级定位需要 users 表真实在画布上（schema 水合不保证自动铺画布，显式拖入）
    await dragSchemaToCanvas(page, 'users')
    await runValidationToResults(page)

    const rowA = errorRow(page, MARK_A)
    const rowB = errorRow(page, MARK_B)
    const overlay = page.locator('.fv-overlay')
    const capsule = page.locator('.fv-result-capsule')

    // 先展开 B 行详情：用于断言形态切换（面板/胶囊）不丢展开与筛选状态
    await rowB.click()
    await expect(rowB.locator('.fv-error-detail')).toBeVisible()

    // 定位 A 行（users.email 列级）→ 成功后弹框切面板模式，不再关闭
    await rowA.locator('.fv-error-navigate').click()
    await expect(overlay).toHaveClass(/is-panel-mode/)
    // 遮罩穿透：overlay 不拦截鼠标事件（画布完全可交互）
    expect(await overlay.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

    // L1/L2 聚焦：users 节点被选中；inspector 中 email 列行滚动高亮（flash 2s 后消退）
    const usersNode = page.locator('.vue-flow__node[data-id="users"]')
    await expect(usersNode).toHaveClass(/selected/, { timeout: 10000 })
    const emailColumn = page.locator('.schema-inspector [data-column-id="email"]')
    await expect(emailColumn).toBeVisible({ timeout: 15000 })
    await expect(emailColumn).toHaveClass(/is-column-focus-flash/, { timeout: 3000 })
    await page.waitForTimeout(2300)
    await expect(emailColumn).not.toHaveClass(/is-column-focus-flash/)

    // P3 已定位标记：定位成功的 A 行显示"已定位"徽标；B 行展开详情在面板模式下保留
    await expect(rowA).toHaveClass(/is-located/)
    await expect(rowA.locator('.fv-error-located-badge')).toHaveText(/已定位/)
    await expect(rowB.locator('.fv-error-detail')).toBeVisible()

    // 激活筛选（搜索 B 标记）→ 仅剩 1 行，用于断言胶囊恢复后筛选保留
    const searchInput = page.locator('.fv-filter-search input')
    await searchInput.fill(MARK_B)
    await expect(page.locator('.fv-error-item')).toHaveCount(1)

    // 最小化 → 胶囊出现（文案含错误计数 = mock 错误总数），弹框整体隐藏
    await page.locator('.fv-header-actions button[title="最小化"]').click()
    await expect(capsule).toBeVisible()
    await expect(capsule).toContainText('校验结果')
    await expect(capsule).toContainText('3 错误')
    await expect(overlay).toBeHidden()

    // 点胶囊恢复面板：筛选（仅 1 行）与展开详情都保留
    await capsule.click()
    await expect(overlay).toHaveClass(/is-panel-mode/)
    await expect(page.locator('.fv-error-item')).toHaveCount(1)
    await expect(rowB.locator('.fv-error-detail')).toBeVisible()

    // 清空搜索：列表恢复完整（组件实例未因形态切换重建）
    await searchInput.fill('')
    await expect(page.locator('.fv-error-item')).toHaveCount(3)

    // Esc：面板模式 → 最小化为胶囊；胶囊状态 Esc 不再处理（弹框保持胶囊态）
    await page.keyboard.press('Escape')
    await expect(capsule).toBeVisible()
    await expect(overlay).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(capsule).toBeVisible()

    // 胶囊恢复 → 返回总览：回到 modal 模式结果页（步骤导航回来、不再是面板）
    await capsule.click()
    await expect(overlay).toHaveClass(/is-panel-mode/)
    await page.locator('.fv-header-actions button[title="返回总览"]').click()
    await expect(overlay).not.toHaveClass(/is-panel-mode/)
    await expect(page.locator('.fv-steps')).toBeVisible()
    // A 行的已定位标记在返回总览后仍保留（同一份状态）
    await expect(rowA).toHaveClass(/is-located/)
  })

  test('P3：节点不在画布时定位自动创建节点并 toast 提示，错误行标记已定位', async ({
    projectPage,
  }) => {
    const page = projectPage

    // 自动创建路径的前置：employees 节点不在画布（schema 不随水合自动上画布时天然满足）。
    // 若环境变化导致 schema 被水合上画布，则先删除画布节点（磁盘 schema 文件不动）。
    const employeesNode = page.locator('.vue-flow__node[data-id="employees"]')
    if ((await employeesNode.count()) > 0) {
      await employeesNode.first().click()
      await page.keyboard.press('Delete')
      // 删除可能触发批量删除二次确认（级联约束数 >1 时），出现则确认
      const delConfirm = page.locator('.global-confirm-overlay')
      try {
        await delConfirm.waitFor({ state: 'visible', timeout: 3000 })
        await delConfirm.getByRole('button', { name: /确认|删除/ }).first().click()
      } catch {
        // 单节点删除无确认弹窗，属正常路径
      }
      await expect(employeesNode).toHaveCount(0, { timeout: 10000 })
    }

    // 删除使画布变脏 → 开始校验会先弹保存确认（helper 内已处理），mock 校验产出 C 错误
    await runValidationToResults(page)
    const rowC = errorRow(page, MARK_C)
    await expect(rowC).toBeVisible()

    // 定位 C（table_id=employees 不在画布）→ 自动从磁盘导入重建节点并聚焦
    await rowC.locator('.fv-error-navigate').click()
    await expect(
      page.locator('.vue-flow__node[data-id="employees"]')
    ).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.vue-flow__node[data-id="employees"]')).toHaveClass(/selected/)

    // 自动创建有 success toast 提示（含表名），弹框进入面板模式、行标记已定位
    const createdToast = page.locator('.toast--success .toast__message').first()
    await expect(createdToast).toContainText('已在画布创建节点')
    await expect(createdToast).toContainText('employees')
    // 自动创建走后端导入（耗时数秒），面板形态断言放宽超时
    await expect(page.locator('.fv-overlay')).toHaveClass(/is-panel-mode/, { timeout: 15000 })
    await expect(rowC).toHaveClass(/is-located/)
    await expect(rowC.locator('.fv-error-located-badge')).toHaveText(/已定位/)
  })
})
