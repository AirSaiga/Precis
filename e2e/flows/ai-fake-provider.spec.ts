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
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '../fixtures/base'
import { BACKEND_URL, API_PREFIX } from '../config'
import { openProjectOnCanvas } from '../fixtures/openProject'

/**
 * AI 链路确定性 CI 守卫（fake provider）
 *
 * 后端 ProviderType=fake（providers/fake.py）按请求内容回放固定剧本：
 * 为 users.nickname 添加 chinese_mixed 字符集（Charset）约束。
 * 本 spec 借它在无真实 LLM key 的 CI 里端到端守卫 AI 三大流程：
 * 1. agent 聊天写盘全链路：/ai/chat/stream（SSE）→ apply_pending 两阶段确认 →
 *    confirm → constraints/ 落盘 charset 约束（params.charset_mode == chinese_mixed）
 *    → frontend_instruction 为 v2 变更集信封（entityId ≡ 磁盘文件 id，画布对账口径）
 * 2. 配置生成流：/ai/config/generate 返回含 Charset 约束的配置 JSON
 * 3. 配置迁移流：/ai/config/migrate/jobs 完成且结果含 users 表
 * 4. GUI 保存 roundtrip 回归：AI 建约束 → 画布对账（节点 id == 磁盘实体 id）→
 *    GUI 保存 → 重载 → 无重复节点
 *
 * UPDATE 路径说明：fake 剧本只产出 ADD（Charset 约束），无 UPDATE 动作可回放，
 * 因此"update 信封 → 已存在节点原地刷新（refreshExisting）"的对账口径由单测覆盖：
 * frontend/tests/services/canvasReconcile/refreshExisting.integration.test.ts
 * （真实 v2Import 工厂验证磁盘新值落进节点 data、幽灵内嵌约束移除、撤销栈不入 AI 删除）。
 *
 * 与三个真实 Provider spec（ai-chat-agent / ai-config-generation / ai-config-migration）
 * 的关系：本 spec 不依赖真实 key，CI 常绿；三个真实 spec 仍然保留，有 key 的环境照常跑。
 * 后端未启动时沿用既有 skip 模式（healthCheck）。
 */

/** v2 契约（docs/contracts/frontend-instructions-v2.md）信封六字段 */
const ENVELOPE_KEYS = ['instructionId', 'actionType', 'op', 'kind', 'entityId', 'filePath'] as const

const FAKE_PROVIDER_NAME = 'fake-e2e'
const TERMINAL_EVENTS = new Set(['completed', 'error', 'cancelled'])

type ProviderRecord = { id: string; provider?: string; type?: string; is_configured?: boolean }

type SseEvent = { id?: number; event: string; data: Record<string, unknown> }

/** 项目级请求：携带 X-Project-Config-Path 指向自建的临时项目。 */
async function projectFetch(endpoint: string, configPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Project-Config-Path': configPath,
      ...(init?.headers ?? {}),
    },
  })
}

/** 创建最小临时项目：users 表（id/name/nickname 列）+ 数据文件。返回项目根目录。 */
function createFakeProject(tag: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `precis-fake-${tag}-`))
  fs.mkdirSync(path.join(root, 'schemas'), { recursive: true })
  fs.mkdirSync(path.join(root, 'constraints'), { recursive: true })
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })

  fs.writeFileSync(
    path.join(root, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      `  id: fake-e2e-${tag}`,
      `  name: fake-e2e-${tag}`,
      'schemas:',
      '  - id: users',
      '    path: schemas/users.schema.yaml',
      '',
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'schemas', 'users.schema.yaml'),
    [
      'version: 2',
      'id: users',
      'name: users',
      'source:',
      '  mode: relative_file',
      '  path: data/users.csv',
      'columns:',
      '  - id: id',
      '    name: id',
      '    type: integer',
      '    primary_key: true',
      '    nullable: false',
      '  - id: name',
      '    name: name',
      '    type: string',
      '  - id: nickname',
      '    name: nickname',
      '    type: string',
      'constraints: []',
      '',
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'data', 'users.csv'),
    ['id,name,nickname', '1,张三,小明Plus', '2,李四,阿杰88', '3,Tom,杰瑞'].join('\n') + '\n'
  )

  return root
}

/**
 * 逐帧解析 SSE 流，onEvent 逐事件回调（可为异步，如收到 apply_pending 时发 confirm）；
 * 遇到终止事件（completed/error/cancelled）结束。
 * 帧格式：`id: N\nevent: x\ndata: {...}\n\n`，心跳帧 `:keep-alive` 跳过。
 */
async function consumeSse(
  res: Response,
  onEvent: (ev: SseEvent) => Promise<void> | void
): Promise<void> {
  expect(res.body).not.toBeNull()
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body!) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const ev: Partial<SseEvent> = {}
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue // 心跳注释行
        if (line.startsWith('event: ')) ev.event = line.slice(7).trim()
        else if (line.startsWith('data: ')) {
          try {
            ev.data = JSON.parse(line.slice(6))
          } catch {
            ev.data = {}
          }
        } else if (line.startsWith('id: ')) ev.id = Number(line.slice(4).trim())
      }
      if (!ev.event) continue
      const typed = ev as SseEvent
      await onEvent(typed)
      if (TERMINAL_EVENTS.has(typed.event)) return
    }
  }
}

test.describe('AI Fake Provider（确定性 CI 守卫）', () => {
  // beforeAll 中确定的 fake provider id 与原有默认（用于 afterAll 还原，避免污染本机配置）
  let fakeProviderId = ''
  let previousActiveId: string | null = null

  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI fake provider E2E 测试')

    const providersResp = await apiHelper.get('/ai/providers')
    test.skip(!providersResp.ok, '无法读取 AI Provider 列表，跳过 AI fake provider E2E 测试')
    const providers: ProviderRecord[] = await providersResp.json()

    // 记录原有默认 provider，测试结束后还原
    const activeResp = await apiHelper.get('/ai/providers/active')
    if (activeResp.ok) {
      const active = await activeResp.json()
      previousActiveId = active?.id ?? null
    }

    // 已存在 type=fake 的 provider 直接复用；否则经 providers 添加端点创建
    const existing = providers.find((p) => p.provider === 'fake' || p.type === 'fake')
    if (existing) {
      fakeProviderId = existing.id
    } else {
      const createResp = await apiHelper.post('/ai/providers', {
        name: FAKE_PROVIDER_NAME,
        type: 'fake',
        base_url: 'http://localhost/fake',
        model: 'fake-1',
      })
      test.skip(!createResp.ok, `创建 fake provider 失败（${createResp.status}），跳过 AI fake provider E2E 测试`)
      const created = await createResp.json()
      fakeProviderId = created.id
      expect(fakeProviderId).toBeTruthy()
    }

    // 设为 chat 默认 provider（生成/迁移服务在无 generate 默认时回退 chat）
    const activateResp = await apiHelper.post(`/ai/providers/${fakeProviderId}/activate`, {})
    expect(activateResp.ok).toBe(true)
  })

  test.afterAll(async ({ apiHelper }) => {
    if (!fakeProviderId) return
    try {
      if (previousActiveId && previousActiveId !== fakeProviderId) {
        // 还原原有默认，避免影响真实 provider 的会话与其它 spec 的 skip 判定
        await apiHelper.post(`/ai/providers/${previousActiveId}/activate`, {})
      }
      // 无论此前是否存在默认 provider，都必须删除 fake 条目：type=fake 写入真实
      // 用户配置（~/.precis/ai_providers.yaml）后，不认识该类型的已安装版本
      // （如 0.1.6，枚举仅 openai/ollama）会因校验失败拒绝启动（v0.1.7 实证踩坑）。
      // 无默认时删除活动 provider 会自动清空 defaults.chat，语义同样正确
      await apiHelper.delete(`/ai/providers/${fakeProviderId}`)
    } catch {
      // 清理失败不影响测试结果（残留条目由下次运行 beforeAll 的复用分支兜底）
    }
  })

  test(
    'agent 聊天两阶段确认写盘全链路：apply_pending → confirm → charset 约束落盘',
    async () => {
      test.setTimeout(120_000)
      const projectDir = createFakeProject('agent')

      const streamResp = await projectFetch('/ai/chat/stream', projectDir, {
        method: 'POST',
        body: JSON.stringify({
          message: '为 users 表 nickname 列加中文混合字符集约束',
          context: { hasContext: false, selectedNodes: [] },
          history: [],
          agent_mode: true,
        }),
      })
      expect(streamResp.ok).toBe(true)

      const events: SseEvent[] = []
      let confirmStatus = -1
      await consumeSse(streamResp, async (ev) => {
        events.push(ev)
        // 关键时序：apply_pending 到达时 orchestrator 正挂起等待用户决策，
        // 必须在流消费过程中立即 confirm，流才能走到 completed
        if (ev.event === 'apply_pending') {
          const started = events.find((e) => e.event === 'started')!
          const jobId = started.data.job_id as string
          const applyId = ev.data.apply_id as string
          const confirmResp = await projectFetch(`/ai/chat/${jobId}/confirm`, projectDir, {
            method: 'POST',
            body: JSON.stringify({ decision: 'confirm', apply_id: applyId }),
          })
          confirmStatus = confirmResp.status
        }
      })

      const names = events.map((e) => e.event)
      expect(names).toContain('started')
      expect(names).toContain('tool_call')
      expect(names).toContain('apply_pending')
      expect(names).toContain('apply_confirmed')
      expect(names).toContain('completed')

      // 两阶段确认成功（controller 命中且未被兜底清理）
      expect(confirmStatus).toBe(200)

      // 最终回复由 fake 剧本第二轮产出
      const completed = events.find((e) => e.event === 'completed')!
      const reply = completed.data.reply as string
      expect(reply).toContain('字符集')

      // ---- v2 变更集信封（画布对账口径）----
      // frontend_instruction 事件逐条携带六字段信封；entityId 恒等于磁盘约束文件名
      // 推导的 id（画布节点 id 与之恒等——不再是随机 uuid）
      const envelopes = events
        .filter((e) => e.event === 'frontend_instruction')
        .map((e) => e.data.instruction as Record<string, unknown>)
      expect(envelopes.length).toBeGreaterThanOrEqual(1)
      for (const env of envelopes) {
        for (const key of ENVELOPE_KEYS) {
          expect(env, `信封缺字段 ${key}`).toHaveProperty(key)
        }
        expect(env.op).toBe('add')
        expect(env.kind).toBe('constraint')
        expect(env.entityId).toBe(String(env.entityId))
        expect(String(env.filePath)).toMatch(/^constraints\/.+\.constraint\.yaml$/)
        // 确定性 instructionId："{op}:{kind}:{entityId}"
        expect(env.instructionId).toBe(`${env.op}:${env.kind}:${env.entityId}`)
      }
      const charsetEnvelope = envelopes.find((e) => String(e.entityId).startsWith('charset_'))
      expect(charsetEnvelope).toBeDefined()

      // 落盘断言：constraints/ 出现 Charset 约束且 charset_mode == chinese_mixed
      const fullResp = await projectFetch('/project/config/full', projectDir)
      expect(fullResp.ok).toBe(true)
      const full = await fullResp.json()
      const constraints = Object.values(
        (full.constraints ?? {}) as Record<string, Record<string, unknown>>
      ) as Record<string, unknown>[]
      const charset = constraints.find((c) => c.type === 'Charset')
      expect(charset).toBeDefined()
      expect((charset!.refs as Record<string, string>).column_id).toBe('nickname')
      expect((charset!.refs as Record<string, string>).table_id).toBe('users')
      expect((charset!.params as Record<string, string>).charset_mode).toBe('chinese_mixed')

      // 磁盘上确实出现约束文件，且文件名 id == 信封 entityId（恒等约束）
      const constraintFiles = fs.readdirSync(path.join(projectDir, 'constraints')).filter((f) => f.endsWith('.constraint.yaml'))
      expect(constraintFiles.length).toBeGreaterThanOrEqual(1)
      const charsetFile = constraintFiles.find((f) => f.startsWith('charset_'))!
      expect(`${'add'}:constraint:${charsetFile.replace('.constraint.yaml', '')}`).toBe(
        charsetEnvelope!.instructionId
      )
    },
    { timeout: 120_000 }
  )

  test(
    'GUI 保存 roundtrip：AI 建约束 → 画布对账（节点 id == 磁盘实体 id）→ 保存 → 重载无重复节点',
    async ({ page }) => {
      test.setTimeout(180_000)
      const projectDir = createFakeProject('roundtrip')

      // 打开临时项目（localStorage 引导，启动自动恢复直达画布）
      await openProjectOnCanvas(page, projectDir)
      // 关闭可能自动弹出的配置自检抽屉（复用 mode-toggle.spec.ts 的模式）
      for (let i = 0; i < 6; i++) {
        const drawer = page.locator('.inspection-drawer')
        if (await drawer.isVisible().catch(() => false)) {
          await drawer.locator('button[title="关闭"]').first().click({ timeout: 5000 }).catch(() => {})
          await expect(drawer).toBeHidden({ timeout: 5000 }).catch(() => {})
        }
        await page.waitForTimeout(500)
      }

      // 切到 Agent 模式（AIChatPanel 随 AgentLayout 挂载）
      await page.locator('.mode-toggle-option', { hasText: 'Agent' }).first().click()
      await expect(page.locator('.ai-chat-panel')).toBeVisible({ timeout: 15_000 })

      // 发送触发 fake 剧本的消息（为 nickname 加中文混合字符集约束）
      const chatInput = page.locator('.chat-input-area textarea')
      await expect(chatInput).toBeVisible({ timeout: 10_000 })
      await chatInput.fill('为 users 表 nickname 列加中文混合字符集约束')
      await chatInput.press('Enter')

      // 两阶段确认卡出现后：先点头部展开（卡体默认折叠，按钮在展开区），再点"确认修改"
      const confirmCard = page.locator('.apply-confirm-card')
      await expect(confirmCard).toBeVisible({ timeout: 60_000 })
      await confirmCard.locator('.confirm-header').click()
      const confirmBtn = confirmCard.locator('.btn-confirm')
      await expect(confirmBtn).toBeVisible({ timeout: 10_000 })
      await confirmBtn.click()

      // 等后端落盘：constraints/ 出现 charset 约束文件，取文件名 id 作为确定性节点 id
      const deadlineFile = Date.now() + 60_000
      let constraintFileStem = ''
      while (Date.now() < deadlineFile) {
        const files = fs
          .readdirSync(path.join(projectDir, 'constraints'))
          .filter((f) => f.startsWith('charset_') && f.endsWith('.constraint.yaml'))
        if (files.length > 0) {
          constraintFileStem = files[0].replace('.constraint.yaml', '')
          break
        }
        await page.waitForTimeout(500)
      }
      expect(constraintFileStem).not.toBe('')

      // 画布对账：出现 id == 磁盘实体 id 的约束节点，且恰好一个（不再是随机 uuid）
      const constraintNode = page.locator(`.vue-flow__node[data-id="${constraintFileStem}"]`)
      await expect(constraintNode).toHaveCount(1, { timeout: 30_000 })

      // 对账摘要状态行可见（v2 同步结果反馈）
      await expect(page.locator('.canvas-sync-card').first()).toBeVisible({ timeout: 15_000 })

      // GUI 保存：先点画布空白处移出输入焦点，再 Ctrl+S，等待"已保存"toast
      await page.locator('.vue-flow__pane').first().click({ position: { x: 50, y: 50 } })
      await page.keyboard.press('Control+s')
      await expect(page.getByText('已保存').first()).toBeVisible({ timeout: 30_000 })

      // 重载：hydrate 从 manifest 重建画布，确定性 id 节点不重复
      await page.reload()
      await openProjectOnCanvas(page, projectDir)
      const reloadedNode = page.locator(`.vue-flow__node[data-id="${constraintFileStem}"]`)
      await expect(reloadedNode).toHaveCount(1, { timeout: 30_000 })
      // 不存在同约束的第二个节点（旧"镜像随机 uuid + hydrate 确定性 id"双节点缺陷形态）
      const charsetNodeCount = await page.locator('.vue-flow__node-charsetConstraint').count()
      expect(charsetNodeCount).toBe(1)
    },
    { timeout: 180_000 }
  )

  test(
    '配置生成流：/ai/config/generate 返回含 Charset(chinese_mixed) 的配置',
    async () => {
      test.setTimeout(60_000)
      const projectDir = createFakeProject('gen')

      const resp = await projectFetch('/ai/config/generate', projectDir, {
        method: 'POST',
        body: JSON.stringify({
          file_paths: [path.join(projectDir, 'data', 'users.csv')],
          project_name: 'fake-e2e-gen',
          project_id: 'fake-e2e-gen',
          options: {
            sample_rows: 10,
            sample_values_per_column: 5,
            max_files: 1,
            max_cell_chars: 100,
            generate_schemas: true,
            generate_constraints: true,
            generate_regex_nodes: false,
            keep_existing: false,
          },
        }),
      })
      expect(resp.ok).toBe(true)
      const data = await resp.json()
      expect(data.success).toBe(true)

      // schemas 含 users 表（含 nickname 列）
      const schemas = data.schemas as Record<string, { columns?: { id: string }[] }>
      expect(schemas.users).toBeDefined()
      expect(schemas.users.columns.map((c) => c.id)).toContain('nickname')

      // constraints 含 Charset 约束，charset_mode 落位正确
      const constraints = Object.values(data.constraints ?? {}) as Record<string, unknown>[]
      const charset = constraints.find((c) => c.type === 'Charset')
      expect(charset).toBeDefined()
      const refs = charset!.refs as Record<string, string>
      expect(refs.table_id).toBe('users')
      expect(refs.column_id).toBe('nickname')
      expect((charset!.params as Record<string, string>).charset_mode).toBe('chinese_mixed')
    },
    { timeout: 60_000 }
  )

  test(
    '配置迁移流：/ai/config/migrate/jobs 完成且结果含 users 表',
    async () => {
      test.setTimeout(90_000)
      const projectDir = createFakeProject('migrate')

      const createResp = await projectFetch('/ai/config/migrate/jobs', projectDir, {
        method: 'POST',
        body: JSON.stringify({
          script_content: '昵称 nickname 列必须是中文混合字符集，姓名 name 不能为空。',
          language: 'natural_language',
          file_paths: [path.join(projectDir, 'data', 'users.csv')],
          project_name: 'fake-e2e-migrate',
          project_id: 'fake-e2e-migrate',
          options: {
            sample_rows: 10,
            sample_values_per_column: 5,
            max_files: 1,
            max_cell_chars: 100,
            generate_schemas: true,
            generate_constraints: true,
            generate_regex_nodes: false,
            keep_existing: false,
          },
        }),
      })
      expect(createResp.ok).toBe(true)
      const { job_id: jobId } = await createResp.json()
      expect(jobId).toBeTruthy()

      // fake provider 无网络调用，任务应秒级完成；轮询上限 60s 兜底
      let status = 'pending'
      let data: Record<string, unknown> = {}
      const deadline = Date.now() + 60_000
      while (['pending', 'running'].includes(status) && Date.now() < deadline) {
        const resp = await projectFetch(`/ai/config/migrate/jobs/${jobId}`, projectDir)
        expect(resp.ok).toBe(true)
        data = await resp.json()
        status = data.status as string
        if (['pending', 'running'].includes(status)) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      expect(status).toBe('completed')

      const result = data.result as Record<string, unknown>
      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      const schemas = result.schemas as Record<string, unknown>
      expect(schemas.users).toBeDefined()

      // 迁移剧本同样产出 Charset(chinese_mixed) 约束
      const constraints = Object.values(result.constraints ?? {}) as Record<string, unknown>[]
      const charset = constraints.find((c) => c.type === 'Charset')
      expect(charset).toBeDefined()
      expect((charset!.params as Record<string, string>).charset_mode).toBe('chinese_mixed')
    },
    { timeout: 90_000 }
  )
})
