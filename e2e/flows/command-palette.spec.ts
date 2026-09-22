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
 * @fileoverview 命令面板 E2E（Ctrl+K：搜索定位节点 / 执行命令 / 隐藏节点揭示）
 *
 * 夹具：最小清单（单 Schema cp_users + 1 条独立 NotNull 约束）写入 qa_simple
 * 副本。副本自带 workspaces.json → 打开项目即走 DEF-01 水合，画布直接出现
 * projectRoot + Schema + 约束卡片（无需资源树拖拽，规避拖拽时序抖动）。
 *
 * 验证：
 * 1. Ctrl+K 打开面板（输入框自动聚焦）；空查询只有命令组
 * 2. Esc 关闭
 * 3. 输入过滤命中节点条目，Enter 定位：面板关闭 + 节点进入选中态
 * 4. 命令执行：面板输入"仅异常"回车 → viewFilter errorsOnly 激活，
 *    idle 约束卡片被隐藏
 * 5. 隐藏节点揭示：搜索被 errorsOnly 隐藏的约束卡片（带"已隐藏"提示）
 *    → Enter 后卡片重新可见且选中（updateNodeData 揭示 + focus-canvas-nodes）
 */
import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'
import * as fs from 'fs'
import * as path from 'path'

type Page = import('@playwright/test').Page

const CP_USERS_SCHEMA = `version: 2
id: cp_users
name: cp_users
description: 命令面板夹具：用户表
source:
  mode: relative_file
  path: data/cp_users.csv
columns:
  - {id: name, name: name, type: string}
  - {id: age, name: age, type: integer}
`

const CP_NAME_NOTNULL = `version: 2
id: cp_name_notnull
type: NotNull
enabled: true
description: name-notnull-check
refs:
  table_id: cp_users
  column_id: name
`

const CP_USERS_CSV = `name,age
alice,30
bob,25
`

const MINIMAL_MANIFEST = `version: 2
project:
  id: cp_palette
  name: 命令面板夹具工程
settings:
  validation:
    auto_validate: false
    strict_mode: false
    error_handling: continue
    timeout_seconds: 30
schemas:
- id: cp_users
  path: schemas/cp_users.schema.yaml
constraints:
- id: cp_name_notnull
  path: constraints/cp_name_notnull.constraint.yaml
data_sources:
- id: primary
  path: data
  mode: relative
`

/** 独立约束卡片 id = 清单 id（水合/导入均以 manifest id 为节点 id） */
const NOTNULL_CARD = 'cp_name_notnull'

function writeFixture(isolatedProjectPath: string) {
  fs.writeFileSync(
    path.join(isolatedProjectPath, 'schemas', 'cp_users.schema.yaml'),
    CP_USERS_SCHEMA,
  )
  fs.writeFileSync(
    path.join(isolatedProjectPath, 'constraints', 'cp_name_notnull.constraint.yaml'),
    CP_NAME_NOTNULL,
  )
  fs.writeFileSync(path.join(isolatedProjectPath, 'data', 'cp_users.csv'), CP_USERS_CSV)
  fs.writeFileSync(path.join(isolatedProjectPath, 'project.precis.yaml'), MINIMAL_MANIFEST)
}

/** 关闭检查器抽屉（可能展开遮挡画布交互与断言可视性） */
async function closeInspectionDrawer(page: Page) {
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
}

/**
 * 展开资源树并等待目标 Schema 文件行可见。
 * 不用"任意文件行可见即跳过展开"的启发式（约束等其他文件夹的文件行会
 * 误判为已展开，目标行未渲染导致 dragTo 静默超时）——直接等到目标行。
 */
async function expandToSchemaRow(page: Page, schemaName: string) {
  const tree = page.locator('.resource-tree')
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: '数据模型' })
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: '数据 Schema' })
  const targetRow = tree.locator('.tree-row.file-row').filter({ hasText: schemaName }).first()

  if (!(await schemasNested.first().isVisible().catch(() => false))) {
    await dataModelsRoot.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  for (let i = 0; i < 3 && !(await targetRow.isVisible().catch(() => false)); i++) {
    await schemasNested.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await expect(targetRow).toBeVisible({ timeout: 5000 })
  return targetRow
}

/** 拖拽资源树 Schema 到画布，弹窗选指定按钮（复用 constraint-dock spec 的夹具模式） */
async function dragSchemaToCanvas(page: Page, schemaName: string, dialogChoice: string) {
  await closeInspectionDrawer(page)
  await page
    .locator('.activity-bar-nav .view-btn[title="项目资源"]')
    .first()
    .click()
  await page.locator('.resource-tree').waitFor({ timeout: 10_000 })
  const schemaItem = await expandToSchemaRow(page, schemaName)
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
    await schemaItem.dragTo(canvas, { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1000)
  } finally {
    dismissOverlay = false
    await dismissTask.catch(() => {})
  }
}

/** 节点是否渲染在画布（hidden 节点 Vue Flow 不渲染，DOM 即可见集） */
async function nodeVisible(page: Page, nodeId: string): Promise<boolean> {
  return page.evaluate(
    (id) => !!document.querySelector(`.vue-flow__node[data-id="${id}"]`),
    nodeId,
  )
}

test.describe('命令面板 Ctrl+K', () => {
  test('搜索定位节点、执行视图命令、揭示隐藏节点', async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(150_000)
    const page = projectPage

    // 1. 夹具与画布准备：拖入 cp_users（全部导入 → schema + 1 张约束卡片）
    writeFixture(isolatedProjectPath)
    await openProjectOnCanvas(page, isolatedProjectPath)

    await expect(async () => {
      await dragSchemaToCanvas(page, 'cp_users', '全部导入')
      await expect(
        page.locator('.vue-flow__node-schema[data-id="cp_users"]'),
      ).toBeVisible({ timeout: 5000 })
    }).toPass({ timeout: 90_000 })
    await expect(
      page.locator(`.vue-flow__node[data-id="${NOTNULL_CARD}"]`),
    ).toBeVisible({ timeout: 10_000 })

    const palette = page.locator('[data-testid="command-palette"]')
    const paletteInput = page.locator('[data-testid="command-palette-input"]')

    // 2. Ctrl+K 打开：面板可见且输入框自动聚焦；空查询只有命令组
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await expect(paletteInput).toBeFocused()
    await expect(palette.locator('.cp-group-label').first()).toHaveText('命令')

    // 3. Esc 关闭
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden({ timeout: 5000 })

    // 4. 搜索过滤 + Enter 定位节点：面板关闭、Schema 节点进入选中态
    //（用列名 age 过滤：只命中 Schema 节点——约束卡只挂 name 列；含 cp_users
    // 的查询会同时命中约束卡的 table/secondary 字段）
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await paletteInput.fill('age')
    const schemaItem = palette.locator('.cp-item', { hasText: 'cp_users' }).first()
    await expect(schemaItem).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden({ timeout: 5000 })
    await expect(
      page.locator('.vue-flow__node[data-id="cp_users"].selected'),
    ).toBeVisible({ timeout: 10_000 })

    // 5. 命令执行：搜索"仅异常"回车 → errorsOnly 激活，idle 约束卡被隐藏
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await paletteInput.fill('仅异常')
    const errorsOnlyItem = palette.locator('.cp-item', { hasText: '仅异常' }).first()
    await expect(errorsOnlyItem).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden({ timeout: 5000 })
    await expect(page.locator('[data-testid="view-mode-errors-only"]')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    )
    await expect
      .poll(() => nodeVisible(page, NOTNULL_CARD), { timeout: 10_000 })
      .toBe(false)

    // 6. 隐藏节点揭示：搜索被隐藏的约束卡（configName="name-notnull-check"）
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await paletteInput.fill('name-notnull')
    const constraintItem = palette
      .locator('.cp-item', { hasText: 'name-notnull-check' })
      .first()
    await expect(constraintItem).toBeVisible({ timeout: 5000 })
    // 条目带"已隐藏"提示（视图筛选隐藏的节点仍可被搜到）
    await expect(constraintItem.locator('.cp-hidden-hint')).toHaveText('已隐藏')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden({ timeout: 5000 })
    await expect
      .poll(() => nodeVisible(page, NOTNULL_CARD), { timeout: 10_000 })
      .toBe(true)
    await expect(
      page.locator(`.vue-flow__node[data-id="${NOTNULL_CARD}"].selected`),
    ).toBeVisible({ timeout: 10_000 })
  })
})
