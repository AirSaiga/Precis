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
 * @fileoverview 约束坞（constraintDock）L0+L1+L2 E2E
 *
 * 场景：14 列 Schema + 22 内嵌约束 + 2 独立约束（复用 many-embedded 复现夹具形态，
 * 从资源树拖入后画布上有 24 张独立约束卡片 > 6 阈值）：
 * 1. L0 聚合：坞出现（确定性 id constraint-dock-customers）、约束卡片隐藏、徽标计数正确
 * 2. L1 揭示：点击徽标 → 对应约束卡片浮出并选中（Inspector 跟随）
 * 3. L2 全部展开：标题栏按钮 → 全部独立卡片浮出（栅格落位）→ 收回重新聚合
 * 4. 展示边：聚合态下有约束的列 → 坞之间存在 dock-display-edge 虚线边
 * 5. 保存 → 重开：坞重建、约束卡片重新聚合、project.view.json 无坞死键/展示边
 */
import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'
import * as fs from 'fs'
import * as path from 'path'

type Page = import('@playwright/test').Page

const CUSTOMERS_SCHEMA = `version: 2
id: customers
name: customers
description: 客户表（约束坞夹具：14 列 + 22 内嵌约束）
source:
  mode: relative_file
  path: data/customers.csv
columns:
  - {id: customer_id, name: customer_id, type: string, primary_key: true}
  - {id: customer_name, name: customer_name, type: string}
  - {id: email, name: email, type: string}
  - {id: phone, name: phone, type: string}
  - {id: city, name: city, type: string}
  - {id: level, name: level, type: string}
  - {id: age, name: age, type: integer}
  - {id: birthday, name: birthday, type: date}
  - {id: hire_date, name: hire_date, type: date}
  - {id: leave_date, name: leave_date, type: date}
  - {id: balance, name: balance, type: decimal}
  - {id: salary, name: salary, type: decimal}
  - {id: status, name: status, type: string}
  - {id: note, name: note, type: string}
constraints:
  - id: c_id_notnull
    type: NotNull
    column: customer_id
  - id: c_name_notnull
    type: NotNull
    column: customer_name
  - id: c_phone_notnull
    type: NotNull
    column: phone
  - id: c_email_notnull
    type: NotNull
    column: email
  - id: c_city_notnull
    type: NotNull
    column: city
  - id: c_birthday_notnull
    type: NotNull
    column: birthday
  - id: c_hire_notnull
    type: NotNull
    column: hire_date
  - id: c_salary_notnull
    type: NotNull
    column: salary
  - id: c_status_notnull
    type: NotNull
    column: status
  - id: c_note_notnull
    type: NotNull
    column: note
  - id: c_id_unique
    type: Unique
    column: customer_id
  - id: c_email_unique
    type: Unique
    column: email
  - id: c_level_enum
    type: AllowedValues
    column: level
    params: {allowed_values: [A, B, C]}
  - id: c_status_enum
    type: AllowedValues
    column: status
    params: {allowed_values: [active, frozen]}
  - id: c_age_range
    type: Range
    column: age
    params: {min: 0, max: 120, boundary_mode: inclusive}
  - id: c_balance_range
    type: Range
    column: balance
    params: {min: 0, max: 1000000, boundary_mode: inclusive}
  - id: c_salary_range
    type: Range
    column: salary
    params: {min: 0, max: 1000000, boundary_mode: inclusive}
  - id: c_hire_notfuture
    type: DateLogic
    column: hire_date
    params: {logic_mode: compare, compare_op: lte, reference_date: "2026-09-21"}
  - id: c_leave_after_hire
    type: DateLogic
    column: leave_date
    params: {logic_mode: compare, compare_op: gte, reference_column: hire_date}
  - id: c_birth_before_hire
    type: DateLogic
    column: birthday
    params: {logic_mode: compare, compare_op: lte, reference_column: hire_date}
  - id: c_email_lower
    type: Scripted
    column: email
    params: {name: email_lower, expression: "str(value) == str(value).lower()"}
  - id: c_name_strip
    type: Scripted
    column: customer_name
    params: {name: name_strip, expression: "str(value) == str(value).strip()"}
`

const INDEPENDENT_TEMPLATE = (
  id: string,
  columnId: string,
  desc: string,
) => `version: 2
id: ${id}
type: Scripted
enabled: true
description: ${desc}
refs:
  table_id: customers
  column_id: ${columnId}
params:
  name: ${id}_check
  expression: >-
    len(str(value)) > 0
`

const DOCK_NODE_SELECTOR =
  '.vue-flow__node[data-id="constraint-dock-customers"]'

/** 画布上当前渲染的约束卡片 id（hidden 节点 Vue Flow 不渲染，DOM 即可见集） */
async function renderedConstraintIds(page: Page): Promise<string[]> {
  return page.$$eval('.vue-flow__node', (els) =>
    els
      .map((e) => e.getAttribute('data-id') || '')
      .filter((id) => id.startsWith('customers_c_') || id.startsWith('cust2_')),
  )
}

async function openResourceTree(page: Page) {
  // 检查器抽屉可能处于展开态并拦截左侧 activity-bar 点击，先关闭
  const drawer = page.locator('.inspection-drawer')
  if (await drawer.isVisible().catch(() => false)) {
    await drawer
      .locator('button[title="关闭"]')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {})
    await expect(drawer)
      .toBeHidden({ timeout: 5000 })
      .catch(() => {})
  }
  await page
    .locator('.activity-bar-nav .view-btn[title="项目资源"]')
    .first()
    .click()
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10000 })
  return tree
}

/** 拖拽资源树 Schema 到画布，弹窗选指定按钮（全部导入 / 只导 Schema） */
async function dragSchemaToCanvas(
  page: Page,
  schemaName: string,
  dialogChoice: string,
) {
  const tree = page.locator('.resource-tree')
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: '数据 Schema' })

  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await dataModelsRoot.first().click()
    await page.waitForTimeout(500)
  }
  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    throw new Error('数据 Schema 文件夹未展开')
  }
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
        await overlay
          .getByRole('button', { name: new RegExp(dialogChoice) })
          .click()
          .catch(() => {})
        await expect(overlay)
          .toBeHidden({ timeout: 5000 })
          .catch(() => {})
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

test.describe('约束坞 L0+L1', () => {
  test('22 内嵌 + 2 独立约束：坞聚合、徽标揭示、保存重开后坞重建', async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(180_000)
    const page = projectPage

    // 1. 夹具：14 列 + 22 内嵌 + 2 独立（24 张卡片 > 6 阈值）
    fs.writeFileSync(
      path.join(isolatedProjectPath, 'schemas', 'customers.schema.yaml'),
      CUSTOMERS_SCHEMA,
    )
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        'constraints',
        'cust2_email_fmt.constraint.yaml',
      ),
      INDEPENDENT_TEMPLATE('cust2_email_fmt', 'email', '客户邮箱格式检查'),
    )
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        'constraints',
        'cust2_phone_len.constraint.yaml',
      ),
      INDEPENDENT_TEMPLATE('cust2_phone_len', 'phone', '客户手机号长度检查'),
    )
    const manifestPath = path.join(isolatedProjectPath, 'project.precis.yaml')
    const manifest = fs.readFileSync(manifestPath, 'utf-8')
    fs.writeFileSync(
      manifestPath,
      manifest.replace(
        'constraints:\n',
        `constraints:\n- id: cust2_email_fmt\n  path: constraints/cust2_email_fmt.constraint.yaml\n- id: cust2_phone_len\n  path: constraints/cust2_phone_len.constraint.yaml\n`,
      ),
    )

    // 2. 打开项目（首开无快照：projectRoot 起步），拖入 customers（schema + 24 张卡片）
    await openProjectOnCanvas(page, isolatedProjectPath)
    await expect(async () => {
      await openResourceTree(page)
      await dragSchemaToCanvas(page, 'customers', '全部导入')
      await expect(
        page.locator('.vue-flow__node-schema[data-id="customers"]'),
      ).toBeVisible({
        timeout: 5000,
      })
    }).toPass({ timeout: 90_000 })

    // L0：坞出现（确定性 id），约束卡片全部隐藏（hidden 不渲染）
    await expect(
      page.locator(`${DOCK_NODE_SELECTOR} .constraint-dock-node`),
    ).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 15_000,
      })
      .toBe(0)

    // 徽标计数 = 24（22 内嵌物化 + 2 独立）
    await expect(page.locator(`${DOCK_NODE_SELECTOR} .dock-count`)).toHaveText(
      '24',
      {
        timeout: 10_000,
      },
    )

    // 3. L1：点击首个徽标 → 对应约束卡片浮出并选中
    const firstBadge = page.locator(`${DOCK_NODE_SELECTOR} .dock-badge`).first()
    await firstBadge.click()
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 10_000,
      })
      .toBe(1)
    const revealedId = (await renderedConstraintIds(page))[0]!
    await expect(
      page.locator(`.vue-flow__node[data-id="${revealedId}"].selected`),
    ).toBeVisible({ timeout: 10_000 })

    // 3.5 展示边：聚合态下"有约束的列 → 坞"存在 dock-display-edge 虚线边
    // （14 列全部有约束；schema 列滚动时虚拟锚点 proxy 透传同 class，计数以 ≥1 稳妥）
    await expect
      .poll(
        async () =>
          await page.locator('.vue-flow__edge.dock-display-edge').count(),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(1)

    // 4. L2：展开全部 → 全部独立卡片浮出；收回 → 重新聚合
    // 先清空 L1 选中（收回跳过选中卡片是既有语义，此处要验证全量收回）
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(0, {
      timeout: 5000,
    })
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 10_000,
      })
      .toBe(0)

    await page.locator(`${DOCK_NODE_SELECTOR} .dock-expand-all`).click()
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 15_000,
      })
      .toBe(24)
    // 坞保持显示（徽标仍是导航入口），按钮翻转为"收回"
    await expect(
      page.locator(`${DOCK_NODE_SELECTOR} .dock-expand-all`),
    ).toHaveText('收回', {
      timeout: 5000,
    })

    await page.locator(`${DOCK_NODE_SELECTOR} .dock-expand-all`).click()
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 15_000,
      })
      .toBe(0)
    await expect(
      page.locator(`${DOCK_NODE_SELECTOR} .dock-expand-all`),
    ).toHaveText('展开全部', {
      timeout: 5000,
    })
    // 收回后展示边仍在（展示边只随聚合状态/列约束增删，与 L2 无关）
    await expect(
      await page.locator('.vue-flow__edge.dock-display-edge').count(),
    ).toBeGreaterThanOrEqual(1)

    // 5. 保存（Ctrl+S 写 view.json）→ 校验无坞死键/展示边 → 重开项目后坞重建、卡片重新聚合
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(2000)
    const viewPath = path.join(isolatedProjectPath, 'project.view.json')
    const viewRaw = fs.existsSync(viewPath)
      ? fs.readFileSync(viewPath, 'utf-8')
      : ''
    expect(viewRaw, 'project.view.json 不得包含坞死键').not.toContain(
      'constraint-dock-',
    )
    expect(viewRaw, 'project.view.json 不得包含展示边').not.toContain(
      'dock-edge-',
    )

    await openProjectOnCanvas(page, isolatedProjectPath)
    // 重开后 customers 已在 view.json 中有坐标 → 水合回显（lastLoadHadSavedWorkspaces）
    await expect(
      page.locator(`${DOCK_NODE_SELECTOR} .constraint-dock-node`),
    ).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => (await renderedConstraintIds(page)).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })
})
