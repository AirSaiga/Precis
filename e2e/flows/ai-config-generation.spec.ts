import * as path from 'path'
import { test, expect } from '../fixtures/base'

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const USERS_CSV = path.join(FIXTURES_DIR, 'test-project', 'data', 'users.csv')

/**
 * AI 配置生成 Agent 模式 E2E 测试
 *
 * 覆盖：
 * - 创建异步生成任务
 * - 任务状态轮询
 * - 任务完成时返回 schemas/constraints
 * - current_plan 在任务执行过程中可能返回
 *
 * 注意：
 * - 这些测试调用真实后端，需要后端运行并配置好 LLM Provider。
 * - 为了降低成本/时间，使用单轮迭代、最小采样。
 * - 如果后端或 Provider 不可用，相关测试会自动 skip（而非失败）。
 */

test.describe('AI Config Generation Agent Mode', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI E2E 测试')

    // 检查是否配置了可用 Provider（见 ai-chat-agent.spec.ts 的同类说明）。
    const providersResp = await apiHelper.get('/ai/providers')
    if (!providersResp.ok) {
      test.skip(true, '无法读取 AI Provider 列表，跳过 AI E2E 测试')
      return
    }
    const providers = await providersResp.json()
    const hasConfigured = Array.isArray(providers) && providers.some((p: { is_configured?: boolean }) => p.is_configured)
    test.skip(!hasConfigured, '未配置可用的 AI Provider（缺少 API key），跳过 AI E2E 测试')
  })

  const makePayload = (overrides?: Record<string, unknown>) => ({
    file_paths: [USERS_CSV],
    project_name: 'e2e-agent-test',
    project_id: 'e2e-agent-test',
    options: {
      sample_rows: 10,
      sample_values_per_column: 5,
      max_files: 1,
      max_cell_chars: 100,
      generate_schemas: true,
      generate_constraints: true,
      generate_regex_nodes: false,
      keep_existing: false,
      agent_mode: true,
      max_iterations: 1,
      validation_sample_size: 100,
      auto_chunking: false,
      chunk_max_columns: 20,
      chunk_max_files: 5,
      ...overrides,
    },
  })

  test('POST /ai/config/generate/jobs creates a job', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/config/generate/jobs', makePayload())
    expect(resp.ok).toBe(true)
    const data = await resp.json()
    expect(data).toHaveProperty('job_id')
    expect(typeof data.job_id).toBe('string')
  })

  test('agent generation job reaches completed or failed', async ({ apiHelper }) => {
    const createResp = await apiHelper.post('/ai/config/generate/jobs', makePayload())
    expect(createResp.ok).toBe(true)
    const { job_id: jobId } = await createResp.json()

    let status = 'pending'
    let data: Record<string, unknown> = {}
    const deadline = Date.now() + 120_000

    while (['pending', 'running'].includes(status) && Date.now() < deadline) {
      const resp = await apiHelper.get(`/ai/config/generate/jobs/${jobId}`)
      expect(resp.ok).toBe(true)
      data = await resp.json()
      status = data.status as string
      if (['pending', 'running'].includes(status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    expect(['completed', 'failed']).toContain(status)

    if (status === 'completed') {
      expect(data.result).toBeDefined()
      const result = data.result as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(result.schemas).toBeDefined()
    } else {
      expect(data.error).toBeDefined()
    }
  })

  test('single-shot mode also completes or fails', async ({ apiHelper }) => {
    const createResp = await apiHelper.post('/ai/config/generate/jobs', makePayload({ agent_mode: false }))
    expect(createResp.ok).toBe(true)
    const { job_id: jobId } = await createResp.json()

    let status = 'pending'
    let data: Record<string, unknown> = {}
    const deadline = Date.now() + 120_000

    while (['pending', 'running'].includes(status) && Date.now() < deadline) {
      const resp = await apiHelper.get(`/ai/config/generate/jobs/${jobId}`)
      expect(resp.ok).toBe(true)
      data = await resp.json()
      status = data.status as string
      if (['pending', 'running'].includes(status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    expect(['completed', 'failed']).toContain(status)
  })
})
