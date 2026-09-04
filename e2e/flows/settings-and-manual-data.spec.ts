/**
 * @fileoverview 设置中心与手动数据节点 UI E2E（2026-09-03 GUI 全覆盖走查批次）
 *
 * 将 GUI 黑盒走查结论固化为回归锁（E2E 是前端功能正确性的主验证手段）：
 * - 设置中心七面板渲染走查（通用/快捷键/项目信息/项目设置/模型/脚本安全/检查更新）
 * - 主题切换深色 + 重载持久化（generalSettings localStorage 链路）
 * - 快捷键单命令启用/禁用联动（禁用后组合键划线、重置钮语义）
 * - 项目信息改名 → 应用/重置按钮激活联动（不点应用，避免写盘）
 * - 手动数据节点：工具箱磁贴点击创建 → 检查器编辑（改名/单元格/增删行）→ Ctrl+S 落盘
 * - 状态栏项目芯片打开项目管理弹窗
 */

import { test, expect } from '../fixtures/base'
import { openProjectOnCanvas } from '../fixtures/openProject'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 剥离 YAML 顶层块键（key: 到下一个顶层键之间的全部行）。
 * e2e 无 yaml 依赖，fixture 的顶层键均为规整块形态，行级剥离足够。
 */
function stripTopLevelYamlSection(content: string, key: string): string {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    if (skipping) {
      if (/^[A-Za-z_][\w-]*:/.test(line)) {
        skipping = false
        out.push(line)
      }
      continue
    }
    if (new RegExp(`^${key}:\\s*(\\[\\]\\s*)?(#.*)?$`).test(line)) {
      skipping = true
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

async function closeInspectionDrawer(page: import('@playwright/test').Page) {
  // blocker 级自检会让抽屉延迟自动展开（含入场动画），轮询关闭直至不再出现
  const drawer = page.locator('.inspection-drawer')
  for (let i = 0; i < 6; i++) {
    if (await drawer.isVisible().catch(() => false)) {
      await drawer
        .locator('button[title="关闭"]')
        .first()
        .click({ timeout: 5000 })
        .catch(() => {})
    }
    await page.waitForTimeout(500)
    if (!(await drawer.isVisible().catch(() => false))) return
  }
}

async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('.activity-bar-nav button.settings-btn').first().click()
  await expect(page.locator('.settings-workbench')).toBeVisible({ timeout: 5000 })
}

async function gotoSettingsTab(page: import('@playwright/test').Page, label: string) {
  await page.locator('.settings-workbench .nav-item').filter({ hasText: label }).first().click()
  await page.waitForTimeout(400)
}

test.describe('设置中心渲染走查', () => {
  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openProjectOnCanvas(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  test('七面板关键内容渲染', async ({ projectPage }) => {
    const page = projectPage
    await openSettings(page)
    const workbench = page.locator('.settings-workbench')

    // 通用设置（默认选中）：启动行为 / 语言 / 主题
    await expect(workbench.getByText('启动时加载最近项目')).toBeVisible()
    await expect(workbench.getByRole('combobox').first()).toBeVisible()

    // 快捷键设置：全局开关 + 快捷键列表 + 搜索
    await gotoSettingsTab(page, '快捷键设置')
    await expect(workbench.getByText('启用快捷键')).toBeVisible()
    await expect(workbench.getByText('重置所有快捷键')).toBeVisible()
    await expect(workbench.locator('.settings-list__item').first()).toBeVisible()

    // 项目信息：项目名称 + 资源概览
    await gotoSettingsTab(page, '项目信息')
    await expect(workbench.getByPlaceholder('输入项目名称')).toBeVisible()
    await expect(workbench.getByText('资源概览')).toBeVisible()

    // 项目设置：校验参数（错误处理 / 校验超时）
    await gotoSettingsTab(page, '项目设置')
    await expect(workbench.getByText('错误处理')).toBeVisible()
    await expect(workbench.getByRole('spinbutton').first()).toBeVisible()

    // 模型设置：AI Provider 管理区
    await gotoSettingsTab(page, '模型设置')
    await expect(workbench.getByText('管理 AI Provider，配置模型与 API Key。')).toBeVisible()

    // 脚本安全：安全警告 + eval/exec 开关 + 超时
    await gotoSettingsTab(page, '脚本安全')
    await expect(workbench.getByText('启用脚本功能')).toBeVisible()
    await expect(workbench.getByText('允许 eval')).toBeVisible()
    await expect(workbench.getByText('允许 exec')).toBeVisible()

    // 检查更新：web 模式能力门控，至少渲染当前版本
    await gotoSettingsTab(page, '检查更新')
    await expect(workbench.getByText('当前版本')).toBeVisible()
  })

  test('主题切换深色并重载持久化', async ({ projectPage }) => {
    const page = projectPage
    await openSettings(page)
    const workbench = page.locator('.settings-workbench')
    // 通用设置面板第二个 combobox 是主题
    const themeSelect = workbench.getByRole('combobox').nth(1)
    await themeSelect.selectOption({ label: '深色' })
    await page.waitForTimeout(600)
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(15, 23, 42)')

    // 持久化：重载后仍为深色
    await page.reload()
    await page.waitForTimeout(1500)
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(15, 23, 42)')

    // 还原：清掉本测试写入的主题偏好
    await page.evaluate(() => localStorage.removeItem('generalSettings'))
  })

  test('快捷键单命令禁用与重新启用', async ({ projectPage }) => {
    const page = projectPage
    await openSettings(page)
    await gotoSettingsTab(page, '快捷键设置')
    const row = page.locator('.settings-list__item').filter({ hasText: '聚焦项目' }).first()
    await expect(row).toBeVisible()
    // 开关 input 视觉隐藏,点击可见的 .ui-switch label(真实用户行为)
    const toggle = row.locator('.ui-switch__input')
    const switchLabel = row.locator('label.ui-switch').first()
    await expect(toggle).toBeChecked()

    // 禁用：组合键 pill 进入划线态（opacity 0.4）
    await switchLabel.click()
    await expect(toggle).not.toBeChecked()
    const comboPill = row.locator('.settings-code').first()
    await expect(comboPill).toHaveCSS('opacity', '0.4')

    // 重新启用恢复
    await switchLabel.click()
    await expect(toggle).toBeChecked()
    await expect(comboPill).not.toHaveCSS('opacity', '0.4')
  })

  test('项目信息改名 → 重置回退输入值（不落盘）', async ({ projectPage }) => {
    const page = projectPage
    await openSettings(page)
    await gotoSettingsTab(page, '项目信息')
    const nameInput = page.locator('.settings-workbench').getByPlaceholder('输入项目名称')
    const original = await nameInput.inputValue()
    await nameInput.fill(original + '-X')
    await page.waitForTimeout(400)
    await expect(page.getByRole('button', { name: '应用更改' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '重置', exact: true })).toBeEnabled()

    // blur 触发 handleNameChange 回写 graphStore.projectName——缺陷正是在
    // "失焦后点重置"的时序下显现的，必须先失焦再重置
    await nameInput.press('Tab')
    await page.waitForTimeout(300)

    // 回归锁（2026-09-03 GUI 覆盖测试发现的缺陷，已修复）：点"重置"后
    // 输入框必须回退到已保存名称——修复前仅清脏状态、输入框保留编辑值，
    // 显示与磁盘不一致且按钮禁用，用户无法通过重置恢复
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await page.waitForTimeout(400)
    await expect(nameInput).toHaveValue(original)
    await expect(page.getByRole('button', { name: '应用更改' })).toBeDisabled()
  })
})

test.describe('手动数据节点 UI', () => {
  test.beforeEach(async ({ projectPage, testProjectPath }) => {
    await openProjectOnCanvas(projectPage, testProjectPath)
    await closeInspectionDrawer(projectPage)
  })

  // 等画布水合稳定：节点数连续两次读数相等。fixture 的模板/约束/选择状态
  // 异步物化会持续改写画布（含恢复上次选中——迟到时会覆盖用户刚做的选中），
  // 不等稳定会导致"点了新节点、检查器却显示模板 transform"的串台。
  async function waitForCanvasSettled(page: import('@playwright/test').Page) {
    let prev = -1
    for (let i = 0; i < 20; i++) {
      const n = await page.locator('.vue-flow__node').count()
      if (n > 0 && n === prev) return
      prev = n
      await page.waitForTimeout(500)
    }
  }

  // 创建手动数据节点并让检查器跟随。磁贴点击创建即自动选中新节点（DOM 尾部，
  // 用 .last() 区分 fixture 既有的 manualData 节点）——**不做节点点击**：
  // 稠密 fixture 上新节点可能落在侧栏 aside 或既有节点下方，hit-test 被永久
  // 拦截（实测 click 重试至超时），创建自带的选中是唯一可靠路径。
  async function createManualDataNode(page: import('@playwright/test').Page) {
    await waitForCanvasSettled(page)
    const tile = page.locator('.component-tile').filter({ hasText: 'Manual Data' }).first()
    await expect(tile).toBeVisible({ timeout: 5000 })
    await tile.click()
    const mdNode = page.locator('.vue-flow__node-manualData').last()
    await expect(mdNode).toBeVisible({ timeout: 5000 })
    await expect(page.getByPlaceholder('请输入节点名称')).toBeVisible({ timeout: 5000 })
    return mdNode
  }

  // 把焦点从检查器输入框移到静态元素（保持节点选中，检查器不关闭）。
  // Ctrl+S 的全局快捷键对聚焦输入框放行（isIgnoredElement），必须先 blur；
  // 点击画布 pane 会清空选中导致后续轮次需重选节点（点击又不可靠），故用此法。
  async function blurFromInspector(page: import('@playwright/test').Page) {
    await page.locator('.manual-data-inspector h4').first().click()
    await page.waitForTimeout(200)
  }

  test('磁贴点击创建 → 检查器编辑（改名/单元格/增删行）', async ({ projectPage }) => {
    const page = projectPage
    await createManualDataNode(page)

    const nameInput = page.getByPlaceholder('请输入节点名称')
    await nameInput.fill('GUI 手动数据')

    // 单元格经 .data-cell-input 定位（Vue 绑定的是 value property，
    // CSS [value=...] 属性选择器匹配不到），初值断言走 toHaveValue
    const cell = page.locator('.data-cell-input').first()
    await expect(cell).toBeVisible()
    await expect(cell).toHaveValue('value1')
    await cell.fill('Alice')

    await page.getByRole('button', { name: /添加行/ }).click()
    await page.waitForTimeout(400)
    await expect(page.getByText(/\d+ 行 × \d+ 列/).last()).toContainText('4 行')
    const delRow = page.getByRole('button', { name: '删除行' }).last()
    await delRow.click()
    await page.waitForTimeout(400)
    await expect(page.getByText(/\d+ 行 × \d+ 列/).last()).toContainText('3 行')
  })

  // 回归锁（2026-09-03 GUI 覆盖测试发现的缺陷，已修复）：
  // 修复前手动数据节点不置脏标记，Ctrl+S 走保存早退门 no-op 仍弹"已保存"，
  // PUT 不发出、数据永不落盘。三处修复：persistenceStatus 脏标记纳入 manualData、
  // save.ts 早退门补 template_instances/draft manualData、orchestrator payload
  // 空引用数组省略（防后端合并防线失效清空磁盘引用）。
  test('磁贴点击创建 → 编辑 → Ctrl+S 落盘 manual_data', async ({ projectPage, testProjectPath, apiHelper }) => {
    const page = projectPage
    // fixture 自带两类会触发前端 PreValidator BLOCKER 的内容（BLOCKER 拒绝整项目
    // 保存，Ctrl+S 永远发不出 PUT）：①Python 风格 (?P<>) 正则——后端 Python 引擎
    // 合法但 JS RegExp 判"语法无效"；②schema 内嵌 ForeignKey 用 from_column/to_table
    // 命名，PreValidator 期望 from_table_id/from_column_id。本用例验证保存链路本身，
    // 在副本（temp 目录）上 fs 剥离：manifest 的 constraints/regex_nodes 引用 +
    // 各 schema 文件的内嵌 constraints 段。磁盘 schemas 引用与文件本体保留，
    // "保存不清空未入画布引用"断言继续有效。
    const manifestFile = path.join(testProjectPath, 'project.precis.yaml')
    fs.writeFileSync(
      manifestFile,
      stripTopLevelYamlSection(
        stripTopLevelYamlSection(fs.readFileSync(manifestFile, 'utf-8'), 'constraints'),
        'regex_nodes'
      )
    )
    const schemasDir = path.join(testProjectPath, 'schemas')
    for (const f of fs.readdirSync(schemasDir)) {
      if (!f.endsWith('.schema.yaml')) continue
      const fp = path.join(schemasDir, f)
      fs.writeFileSync(fp, stripTopLevelYamlSection(fs.readFileSync(fp, 'utf-8'), 'constraints'))
    }

    await openProjectOnCanvas(page, testProjectPath)
    await closeInspectionDrawer(page)
    await createManualDataNode(page)

    await page.getByPlaceholder('请输入节点名称').fill('GUI 手动数据')
    const cell = page.locator('.data-cell-input').first()
    await expect(cell).toBeVisible()
    await cell.fill('Alice')

    // 创建节点后项目根节点出现未保存标记（graphStore.hasUnsavedChanges 纳入 manualData）
    const rootNode = page.locator('.vue-flow__node-projectRoot').first()
    await expect(rootNode.locator('.status-indicator.unsaved')).toBeVisible({ timeout: 8000 })

    // Ctrl+S 保存 → PUT config/full → manual_data 落盘（blur 保持选中以便第二轮复用）
    const saveResp = page.waitForResponse(
      (resp) => resp.url().includes('/project/config/full') && resp.request().method() === 'PUT',
      { timeout: 15000 },
    )
    await blurFromInspector(page)
    await page.keyboard.press('Control+s')
    const saved = await saveResp
    expect(saved.status()).toBeLessThan(300)

    const resp = await apiHelper.get('/project/config/full')
    expect(resp.ok).toBe(true)
    const fullConfig = (await resp.json()) as {
      manual_data?: Record<string, unknown>
      manifest?: { schemas?: unknown[] }
    }
    expect(Object.keys(fullConfig.manual_data ?? {}).length).toBeGreaterThanOrEqual(1)
    // 保存不得清空画布未承载的磁盘资源引用（fixture 有 12 个 schema）
    expect((fullConfig.manifest?.schemas ?? []).length).toBeGreaterThanOrEqual(12)

    // 回归锁（2026-09-04 扫描发现 3）：已保存（saveState='saved'）的手动数据节点
    // 再编辑必须回标 draft——否则"仅手动数据节点"画布的保存早退门再次触发，
    // 第二轮编辑被静默丢弃。修复=检查器 emitUpdate 附带 saveState: 'draft'。
    // 第一轮保存后节点已标 saved；检查器仍跟随该节点（blur 未清选中）。
    const savedCell = page.locator('.data-cell-input').first()
    await expect(savedCell).toBeVisible()
    await expect(savedCell).toHaveValue('Alice')
    await savedCell.fill('Bob-edited')
    // 行单元格经 @change 提交（blur 触发）——Tab 移焦使其生效
    await page.keyboard.press('Tab')
    // 再编辑后未保存标记重新点亮（编辑回标 draft）
    await expect(rootNode.locator('.status-indicator.unsaved')).toBeVisible({ timeout: 8000 })

    const saveResp2 = page.waitForResponse(
      (r) => r.url().includes('/project/config/full') && r.request().method() === 'PUT',
      { timeout: 15000 },
    )
    await blurFromInspector(page)
    await page.keyboard.press('Control+s')
    const saved2 = await saveResp2
    expect(saved2.status()).toBeLessThan(300)

    const resp2 = await apiHelper.get('/project/config/full')
    expect(resp2.ok).toBe(true)
    const fullConfig2 = (await resp2.json()) as { manual_data?: Record<string, unknown> }
    // 第二轮编辑值落盘（而非被早退门丢弃）
    expect(JSON.stringify(fullConfig2.manual_data ?? {})).toContain('Bob-edited')
  })
})

test.describe('状态栏项目芯片', () => {
  test('点击芯片打开项目管理弹窗', async ({ projectPage, testProjectPath }) => {
    const page = projectPage
    await openProjectOnCanvas(projectPage, testProjectPath)
    await closeInspectionDrawer(page)
    await page.locator('.status-bar .project-chip').click()
    await expect(page.locator('.project-management-modal')).toBeVisible({ timeout: 5000 })
  })
})
