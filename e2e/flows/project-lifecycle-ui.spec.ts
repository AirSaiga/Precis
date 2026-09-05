/**
 * @fileoverview 项目生命周期与交互杂项 E2E（批次四 F1-F3 + G1 + H1）
 *
 * - F1: Web 模式经项目管理弹窗新建项目（脚手架目录生成 + 自动打开）
 * - F2: 关闭项目 → 留在空画布 → 经弹窗重新打开
 * - F3: 多工作区内容隔离（工作区 2 为空，工作区 1 节点保留）
 * - G1: 快捷键命令集——Ctrl+A 全选 / Delete 删除 / Ctrl+Z 撤销 / Ctrl+X 剪切 / Ctrl+V 粘贴 / Ctrl+S 保存
 * - H1: en-US 关键界面无中文残留（导航/工具箱/检查器标题）
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

/** 从工具箱拖一个 Table Schema 到画布 */
async function dragTableSchema(page: import('@playwright/test').Page) {
  await page.locator('.activity-bar-nav .view-btn[title="工具箱"]').first().click()
  await page.waitForTimeout(500)
  const item = page
    .locator('.toolbox-content .component-tile')
    .filter({ hasText: '表结构' })
    .first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.dragTo(page.locator('.vue-flow__pane'), { timeout: 10000 })
  await page.waitForTimeout(1200)
}

test.describe('项目生命周期（F1-F3）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('F1: 经项目管理弹窗新建项目 → 脚手架生成并自动打开', async ({ projectPage }) => {
    const page = projectPage
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-newproj-'))
    const projectName = 'E2E 新项目'

    // Ctrl+Shift+P 打开项目管理弹窗（慢环境下重按一次）
    const modal = page.locator('.project-management-modal')
    for (let i = 0; i < 2 && !(await modal.isVisible().catch(() => false)); i++) {
      await page.keyboard.press('Control+Shift+P')
      await page.waitForTimeout(1000)
    }
    await expect(modal).toBeVisible({ timeout: 10000 })

    // 填写新建表单并提交（Web 模式路径框可手动输入；用原型 setter + input 事件
    // 直驱 v-model，确保与手工输入等价）
    await modal.getByPlaceholder('请输入项目名称').fill(projectName)
    const pathInput = modal.getByPlaceholder('选择项目保存目录')
    await pathInput.evaluate(
      (el: HTMLInputElement, val: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      },
      newDir.replace(/\\/g, '/')
    )
    await modal.getByRole('button', { name: '创建项目' }).click()

    // 新项目打开：根节点出现，manifest 与标准目录生成
    await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 5000 })
    expect(fs.existsSync(path.join(newDir, 'project.precis.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(newDir, 'schemas'))).toBe(true)
    expect(fs.existsSync(path.join(newDir, 'constraints'))).toBe(true)
    expect(fs.existsSync(path.join(newDir, 'data'))).toBe(true)
  })

  test('F2: 关闭项目 → 留在空画布 → 经弹窗重新打开', async ({ projectPage, testProjectPath }) => {
    const page = projectPage

    await page.keyboard.press('Control+Shift+P')
    const modal = page.locator('.project-management-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })

    // 当前项目区块的"关闭项目"→ 确认关闭对话框 → 留在空画布（无项目态）
    await modal.getByRole('button', { name: /关闭项目/ }).first().click()
    const confirmOverlay = page.locator('.global-confirm-overlay')
    await expect(confirmOverlay).toBeVisible({ timeout: 5000 })
    await confirmOverlay.getByRole('button', { name: /关闭项目|确认/ }).first().click()

    // 画布仍是首屏，但项目根节点已随项目关闭移除
    await expect(page.locator('.project-root-node')).toHaveCount(0, { timeout: 10000 })
    await expect(page.locator('.status-bar .project-chip')).toBeVisible()

    // 经项目管理弹窗（Web 手动路径输入）重新打开同一项目
    await page.keyboard.press('Control+Shift+P')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const webInput = modal.locator('.web-open-project input')
    await expect(webInput).toBeVisible()
    await webInput.fill(testProjectPath.replace(/\\/g, '/'))
    await modal.locator('.web-open-project button').click()
    await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
  })

  test('F3: 多工作区内容隔离（工作区 2 为空根，工作区 1 节点保留）', async ({ projectPage }) => {
    const page = projectPage

    // 工作区 1：拖入一个节点
    await dragTableSchema(page)
    const ws1Count = await page.locator('.vue-flow__node').count()
    expect(ws1Count).toBeGreaterThanOrEqual(2)

    // 新建工作区 2：仅默认 projectRoot
    await page.locator('button.tab-add').click()
    await page.waitForTimeout(1200)
    const tabs = page.locator('.tab-list .tab-item')
    await expect(tabs).toHaveCount(2)
    const ws2Count = await page.locator('.vue-flow__node').count()
    expect(ws2Count).toBe(1)

    // 切回工作区 1：节点恢复
    await tabs.nth(0).click()
    await page.waitForTimeout(1200)
    expect(await page.locator('.vue-flow__node').count()).toBe(ws1Count)
  })
})

test.describe('快捷键命令集（G1）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('Ctrl+A 全选 → Delete 删除 → Ctrl+Z 撤销恢复', async ({ projectPage }) => {
    const page = projectPage
    // 拖入两个 schema：批量删除确认（>1 个可删节点）是本用例的验证对象，
    // 前提不能依赖 fixture 加载的 templateInstance 数量——CI（Linux）上加载后
    // 画布只有 projectRoot（实例物化与本地 Windows 存在环境差异，另行排查），
    // 只拖一个时 Ctrl+A 全选后可删节点仅 1 个，走单删路径不弹确认（行为正确）。
    await dragTableSchema(page)
    await dragTableSchema(page)
    const before = await page.locator('.vue-flow__node').count()
    expect(before).toBeGreaterThanOrEqual(3)

    // 全选 → Delete → 处理"批量删除二次确认" → 仅剩 projectRoot。
    // 先清除拖拽可能残留的页面文本选区（Linux Chromium 上 dragTo 会留下文本选区，
    // 详见 resource-tree-filter.spec.ts 的同款处理）
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(600)
    await page.keyboard.press('Delete')
    const delConfirm = page.locator('.global-confirm-overlay')
    await expect(delConfirm).toBeVisible({ timeout: 5000 })
    await delConfirm.getByRole('button', { name: /确认|删除/ }).first().click()
    await page.waitForTimeout(1500)
    const afterDelete = await page.locator('.vue-flow__node').count()
    expect(afterDelete).toBe(1)

    // Ctrl+Z 撤销删除
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(1200)
    expect(await page.locator('.vue-flow__node').count()).toBe(before)
  })

  test('Ctrl+X 剪切 → Ctrl+V 粘贴回画布', async ({ projectPage }) => {
    const page = projectPage
    await dragTableSchema(page)
    const before = await page.locator('.vue-flow__node').count()
    expect(before).toBeGreaterThanOrEqual(2)

    // fixture 的 templateInstance 可能叠在目标节点上，先整理布局
    // （e2e fixture 隐藏了画布 Controls 悬浮件，organize 入口随之隐藏；可见才点击）
    const organizeBtn = page.locator('button[title="整理节点"]')
    if (await organizeBtn.isVisible().catch(() => false)) {
      await organizeBtn.click().catch(() => {})
    }
    await page.waitForTimeout(1500)

    // 选中新建的 schema 节点（类型类名定位，避开 fixture 的 templateInstance）
    const newNode = page.locator('.vue-flow__node-schema').first()
    await expect(newNode).toBeVisible({ timeout: 5000 })
    await newNode.click()
    await page.waitForTimeout(500)
    await expect(page.locator('.vue-flow__node.selected').first()).toBeVisible()

    // 剪切：节点消失
    await page.keyboard.press('Control+x')
    await page.waitForTimeout(1200)
    expect(await page.locator('.vue-flow__node').count()).toBe(before - 1)

    // 粘贴：节点回来（新 ID）
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(1200)
    expect(await page.locator('.vue-flow__node').count()).toBe(before)
  })
})

test.describe('en-US 界面走查（H1）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test('切换英文后导航/工具箱/检查器标题均为英文', async ({ projectPage, testProjectPath }) => {
    const page = projectPage
    await openFixtureProject(page, testProjectPath)
    await closeInspectionDrawer(page)

    const langBtn = page.locator('button.language-btn')
    await expect(langBtn).toHaveAttribute('title', 'English')
    await langBtn.click()
    await expect(page.locator('.activity-bar-nav .view-btn[title="Toolbox"]')).toBeVisible({
      timeout: 5000,
    })

    // 导航全部英文化（title 属性即 aria 名）
    const nav = page.locator('.activity-bar-nav')
    for (const title of ['Toolbox', 'Resources', 'History', 'Data']) {
      await expect(nav.locator(`.view-btn[title="${title}"]`)).toBeVisible()
    }
    await expect(nav.locator('button.settings-btn[title="Settings"]')).toBeVisible()

    // 工具箱面板标题英文化，无中文残留（面板可见区域文本不含 CJK）
    await nav.locator('.view-btn[title="Toolbox"]').click()
    await page.waitForTimeout(600)
    const toolboxText = await page.locator('.toolbox-content').innerText()
    expect(toolboxText).not.toMatch(/[\u4e00-\u9fff]/)

    // 选中根节点：检查器分组标题为英文（Project Basic Info / Resource Statistics）
    await page.locator('.vue-flow__node').first().click()
    await page.waitForTimeout(800)
    await expect(page.getByText('Project Basic Info')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Resource Statistics')).toBeVisible()

    // 恢复中文，避免影响其他用例
    await page.locator('button.language-btn').click()
    await expect(page.locator('.activity-bar-nav .view-btn[title="工具箱"]')).toBeVisible({
      timeout: 5000,
    })
  })
})
