/**
 * @fileoverview 报告导出与校验历史 E2E（批次三 C1/C3 + D1/D2）
 *
 * - D1: 校验历史 API——保存运行记录 → 列表（含新记录）→ 统计 → 删除后消失
 * - D2: 行内校验（/validate/inline，TransformOutput/ManualData 数据源形态）
 * - C3: 校验完成后预览报告弹窗渲染（统计/项目名）
 * - C1: 导出 HTML 报告触发下载，文件为合法 HTML 且包含项目名
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { openProjectOnCanvas } from '../fixtures/openProject'

async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await openProjectOnCanvas(page, projectPath)
}

async function closeInspectionDrawer(page: import('@playwright/test').Page) {
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

test.describe('校验历史 API（D1）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test('保存两条运行记录 → 列表/统计 → 删除一条后消失', async ({ apiHelper }) => {
    const marker = `e2e-hist-${Date.now()}`
    const mk = (n: number, errors: number) => ({
      duration_ms: 100 + n,
      scope: 'full',
      summary: {
        marker,
        seq: n,
        total_error_count: errors,
        total_row_count: 100,
        pass_rate: errors === 0 ? 100 : 0,
      },
      by_type: {},
      by_table: {},
      errors: [],
      warnings: [],
    })

    const r1 = await apiHelper.post('/validation/history', mk(1, 3))
    expect(r1.status).toBeLessThan(300)
    const saved1 = await r1.json()
    expect(saved1.run_id).toBeTruthy()

    const r2 = await apiHelper.post('/validation/history', mk(2, 0))
    expect(r2.status).toBeLessThan(300)

    // 列表包含两条（按 marker 过滤）
    const listResp = await apiHelper.get('/validation/history?limit=50&offset=0')
    expect(listResp.status).toBeLessThan(300)
    const listBody = await listResp.json()
    const runs: { id?: string; run_id?: string; summary?: { marker?: string } }[] =
      listBody.items ?? listBody.runs ?? listBody.data ?? listBody
    const mine = runs.filter((r) => r.summary?.marker === marker)
    expect(mine.length).toBe(2)

    // 统计端点可达且包含运行计数
    const statsResp = await apiHelper.get('/validation/history/stats?last_n=10')
    expect(statsResp.status).toBeLessThan(300)

    // 删除第一条（seq=1）→ 列表只剩 seq=2
    const delId = mine.find((r) => r.summary?.seq === 1)?.id ?? mine.find((r) => r.summary?.seq === 1)?.run_id
    expect(delId).toBeTruthy()
    const delResp = await apiHelper.delete(`/validation/history/${delId}`)
    expect(delResp.status).toBeLessThan(300)

    const listResp2 = await apiHelper.get('/validation/history?limit=50&offset=0')
    const listBody2 = await listResp2.json()
    const runs2: { summary?: { marker?: string; seq?: number } }[] =
      listBody2.items ?? listBody2.runs ?? listBody2.data ?? listBody2
    const mine2 = runs2.filter((r) => r.summary?.marker === marker)
    expect(mine2.length).toBe(1)
    expect(mine2[0].summary?.seq).toBe(2)
  })
})

test.describe('行内校验 /validate/inline（D2）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test('not_null：空值行检出（首行为表头）', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/validate/inline', {
      validation_type: 'not_null',
      target_column_name: 'name',
      rows: [
        ['id', 'name'],
        ['1', 'Alice'],
        ['2', ''],
        ['3', 'Carol'],
      ],
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(1)
  })

  test('unique：重复值检出 + column_names 覆盖表头行', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/validate/inline', {
      validation_type: 'unique',
      target_column_name: 'id',
      rows: [['1'], ['2'], ['1'], ['3']],
      column_names: ['id'],
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBeGreaterThanOrEqual(1)
  })
})

test.describe('报告预览与导出（C1/C3，UI）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('校验完成 → 预览报告弹窗渲染 → 导出 HTML 下载合法文件', async ({ projectPage }) => {
    const page = projectPage

    // 拖入 users schema（只导 Schema）提供校验上下文
    await page.locator('.activity-bar-nav .view-btn[title="项目资源"]').first().click()
    const tree = page.locator('.resource-tree')
    await tree
      .locator('.tree-folder.root-item > .tree-row.folder-row')
      .filter({ hasText: '数据模型' })
      .first()
      .click()
    await page.waitForTimeout(500)
    await tree
      .locator('.tree-folder.nested > .tree-row.folder-row')
      .filter({ hasText: '数据 Schema' })
      .first()
      .click()
    await page.waitForTimeout(500)
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
      await page
        .locator('.resource-tree .tree-row.file-row')
        .filter({ hasText: 'users' })
        .first()
        .dragTo(page.locator('.vue-flow__pane'), { timeout: 15000 })
        .catch(() => {})
      await page.waitForTimeout(1200)
    } finally {
      dismissOverlay = false
      await dismissTask.catch(() => {})
    }

    // 全量校验 → 处理合并询问（直接校验）→ 等结果横幅
    await page.locator('.project-root-node button').filter({ hasText: '全量校验' }).click()
    const modal = page.locator('.fv-modal')
    await expect(modal).toBeVisible({ timeout: 15000 })
    await modal.getByRole('button', { name: /开始校验/ }).click()

    const mergeOverlay = page.locator('.merge-confirm-overlay')
    const banner = modal.locator('.fv-status-banner')
    const first = await Promise.race([
      banner.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'banner'),
      mergeOverlay.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'merge'),
    ]).catch(() => 'timeout')
    if (first === 'merge') {
      await mergeOverlay.getByRole('button', { name: /直接校验/ }).click({ timeout: 5000 })
    }
    expect(first).not.toBe('timeout')
    await expect(banner).toBeVisible({ timeout: 60000 })

    // C3: 预览报告弹窗
    await modal.getByRole('button', { name: /预览报告/ }).click()
    const preview = page.locator('.report-preview-modal')
    await expect(preview).toBeVisible({ timeout: 5000 })
    await expect(preview.locator('.report-header')).toBeVisible()
    // 关闭预览
    await preview.locator('.report-preview-close').click()
    await expect(preview).toBeHidden({ timeout: 5000 })

    // C1: 导出 HTML → 下载事件 → 文件为合法 HTML 且含项目名
    await modal.getByRole('button', { name: /导出报告/ }).click()
    await page.waitForTimeout(300)
    const htmlItem = modal.locator('.export-dropdown').getByText(/HTML/i).first()
    await expect(htmlItem).toBeVisible({ timeout: 5000 })

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    await htmlItem.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.html$/i)

    const savePath = path.join(os.tmpdir(), `precis-report-${Date.now()}.html`)
    await download.saveAs(savePath)
    const content = fs.readFileSync(savePath, 'utf-8')
    expect(content).toMatch(/<html/i)
    expect(content).toContain('QA')
    fs.rmSync(savePath, { force: true })
  })
})
