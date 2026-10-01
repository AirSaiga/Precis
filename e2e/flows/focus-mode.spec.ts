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
 * @fileoverview 专注模式（Focus Mode）切换 E2E 测试
 *
 * 覆盖专注模式切换的核心行为：
 * 1. 默认普通布局（四栏布局可见，无 is-focus-mode 状态类）
 * 2. 进入专注模式（活动栏/检查器折叠，AI 对话面板成为左栏，画布保留）
 * 3. 退出专注模式（按钮反向切换，布局状态类移除）
 * 4. Esc 退出专注模式（仅专注态生效）
 * 5. Ctrl+Shift+F 切换专注模式
 * 6. 切换后画布节点保留（单一布局，NodeCanvas 不重挂载）
 *
 * 注意：本测试需要后端服务运行（地址由 config.ts 的 BACKEND_URL 决定）；
 * 后端未启动时自动 skip（而非失败）。
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'

/**
 * 预置 localStorage 项目路径，启动自动恢复直达画布。
 *
 * 复用自 ui-canvas-interactions.spec.ts 的同名 helper（项目惯例：本地定义而非抽公共）。
 */
async function openFixtureProject(page: import('@playwright/test').Page, projectPath: string) {
  await openProjectOnCanvas(page, projectPath)
}

/**
 * 关闭可能自动弹出的"配置自检"抽屉。
 *
 * 项目加载后若自检发现 blocker，InspectionDrawer 会以全屏遮罩自动打开，拦截后续点击。
 * 幂等：抽屉不可见时直接返回。复用自 ui-canvas-interactions.spec.ts。
 */
async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  // blocker 级自检会让抽屉延迟自动展开（含入场动画），且可能晚于加载后 800ms 才
  // 出现并拦截后续点击——轮询约 3s，出现即关闭，直至窗口期内不再出现
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

test.describe('专注模式切换', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过专注模式 E2E 测试')
  })

  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openFixtureProject(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('默认普通布局，四栏可见且无专注状态类', async ({ projectPage }) => {
    const page = projectPage
    // 单一布局根节点可见，且不带专注状态类
    await expect(page.locator('.app-layout')).toBeVisible()
    await expect(page.locator('.app-layout')).not.toHaveClass(/\bis-focus-mode\b/)
    // 活动栏展开（64px）
    await expect(page.locator('.activity-bar')).toHaveCSS('width', '64px')
    // 专注切换按钮存在（两种状态都渲染）
    await expect(page.locator('.tab-bar > .focus-mode-toggle')).toBeVisible()
  })

  test('进入专注模式：AI 对话成为左栏，活动栏/检查器折叠', async ({ projectPage }) => {
    const page = projectPage
    await page.locator('.focus-mode-toggle').click()

    // 布局根节点带专注状态类（单一布局，不重挂载）
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)

    // 活动栏折叠为 0 宽（容器有 1px 边框，computed width 为 0 或 1px，按区间断言）
    await expect(page.locator('.activity-bar')).toHaveCSS('width', /^([01](\.\d+)?)px$/)
    // 检查器折叠为 0 宽（同理允许 1px 边框误差）
    await expect(page.locator('.right-panel')).toHaveCSS('width', /^([01](\.\d+)?)px$/)
    // 右侧调宽分隔条隐藏（专注模式 CSS）
    await expect(page.locator('.right-resize-divider')).toBeHidden()
    // 左右折叠箭头隐藏
    await expect(page.locator('.panel-toggle.left-toggle')).toBeHidden()
    await expect(page.locator('.panel-toggle.right-toggle')).toBeHidden()

    // AI 对话面板可见（侧栏切到 ai-chat 视图）
    await expect(page.locator('.ai-chat-panel')).toBeVisible({ timeout: 10_000 })
    // 画布仍在（不重挂载）
    await expect(page.locator('.vue-flow__pane')).toBeVisible()
  })

  test('退出专注模式：布局状态恢复', async ({ projectPage }) => {
    const page = projectPage
    // 先进入专注模式
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)

    // 再点同一按钮退出（进入/退出一体）
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).not.toHaveClass(/\bis-focus-mode\b/)
    // 活动栏恢复展开
    await expect(page.locator('.activity-bar')).toHaveCSS('width', '64px')
  })

  test('Esc 退出专注模式', async ({ projectPage }) => {
    const page = projectPage
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)

    // Esc 退出（焦点在 body/画布，非输入元素）
    await page.keyboard.press('Escape')
    await expect(page.locator('.app-layout')).not.toHaveClass(/\bis-focus-mode\b/)
  })

  test('Ctrl+Shift+F 切换专注模式', async ({ projectPage }) => {
    const page = projectPage
    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)
    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('.app-layout')).not.toHaveClass(/\bis-focus-mode\b/)
  })

  test('专注模式切换后画布节点保留（NodeCanvas 不重挂载）', async ({ projectPage }) => {
    const page = projectPage
    // 普通布局下项目根节点存在
    await expect(page.locator('.project-root-node')).toBeVisible()

    // 进入专注模式：节点原位保留（无重挂载，无需等待重建）
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)
    await expect(page.locator('.project-root-node')).toBeVisible()

    // 退出：节点仍在
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).not.toHaveClass(/\bis-focus-mode\b/)
    await expect(page.locator('.project-root-node')).toBeVisible()
  })

  test('状态栏在专注模式下仍可见（AI 状态共享）', async ({ projectPage }) => {
    const page = projectPage
    // 普通布局下状态栏可见（含项目信息）
    await expect(page.locator('.status-bar')).toBeVisible()
    await expect(page.locator('.project-chip')).toBeVisible()

    // 进入专注模式：状态栏仍可见（单一布局共享渲染）
    await page.locator('.focus-mode-toggle').click()
    await expect(page.locator('.app-layout')).toHaveClass(/\bis-focus-mode\b/)
    await expect(page.locator('.status-bar')).toBeVisible()
    await expect(page.locator('.project-chip')).toBeVisible()
  })
})
