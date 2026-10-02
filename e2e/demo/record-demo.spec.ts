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
 * @fileoverview README 演示 GIF 录制脚本（非测试，产出视频素材）
 *
 * 极简剧本（总长目标 20~30s）：打开项目 → 资源树拖入 products 表 →
 * 工具箱新建区间约束并连线到 price 列（即时校验查出负单价）→ 全量校验 →
 * 2 个错误的结果面板 → 点定位回到画布节点收尾。
 *
 * 录制方式：Playwright video 全程录制 → ffmpeg + gifsicle 转成品：
 *   ffmpeg -ss <t> -i video.webm -vf "fps=12,scale=1280:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png
 *   ffmpeg -ss <t> -i video.webm -i palette.png -lavfi "fps=12,scale=1280:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none" base.gif
 *   gifsicle -O3 --lossy=80 base.gif -o docs/assets/demo.gif
 *   ffmpeg -ss <t> -i video.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart docs/assets/demo.mp4
 *
 * 双语录制：默认中文（demo.gif/demo.mp4）；DEMO_LOCALE=en-US 录英文版
 * （产物命名 demo-en.gif/demo-en.mp4，README 英文区引用）。英文版经 localStorage
 * generalSettings.language 强制界面 en-US，项目数据（CSV/描述/项目名）同步换英文，
 * 界面文本选择器全部走下方 UI 文案表，双语共用同一剧本。
 *
 * 数据策略（与旧版 demo/precis-project 无关，全部在录制副本内新建）：
 * - 一张 products 表（8 行），坏数据仅 2 行：P004 name 为空、P006 price 为负
 * - manifest 预登记 schema + 2 条约束（name 非空 / id 唯一），磁盘与清单一致，
 *   全程不弹"发现未合并的资源"对话框
 * - price 区间约束不预置：现场从工具箱拖建 + 连线 + 配置区间 [0,10000]，
 *   "保存并校验"写盘并入清单（不产生未入清单文件），参与全量校验
 * - 校验结果固定 2 个错误（name 空 + price 负），面板一屏看完
 * - 副本放在系统 temp 的 precis-demo/products-quality-check 下——项目节点
 *   会显示 configPath，目录名必须体面（不能出现测试残留味道的 .demo-record）
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas, waitForHydrationSettled } from '../fixtures/openProject'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/** 录制副本根：系统 temp 下体面命名（项目节点会显示此路径） */
const RECORD_DIR = path.join(os.tmpdir(), 'precis-demo')
const RECORD_PROJECT = path.join(RECORD_DIR, 'products-quality-check')

/** 录制语言：默认 zh-CN；DEMO_LOCALE=en-US 录英文版（产物 demo-en.gif/demo-en.mp4） */
const DEMO_LOCALE = process.env.DEMO_LOCALE === 'en-US' ? 'en-US' : 'zh-CN'
const IS_EN = DEMO_LOCALE === 'en-US'

/** 界面文案表：选择器按可见文本/title 定位，双语各一份，剧本主体语言无关 */
const UI = IS_EN
  ? {
      close: 'Close',
      toolbox: 'Toolbox',
      projectResources: 'Resources',
      constraintTile: 'Constraint',
      rangeConstraint: 'Range Constraint',
      organizeNodes: 'Organize Nodes',
      fullValidation: /Full Validation/,
      runValidation: /Run Validation/,
      saveAndValidate: /Save & Validate/,
      validateDirectly: /Validate Directly/,
      schemaOnly: /Schema Only/,
      dataModels: 'Data Models',
      dataSchemas: 'Data Schemas',
      maxValue: 'Max Value',
    }
  : {
      close: '关闭',
      toolbox: '工具箱',
      projectResources: '项目资源',
      constraintTile: '约束',
      rangeConstraint: '区间约束',
      organizeNodes: '整理节点',
      fullValidation: /全量校验/,
      runValidation: /开始校验/,
      saveAndValidate: /保存并校验/,
      validateDirectly: /直接校验/,
      schemaOnly: /只导 Schema/,
      dataModels: '数据模型',
      dataSchemas: '数据 Schema',
      maxValue: '最大值',
    }

/** 极简商品表：8 行，仅 P004（name 空）与 P006（price 负）两行坏数据 */
const PRODUCTS_CSV = IS_EN
  ? `id,name,price,stock
P001,Mechanical Keyboard,299.00,45
P002,Wireless Mouse,89.50,120
P003,Monitor Stand,159.00,38
P004,,459.00,25
P005,USB-C Hub,399.00,60
P006,Noise-Canceling Headphones,-299.00,30
P007,Monitor Light Bar,189.00,52
P008,Bluetooth Speaker,549.00,18
`
  : `id,name,price,stock
P001,机械键盘,299.00,45
P002,无线鼠标,89.50,120
P003,显示器支架,159.00,38
P004,,459.00,25
P005,USB-C 扩展坞,399.00,60
P006,降噪耳机,-299.00,30
P007,显示器挂灯,189.00,52
P008,蓝牙音箱,549.00,18
`

const PRODUCTS_SCHEMA_YAML = `version: 2
id: products
name: products
description: ${IS_EN ? 'Product table' : '商品表'}
source:
  mode: relative_file
  path: ../products.csv
columns:
  - id: id
    name: id
    type: string
    primary_key: true
  - id: name
    name: name
    type: string
  - id: price
    name: price
    type: float
  - id: stock
    name: stock
    type: integer
`

const NAME_NOTNULL_YAML = `version: 2
id: products_name_notnull
type: NotNull
enabled: true
description: ${IS_EN ? 'Product name must not be empty' : '商品名称非空'}
refs:
  table_id: products
  column_id: name
params: {}
`

const ID_UNIQUE_YAML = `version: 2
id: products_id_unique
type: Unique
enabled: true
description: ${IS_EN ? 'Product ID must be unique' : '商品 ID 唯一'}
refs:
  table_id: products
  column_ids: [id]
params: {}
`

// 区间约束不预置：现场从工具箱拖建、配置区间、保存后参与校验——剧本"拖拽建模"的主角。
// 若预置 price 区间约束，全量校验会对同一违规（负单价）报两条（预置 + 现场）错误

const PROJECT_MANIFEST_YAML = `version: 2
project:
  id: precis-demo-minimal
  name: ${IS_EN ? 'Product Data Quality' : '商品数据质检'}
schemas:
  - id: products
    path: schemas/products.schema.yaml
constraints:
  - id: products_name_notnull
    path: constraints/products_name_notnull.constraint.yaml
  - id: products_id_unique
    path: constraints/products_id_unique.constraint.yaml
`

/** 重建录制副本：全新极简项目（manifest 与磁盘完全一致，无未入清单资源） */
function prepareRecordProject() {
  fs.rmSync(RECORD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(RECORD_PROJECT, 'schemas'), { recursive: true })
  fs.mkdirSync(path.join(RECORD_PROJECT, 'constraints'), { recursive: true })
  fs.writeFileSync(path.join(RECORD_DIR, 'products.csv'), PRODUCTS_CSV, 'utf-8')
  fs.writeFileSync(
    path.join(RECORD_PROJECT, 'project.precis.yaml'),
    PROJECT_MANIFEST_YAML,
    'utf-8'
  )
  fs.writeFileSync(
    path.join(RECORD_PROJECT, 'schemas', 'products.schema.yaml'),
    PRODUCTS_SCHEMA_YAML,
    'utf-8'
  )
  fs.writeFileSync(
    path.join(RECORD_PROJECT, 'constraints', 'products_name_notnull.constraint.yaml'),
    NAME_NOTNULL_YAML,
    'utf-8'
  )
  fs.writeFileSync(
    path.join(RECORD_PROJECT, 'constraints', 'products_id_unique.constraint.yaml'),
    ID_UNIQUE_YAML,
    'utf-8'
  )
}

/**
 * 注入演示用鼠标光标：Playwright 视频不渲染系统光标，拖拽建模段没有光标
 * 会完全看不懂。纯 DOM 覆盖层（pointer-events:none），不影响应用交互。
 */
async function injectDemoCursor(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = `
      #demo-cursor{position:fixed;width:16px;height:16px;border-radius:50%;
        background:rgba(37,99,235,.30);border:2px solid #2563eb;box-sizing:border-box;
        pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);
        left:-100px;top:-100px;transition:left 70ms linear,top 70ms linear}
      #demo-cursor-ring{position:fixed;border-radius:50%;border:2px solid #2563eb;
        pointer-events:none;z-index:2147483646;transform:translate(-50%,-50%);
        transition:transform .35s ease,opacity .35s ease}
    `
    document.documentElement.appendChild(style)
    const dot = document.createElement('div')
    dot.id = 'demo-cursor'
    document.documentElement.appendChild(dot)
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
      },
      true
    )
    window.addEventListener(
      'mousedown',
      (e) => {
        const ring = document.createElement('div')
        ring.id = 'demo-cursor-ring'
        ring.style.left = `${e.clientX}px`
        ring.style.top = `${e.clientY}px`
        ring.style.width = '36px'
        ring.style.height = '36px'
        document.documentElement.appendChild(ring)
        requestAnimationFrame(() => {
          ring.style.transform = 'translate(-50%,-50%) scale(1.9)'
          ring.style.opacity = '0'
        })
        setTimeout(() => ring.remove(), 420)
      },
      true
    )
  })
}

// ============================================================================
// 节奏与时间轴
// ============================================================================

let t0 = 0
/** 关键节点时间戳（相对测试起点≈视频起点），供 ffmpeg 裁剪参考 */
const mark = (name: string) => console.log(`[demo-timeline] +${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`)
const beat = (page: Page, ms: number) => page.waitForTimeout(ms)

// ============================================================================
// 交互辅助（模式取自 canvas-interaction-regression.spec.ts）
// ============================================================================

async function closeInspectionDrawer(page: Page) {
  const drawer = page.locator('.inspection-drawer')
  for (let i = 0; i < 6; i++) {
    if (await drawer.isVisible().catch(() => false)) {
      await drawer
        .locator(`button[title="${UI.close}"]`)
        .first()
        .click({ timeout: 5000 })
        .catch(() => {})
      await expect(drawer).toBeHidden({ timeout: 5000 }).catch(() => {})
    }
    await page.waitForTimeout(400)
  }
}

/** 等顶部 toast 全部消失（避免遮挡关键画面/被录进成片） */
async function waitForToastsGone(page: Page, timeoutMs = 8000) {
  const toasts = page.locator('.toast')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await toasts.count()) === 0) return
    await page.waitForTimeout(300)
  }
}

/** 展开"数据模型 → 数据 Schema"两层文件夹 */
async function expandSchemasFolder(page: Page) {
  const tree = page.locator('.resource-tree')
  await expect(tree).toBeVisible({ timeout: 10_000 })
  const dataModelsRoot = tree
    .locator('.tree-folder.root-item > .tree-row.folder-row')
    .filter({ hasText: UI.dataModels })
  await dataModelsRoot.first().click()
  await page.waitForTimeout(400)
  const schemasNested = tree
    .locator('.tree-folder.nested > .tree-row.folder-row')
    .filter({ hasText: UI.dataSchemas })
  await schemasNested.first().click()
  await page.waitForTimeout(400)
}

/**
 * 资源树 → 画布拖入 Schema。
 * 预置的 3 条约束使 products 成为"被独立约束引用"的 schema——拖入会弹
 * "是否一并导入关联约束"确认框（全屏遮罩拦截拖拽指针事件），并发任务
 * 一旦出现立即点"只导 Schema"，保持开场画布只有根节点 + products 表。
 */
async function dragSchemaToCanvas(page: Page, schemaName: string, schemaId: string) {
  const schemaItem = page
    .locator('.resource-tree .tree-row.file-row')
    .filter({ hasText: schemaName })
    .first()
  const canvas = page.locator('.vue-flow__pane')
  await expect(canvas).toBeVisible()

  let dismissOverlay = true
  const dismissTask = (async () => {
    const overlay = page.locator('.global-confirm-overlay')
    while (dismissOverlay) {
      if (await overlay.isVisible().catch(() => false)) {
        await overlay.getByRole('button', { name: UI.schemaOnly }).click().catch(() => {})
        await expect(overlay).toBeHidden({ timeout: 5000 }).catch(() => {})
      }
      await page.waitForTimeout(150)
    }
  })()

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await schemaItem.dragTo(canvas, { timeout: 10_000 }).catch(() => {})
      const appeared = await page
        .locator(`.vue-flow__node-schema[data-id="${schemaId}"]`)
        .waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true)
        .catch(() => false)
      if (appeared) return
      await page.waitForTimeout(400)
    }
    throw new Error(`dragSchemaToCanvas(${schemaName}) 失败（已重试 3 次）`)
  } finally {
    dismissOverlay = false
    await dismissTask.catch(() => {})
    await expect(page.locator('.global-confirm-overlay')).toBeHidden({ timeout: 3000 }).catch(() => {})
  }
}

/** 工具箱 → 约束面板 → 点击指定约束类型，新建独立约束节点 */
async function createConstraintFromToolbox(page: Page, constraintName: string) {
  await page.locator(`.activity-bar-nav .view-btn[title="${UI.toolbox}"]`).first().click()
  await expect(page.locator(`.component-tile[title="${UI.constraintTile}"]`)).toBeVisible({
    timeout: 10_000,
  })
  await page.locator(`.component-tile[title="${UI.constraintTile}"] .tile-expand-icon`).click()
  const panel = page.locator('.constraint-panel')
  await expect(panel).toBeVisible({ timeout: 5000 })
  await panel
    .locator('.constraint-type-item')
    .filter({ hasText: constraintName })
    .first()
    .click()
  await page.waitForTimeout(600)
}

/** 基于 mouse 事件的 handle→handle 连线（Vue Flow 透明 handle 需要 mouse 路径） */
async function dragConnection(page: Page, from: Locator, to: Locator) {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  if (!fromBox || !toBox) throw new Error('连线端点 handle 不存在或未渲染')
  const tx = toBox.x + toBox.width / 2
  const ty = toBox.y + toBox.height / 2
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tx, ty, { steps: 20 })
  await page.mouse.move(tx + 2, ty + 1, { steps: 2 })
  await page.mouse.move(tx, ty, { steps: 2 })
  await page.waitForTimeout(400)
  await page.mouse.up()
}

/** 抓节点标题栏拖动到指定视口坐标 */
async function moveNodeTo(page: Page, node: Locator, x: number, y: number) {
  const box = await node.boundingBox()
  if (!box) throw new Error('待拖动节点不存在')
  await page.mouse.move(box.x + 40, box.y + 14)
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 14, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const countEdges = (page: Page) => page.locator('.vue-flow__edge').count()

// ============================================================================
// 录制剧本
// ============================================================================

test.describe('README 演示录制', () => {
  test('极简黄金路径：拖入表 → 拖建区间约束 → 全量校验 → 错误定位', async ({ page }) => {
    test.setTimeout(240_000)
    t0 = Date.now()

    prepareRecordProject()
    await injectDemoCursor(page)
    // 英文版：在应用启动前预置语言偏好（i18n 从 localStorage generalSettings 读初始 locale）
    if (IS_EN) {
      await page.addInitScript(() => {
        localStorage.setItem('generalSettings', JSON.stringify({ language: 'en-US' }))
      })
    }

    // ---- 第 1 幕：打开项目，从资源树拖入 products 表 ----
    mark('open-start')
    await openProjectOnCanvas(page, RECORD_PROJECT)
    await waitForHydrationSettled(page)
    await closeInspectionDrawer(page)
    mark('canvas-settled')

    await page.locator(`.activity-bar-nav .view-btn[title="${UI.projectResources}"]`).first().click()
    await expandSchemasFolder(page)
    await dragSchemaToCanvas(page, 'products', 'products')
    mark('schema-dropped')

    // 整理节点：自动布局 + fitView——拖入落点在画布中心（与项目根节点重叠），
    // 且保证后续点项目根节点的"全量校验"按钮时根节点确定在视口内
    await page.locator(`button[title="${UI.organizeNodes}"]`).first().click()
    await beat(page, 1500)

    // 开场镜头：项目根 + products 表
    const productsNode = page.locator('.vue-flow__node-schema[data-id="products"]').first()
    await expect(productsNode).toBeVisible({ timeout: 10_000 })
    await beat(page, 2000)

    // ---- 第 2 幕：工具箱新建区间约束，连线 price 列（即时校验反馈负单价） ----
    const rangeLocator = page.locator('.vue-flow__node-rangeConstraint')
    await createConstraintFromToolbox(page, UI.rangeConstraint)
    await expect(rangeLocator).toHaveCount(1, { timeout: 5000 })
    const rangeNode = rangeLocator.first()
    mark('range-node-created')

    // 新节点挪到 products 正下方（整理后 products 的几何确定，落点可控；
    // 不再物理拖动 products——拖拽路径可能引发画布平移把根节点推出视口）
    const productsBox = await productsNode.boundingBox()
    if (!productsBox) throw new Error('products schema 节点不存在')
    const dropY = productsBox.y + productsBox.height + 60
    // 落点越界（超出视口底）时收到 products 右下侧，保证连线 handle 可见可投
    const dropX = dropY + 140 > 780 ? productsBox.x + productsBox.width + 90 : productsBox.x + 60
    await moveNodeTo(page, rangeNode, dropX, Math.min(dropY, 740))

    // price 是第 3 列（nth=2）；默认区间 [0,100]，-299 必命中即时校验
    const edgesBefore = await countEdges(page)
    await expect(async () => {
      if ((await countEdges(page)) < edgesBefore + 1) {
        await dragConnection(
          page,
          productsNode.locator('.column-source-handle').nth(2),
          rangeNode.locator('[data-handleid^="target-input-"]')
        )
        await page.waitForTimeout(700)
      }
      expect(await countEdges(page)).toBeGreaterThanOrEqual(edgesBefore + 1)
    }).toPass({ timeout: 20_000 })
    mark('edge-connected')
    await beat(page, 1200)

    // ---- 第 2.5 幕：inspector 配置区间上限 100 → 10000（真实建模叙事）----
    // 工厂默认区间 [0,100] 对价格列过窄（多数价格超 100）；配置为 [0,10000]
    // 后即时校验收敛为 1 个错误（-299 负单价），全量校验也回到 2 个错误
    await rangeNode.click()
    await beat(page, 600)
    const maxField = page
      .locator('.base-inspector .field')
      .filter({ hasText: UI.maxValue })
      .first()
    await expect(maxField).toBeVisible({ timeout: 5000 })
    const maxInput = maxField.locator('input')
    await maxInput.fill('10000')
    await maxInput.press('Tab')
    mark('range-configured')
    // 参数变更触发即时校验（debounce ~300ms），节点收敛为 1 个错误，给观众看一眼
    await beat(page, 2000)

    // ---- 第 3 幕：全量校验 → 2 个错误 ----
    await waitForToastsGone(page)
    await page.locator('.project-root-node').first().getByRole('button', { name: UI.fullValidation }).click()
    mark('validation-modal-open')
    const modal = page.locator('.fv-modal')
    await expect(modal).toBeVisible({ timeout: 15_000 })
    await beat(page, 1000)

    await modal.getByRole('button', { name: UI.runValidation }).click()
    mark('validation-started')

    // 画布有未保存更改（新建约束+连线）→ 保存确认；磁盘与 manifest 一致
    // （预置齐全、新建约束未落盘）→ 不弹"未合并资源"，处理保存确认即出结果
    const saveOverlay = page.locator('.save-confirm-overlay')
    const mergeOverlay = page.locator('.merge-confirm-overlay')
    const banner = modal.locator('.fv-status-banner')
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (await banner.isVisible().catch(() => false)) break
      if (await saveOverlay.isVisible().catch(() => false)) {
        mark('save-confirm')
        await beat(page, 900)
        await saveOverlay
          .getByRole('button', { name: UI.saveAndValidate })
          .click({ timeout: 5000 })
          .catch(() => {})
        await page.waitForTimeout(1200)
        continue
      }
      // 极简项目不应出现合并询问；出现则说明搭建有漏（保留兜底避免卡死）
      if (await mergeOverlay.isVisible().catch(() => false)) {
        mark('merge-confirm-unexpected')
        await mergeOverlay
          .getByRole('button', { name: UI.validateDirectly })
          .click({ timeout: 5000 })
          .catch(() => {})
        await page.waitForTimeout(1200)
        continue
      }
      await page.waitForTimeout(400)
    }
    await expect(banner).toBeVisible({ timeout: 60_000 })
    mark('validation-done')

    // 结果面板：2 个错误（name 空 + price 负），一屏看完
    await expect(page.locator('.fv-error-item')).toHaveCount(2, { timeout: 10_000 })
    await beat(page, 2500)

    // ---- 第 4 幕：点定位回到画布节点，收尾 ----
    const errorRow = page.locator('.fv-error-item').first()
    await errorRow.locator('.fv-error-navigate').click()
    await expect(page.locator('.fv-overlay')).toHaveClass(/is-panel-mode/, { timeout: 15_000 })
    await expect(productsNode).toHaveClass(/selected/, { timeout: 10_000 })
    mark('navigated-to-node')
    await beat(page, 2000)
    mark('end')
  })
})
