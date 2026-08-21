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
}
