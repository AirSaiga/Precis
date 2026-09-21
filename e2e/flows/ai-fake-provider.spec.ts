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

/**
 * AI 链路确定性 CI 守卫（fake provider）
 *
 * 后端 ProviderType=fake（providers/fake.py）按请求内容回放固定剧本：
 * 为 users.nickname 添加 chinese_mixed 字符集（Charset）约束。
 * 本 spec 借它在无真实 LLM key 的 CI 里端到端守卫 AI 三大流程：
 * 1. agent 聊天写盘全链路：/ai/chat/stream（SSE）→ apply_pending 两阶段确认 →
 *    confirm → constraints/ 落盘 charset 约束（params.charset_mode == chinese_mixed）
 * 2. 配置生成流：/ai/config/generate 返回含 Charset 约束的配置 JSON
 * 3. 配置迁移流：/ai/config/migrate/jobs 完成且结果含 users 表
 *
 * 与三个真实 Provider spec（ai-chat-agent / ai-config-generation / ai-config-migration）
 * 的关系：本 spec 不依赖真实 key，CI 常绿；三个真实 spec 仍然保留，有 key 的环境照常跑。
 * 后端未启动时沿用既有 skip 模式（healthCheck）。
 */

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
      } else if (!previousActiveId) {
        // 原本没有默认 provider：删除 fake（删除活动 provider 会自动清空 defaults.chat）
        await apiHelper.delete(`/ai/providers/${fakeProviderId}`)
      }
    } catch {
      // 清理失败不影响测试结果（下次运行会复用已有 fake provider）
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

      // 磁盘上确实出现约束文件
      const constraintFiles = fs.readdirSync(path.join(projectDir, 'constraints'))
      expect(constraintFiles.some((f) => f.endsWith('.constraint.yaml'))).toBe(true)
    },
    { timeout: 120_000 }
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
