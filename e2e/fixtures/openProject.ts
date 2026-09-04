import { expect, type Page } from '@playwright/test'

/**
 * 让应用在下次导航时自动恢复指定项目，直达画布。
 *
 * ProjectSelector 首屏已移除（画布是唯一首屏）：通过 addInitScript 预置
 * localStorage 的 `activeProjectPaths`（web bootstrap 读取的确切 key），
 * 启动引导即会走"恢复上次项目"路径，等价于用户上次会话打开过该项目。
 *
 * 注意：须在 page.goto 之前调用（addInitScript 在每次导航的文档脚本前执行）。
 */
export async function openProjectOnCanvas(page: Page, projectPath: string) {
  const normalized = projectPath.replace(/\\/g, '/')
  await page.addInitScript((p: string) => {
    localStorage.setItem('activeProjectPaths', JSON.stringify({ configPath: p, dataPath: p }))
  }, normalized)
  await page.goto('/')
  await expect(page.locator('.project-root-node')).toBeVisible({ timeout: 30000 })
  await waitForHydrationSettled(page)
}

/**
 * 等启动水合（DEF-01 实体回显）完成：projectRoot 可见时 bootstrap 仍在后台
 * 逐实体补齐画布节点（无快照路径可达数十个），期间节点/边计数持续增长，
 * 选中态也会被写入。测试在水合完成前交互会与导入竞速（基线漂移、点击落空）。
 * 判定：节点计数在静默窗口内不再增长（导入节奏 <300ms/个，窗口取其 4 倍）。
 */
export async function waitForHydrationSettled(page: Page, quietWindowMs = 1200) {
  await expect
    .poll(
      async () => {
        const before = await page.locator('.vue-flow__node').count()
        await page.waitForTimeout(quietWindowMs)
        const after = await page.locator('.vue-flow__node').count()
        return after - before
      },
      { timeout: 60_000, poll: 200 }
    )
    .toBe(0)
}
