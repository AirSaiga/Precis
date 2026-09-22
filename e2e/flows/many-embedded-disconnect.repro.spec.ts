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
 * @fileoverview 复现：拖入多列 Schema（14 列 + 22 内嵌约束）后部分约束节点断连
 *
 * 用户实证（2026-09-21，D:\precis隔离测试\测试数据\precis-project）：拖入
 * 员工信息表（14 列、24 内嵌约束、7 关联独立约束）后，画布上若干约束节点
 * 失去与 Schema 的连线。本 spec 以相同形态（14 列、22 内嵌约束、2 关联独立
 * 约束、含全角括号列 id）在 qa_simple 副本上复现并锁定。
 */
import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'
import * as fs from 'fs'
import * as path from 'path'

type Page = import('@playwright/test').Page

const CUSTOMERS_SCHEMA = `version: 2
id: customers
name: customers
description: 客户表（多列内嵌约束复现夹具）
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
  - {id: salary（元）, name: salary（元）, type: decimal}
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
    column: salary（元）
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
    column: salary（元）
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

const EMBEDDED_ITEMS: Array<[string, string]> = [
  ['c_id_notnull', 'customer_id'],
  ['c_name_notnull', 'customer_name'],
  ['c_phone_notnull', 'phone'],
  ['c_email_notnull', 'email'],
  ['c_city_notnull', 'city'],
  ['c_birthday_notnull', 'birthday'],
  ['c_hire_notnull', 'hire_date'],
  ['c_salary_notnull', 'salary（元）'],
  ['c_status_notnull', 'status'],
  ['c_note_notnull', 'note'],
  ['c_id_unique', 'customer_id'],
  ['c_email_unique', 'email'],
  ['c_level_enum', 'level'],
  ['c_status_enum', 'status'],
  ['c_age_range', 'age'],
  ['c_balance_range', 'balance'],
  ['c_salary_range', 'salary（元）'],
  ['c_hire_notfuture', 'hire_date'],
  ['c_leave_after_hire', 'leave_date'],
  ['c_birth_before_hire', 'birthday'],
  ['c_email_lower', 'email'],
  ['c_name_strip', 'customer_name'],
]

/** 收集画布上全部边的 id（Vue Flow edge DOM 元素） */
async function collectEdgeIds(page: Page): Promise<string[]> {
  return page.$$eval('.vue-flow__edge', (els) =>
    els.map(
      (e) => e.getAttribute('data-flowid') || e.getAttribute('data-id') || '',
    ),
  )
}

/** 收集浏览器 console 中 v2import-debug 日志 */
async function collectDebugLogs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __v2importDebug?: string[] }
    return w.__v2importDebug ?? []
  })
}
void collectDebugLogs

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

test.describe('拖入多列 Schema 后内嵌约束断连复现', () => {
  test('拖入 customers（14 列 + 22 内嵌 + 2 独立）后所有约束节点保持连线', async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(120_000)
    const page = projectPage

    // 捕获浏览器 console 的 v2import-debug 日志
    const debugLogs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[v2import-debug]') || text.includes('[GraphStore]')) {
        debugLogs.push(text)
      }
    })
    page.on('pageerror', (err) => debugLogs.push(`[pageerror] ${err.message}`))

    // 1. 改写副本：customers 变为 14 列 + 22 内嵌约束，追加 2 个关联独立约束
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

    // 2. 打开项目（启动水合会把 customers + 22 内嵌 + 2 独立约束铺上画布）
    await openProjectOnCanvas(page, isolatedProjectPath)

    const nodesBefore = await page.$$eval('.vue-flow__node', (els) =>
      els.map((e) => e.getAttribute('data-id') || ''),
    )
    const edgesBefore = await collectEdgeIds(page)
    const custEdgesBefore = edgesBefore.filter((id) =>
      id.startsWith('e-customers-'),
    )
    console.log(
      `[repro] 打开项目后：节点 ${nodesBefore.length}，边 ${edgesBefore.length}，其中 customers 边 ${custEdgesBefore.length}`,
    )
    console.log(`[repro] 拖入前节点:`, JSON.stringify(nodesBefore))
    console.log(`[repro] 拖入前 customers 边:`, JSON.stringify(custEdgesBefore))

    // 3. 真实拖拽路径（bug 现场在 onCanvasDrop → drop 处理器的导入顺序）：
    //    资源树 → 画布，弹窗自动点「全部导入」。
    //    HTML5 拖拽在树展开/抽屉遮挡等情况下会偶发落空，重试直到
    //    customers 节点真正出现在画布上。
    await expect(async () => {
      await openResourceTree(page)
      await dragSchemaToCanvas(page, 'customers', '全部导入')
      await expect(
        page.locator('.vue-flow__node-schema[data-id="customers"]'),
      ).toBeVisible({
        timeout: 5000,
      })
    }).toPass({ timeout: 90_000 })
    await page.waitForTimeout(2000)

    // 约束坞聚合：24 张卡片 > 阈值时被隐藏（Vue Flow 对 hidden 节点的边不渲染，
    // DOM 级断言会全部误报缺失）。点击坞标题栏「展开全部」恢复卡片可见后再断言，
    // 同时顺带覆盖 L2 展开路径（卡片浮出 + 边随可见节点恢复渲染）。
    const dockExpandBtn = page.locator(
      '.vue-flow__node[data-id="constraint-dock-customers"] .dock-expand-all',
    )
    if (await dockExpandBtn.isVisible().catch(() => false)) {
      await dockExpandBtn.click()
      await page.waitForTimeout(800)
    }

    const edgesAfter = await collectEdgeIds(page)
    const custEdgesAfter = edgesAfter.filter((id) =>
      id.startsWith('e-customers-'),
    )
    const nodesAfter = await page.$$eval('.vue-flow__node', (els) =>
      els.map((e) => e.getAttribute('data-id') || ''),
    )
    console.log(
      `[repro] 拖入后：节点 ${nodesAfter.length}，边 ${edgesAfter.length}，其中 customers 边 ${custEdgesAfter.length}`,
    )
    const newNodes = nodesAfter.filter((id) => !nodesBefore.includes(id))
    console.log(`[repro] 拖入新增节点:`, JSON.stringify(newNodes))
    const addedEdges = custEdgesAfter.filter((id) => !edgesBefore.includes(id))
    console.log(`[repro] 拖入新增 customers 边:`, JSON.stringify(addedEdges))

    // 4. 逐条核对期望边（22 内嵌 + 2 独立）
    const expected: string[] = []
    for (const [rawId, col] of EMBEDDED_ITEMS) {
      expected.push(`e-customers-customers_${rawId}-${col}`)
    }
    expected.push('e-customers-cust2_email_fmt-email')
    expected.push('e-customers-cust2_phone_len-phone')

    const afterSet = new Set(edgesAfter)
    const missing = expected.filter((id) => !afterSet.has(id))
    if (missing.length > 0) {
      console.log(
        `[repro] 缺失的 customers 边 ${missing.length}/${expected.length}:`,
        missing,
      )
    } else {
      console.log('[repro] 全部期望边都在')
    }

    // 丢失对比（拖入前有、拖入后没有的边）
    const beforeSet = new Set(custEdgesBefore)
    const lostDuringDrag = custEdgesAfter.length < custEdgesBefore.length
    console.log(
      `[repro] 拖入导致丢边: ${lostDuringDrag ? '是' : '否'}（before=${custEdgesBefore.length}, after=${custEdgesAfter.length}）`,
    )
    void beforeSet

    await page
      .screenshot({ path: 'test-results/repro-after-drag.png' })
      .catch(() => {})

    console.log(
      `[repro] === 浏览器 v2import-debug 日志 (${debugLogs.length}) ===`,
    )
    for (const log of debugLogs) console.log('[browser]', log.slice(0, 300))
    // toast 文本（导入失败会弹 toast）
    const toasts = await page.$$eval('.toast, [class*="toast"]', (els) =>
      els.map((e) => e.textContent || '').filter(Boolean),
    )
    console.log('[repro] 页面 toast:', JSON.stringify(toasts))

    // 分辨丢边层级：边缺失在「状态层」（store.edges 没有该边）还是「渲染层」
    // （store 有但 DOM 没有=handle 解析失败）。直接读 Pinia store 对比。
    const stateEdgeIds = await page.evaluate(() => {
      const app = (
        document.querySelector('#app') as unknown as { __vue_app__?: unknown }
      )?.__vue_app__
      if (!app) return null
      const pinia = (
        app as {
          config: {
            globalProperties: {
              $pinia?: { _s: Map<string, { edges: { id: string }[] }> }
            }
          }
        }
      ).config.globalProperties.$pinia
      if (!pinia) return null
      for (const [, store] of pinia._s) {
        if (store && Array.isArray(store.edges)) {
          return store.edges.map((e) => e.id as string)
        }
      }
      return null
    })
    if (stateEdgeIds === null) {
      console.log('[repro] 无法读取 Pinia store（降级仅 DOM 判断）')
    } else {
      const stateCustomers = stateEdgeIds.filter((id) =>
        id.startsWith('e-customers-'),
      )
      console.log(
        `[repro] store.edges 中 customers 边: ${stateCustomers.length}`,
      )
      const stateMissing = expected.filter((id) => !stateCustomers.includes(id))
      console.log(
        stateMissing.length > 0
          ? `[repro] 状态层缺失: ${JSON.stringify(stateMissing)}`
          : '[repro] 状态层无缺失',
      )
      const domMissing = new Set(missing)
      const renderLayerOnly = stateEdgeIds.filter((id) => domMissing.has(id))
      console.log(
        renderLayerOnly.length > 0
          ? `[repro] 以下边在 store 中存在但未渲染: ${JSON.stringify(renderLayerOnly)}`
          : '[repro] store 中也不存在缺失边 → 状态层丢边',
      )
    }

    expect(missing, `缺失边: ${missing.join(', ')}`).toHaveLength(0)
    expect(
      custEdgesAfter.length,
      '拖入后 customers 边数量不得少于拖入前',
    ).toBeGreaterThanOrEqual(custEdgesBefore.length)

    // 5. 布局回归锁：约束批次栅格排布（每列 ≤6 个），纵向跨度不得退化为单列长条
    //    （修复前 22 内嵌 × 160 步进 ≈ 3500px 的纵向长条）
    const nodePos = await page.$$eval('.vue-flow__node', (els) =>
      els.map((e) => {
        const id = e.getAttribute('data-id') || ''
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
          (e as HTMLElement).style.transform || '',
        )
        return { id, y: m ? Number(m[2]) : 0 }
      }),
    )
    const constraintNodes = nodePos.filter(
      (n) => n.id.startsWith('customers_c_') || n.id.startsWith('cust2_'),
    )
    if (constraintNodes.length > 0) {
      const ys = constraintNodes.map((n) => n.y)
      const spanY = Math.max(...ys) - Math.min(...ys)
      console.log(
        `[repro] 约束节点纵向跨度: ${spanY.toFixed(0)}px（${constraintNodes.length} 个，栅格期望 ≤ ~2200px）`,
      )
      // 阈值 1500→2200：实测约束卡行高 ~280px（卡体 ~250 + 行距），6 行满列
      // 跨度 1586~1677px（本地/CI 实测），1500 误伤正常栅格；单列长条回归
      // （24 张 × ~280px 行进 ≈ 6700px）仍会被拦截，锁的判别力不变
      expect(spanY, '约束节点纵向跨度过大，退化为单列长条').toBeLessThanOrEqual(
        2200,
      )
    }
  })
})
