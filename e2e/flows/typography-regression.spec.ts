/**
 * @fileoverview 文字排版防回归 E2E 测试（2026-08-23 排版审计修复批次的回归锁）
 *
 * 审计确认的缺陷与对应修复：
 * 1. TEMPLATE 前缀标签与模板名首字母重叠（.template-label 固定 52px 装不下
 *    "TEMPLATE" 大写 8 字母实渲染宽度，溢出盒子的末字母被右侧值覆盖，5/5 节点复现）
 *    → 修复：width: max-content + min-width: 68px
 * 2. 1024 窄视口：画布项目卡片被右侧检查器面板遮挡（fitView 比例留边未考虑
 *    面板占位）→ 修复：fitView 统一 SAFE_FITVIEW_PADDING + <1100px 默认折叠右面板
 * 3. 节点库 "Template Instance" 强制换行两行（.tile-label 无截断处理）
 *    → 修复：nowrap + ellipsis
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'

type Page = import('@playwright/test').Page

/** 断言元素文字未溢出其内容盒（scrollWidth/scrollHeight 不超过 clientWidth/Height + 1px 容差） */
async function expectNoTextOverflow(page: Page, selector: string) {
  const overflow = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) => ({
      text: (el.textContent || '').trim().slice(0, 30),
      overflowX: el.scrollWidth - el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
    }))
  }, selector)
  for (const item of overflow) {
    expect(item.overflowX, `水平溢出: "${item.text}"`).toBeLessThanOrEqual(1)
    expect(item.overflowY, `垂直溢出: "${item.text}"`).toBeLessThanOrEqual(1)
  }
  return overflow.length
}

/** 关闭 qa_simple blocker 自动弹出的自检抽屉（会遮挡导航与画布交互） */
async function dismissInspectionDrawer(page: Page) {
  const close = page.locator('.inspection-drawer button[title="关闭"]').first()
  if (await close.isVisible().catch(() => false)) {
    await close.click()
    await page.waitForTimeout(400)
  }
}

test.describe('排版防回归（2026-08-23 审计修复）', () => {
  test('TEMPLATE 前缀标签不与模板名重叠', async ({ projectPage, testProjectPath }) => {
    const page = projectPage
    await openProjectOnCanvas(page, testProjectPath)
    // V2 导入异步生成模板实例节点（projectRoot 可见后仍需等待），先等 TEMPLATE 行渲染
    await page.waitForSelector('.template-label', { timeout: 15000 })

    const labelCount = await expectNoTextOverflow(page, '.template-label')
    expect(labelCount).toBeGreaterThan(0)
  })

  test('1024 窄视口：检查器默认折叠，项目卡片不被面板遮挡', async ({ page, testProjectPath }) => {
    // F-5c 断点为初始状态判定，必须在应用挂载前设定视口
    await page.setViewportSize({ width: 1024, height: 640 })
    await openProjectOnCanvas(page, testProjectPath)

    // 右面板初始折叠：宽度收缩为 0（折叠由 rightPanelStyle width: '0px' 实现）
    const rightPanelWidth = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.right-panel')
      return el ? el.getBoundingClientRect().width : -1
    })
    expect(rightPanelWidth).toBeLessThanOrEqual(1)

    // 项目根卡片完全落在视口内（fitView 安全留白生效，不被右侧面板区域覆盖）
    const rootBox = await page.locator('.project-root-node').boundingBox()
    expect(rootBox).not.toBeNull()
    const viewport = page.viewportSize()
    expect(rootBox!.x).toBeGreaterThanOrEqual(0)
    expect(rootBox!.x + rootBox!.width).toBeLessThanOrEqual(viewport!.width)
  })

  test('节点库 tile 标签窄视口单行显示（ellipsis 截断而非换行）', async ({ projectPage, testProjectPath }) => {
    const page = projectPage
    await openProjectOnCanvas(page, testProjectPath)
    await dismissInspectionDrawer(page)
    // 先展开节点库（工具箱）面板，tile 才会渲染
    await page.locator('nav button[title="工具箱"]').click()
    await page.waitForSelector('.tile-label', { timeout: 10000 })
    await page.setViewportSize({ width: 1024, height: 640 })
    await page.waitForTimeout(500)
    // "Template Instance" 是最长标签；换行会产生垂直溢出（scrollHeight > clientHeight）
    const checked = await expectNoTextOverflow(page, '.tile-label')
    expect(checked).toBeGreaterThan(0)

    // 所有 tile 高度一致（换行项会显著高于同行项）
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.component-tile')).map(
        (el) => Math.round(el.getBoundingClientRect().height)
      )
    )
    expect(heights.length).toBeGreaterThan(1)
    const spread = Math.max(...heights) - Math.min(...heights)
    expect(spread, `tile 高度差 ${spread}px，疑似换行`).toBeLessThanOrEqual(2)
  })
})
