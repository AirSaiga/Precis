import * as path from 'path'
import { test, expect } from '../fixtures/base'

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const USERS_CSV = path.join(FIXTURES_DIR, 'test-project', 'data', 'users.csv')

/**
 * AI 配置迁移 E2E 测试
 *
 * 覆盖：
 * - Python pandas 脚本迁移
 * - 自然语言描述迁移
 * - 任务状态轮询到完成/失败
 *
 * 注意：
 * - 需要后端运行并配置好 LLM Provider。
 * - 使用单轮迭代、最小采样以降低成本/时间。
 * - 如果后端或 Provider 不可用，相关测试会自动 skip（而非失败）。
 */

test.describe('AI Config Migration', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI E2E 测试')

    const providersResp = await apiHelper.get('/ai/providers')
    if (!providersResp.ok) {
      test.skip(true, '无法读取 AI Provider 列表，跳过 AI E2E 测试')
      return
    }
    const providers = await providersResp.json()
    const hasConfigured = Array.isArray(providers) && providers.some((p: { is_configured?: boolean }) => p.is_configured)
    test.skip(!hasConfigured, '未配置可用的 AI Provider（缺少 API key），跳过 AI E2E 测试')
  })

  const makePayload = (scriptContent: string, language: string) => ({
    script_content: scriptContent,
    language,
    file_paths: [USERS_CSV],
    project_name: 'e2e-migrate-test',
    project_id: 'e2e-migrate-test',
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
    },
  })

  const pollJob = async (apiHelper: any, jobId: string) => {
    let status = 'pending'
    let data: Record<string, unknown> = {}
    const deadline = Date.now() + 120_000

    while (['pending', 'running'].includes(status) && Date.now() < deadline) {
      const resp = await apiHelper.get(`/ai/config/migrate/jobs/${jobId}`)
      expect(resp.ok).toBe(true)
      data = await resp.json()
      status = data.status as string
      if (['pending', 'running'].includes(status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    return { status, data }
  }

  test('POST /ai/config/migrate/jobs creates a job', async ({ apiHelper }) => {
    const resp = await apiHelper.post(
      '/ai/config/migrate/jobs',
      makePayload('Check that name is not null and email is unique.', 'natural_language')
    )
    expect(resp.ok).toBe(true)
    const data = await resp.json()
    expect(data).toHaveProperty('job_id')
  })

  test('natural language migration reaches completed or failed', async ({ apiHelper }) => {
    const createResp = await apiHelper.post(
      '/ai/config/migrate/jobs',
      makePayload('Name cannot be empty. Email must be unique.', 'natural_language')
    )
    expect(createResp.ok).toBe(true)
    const { job_id: jobId } = await createResp.json()

    const { status, data } = await pollJob(apiHelper, jobId)
    expect(['completed', 'failed']).toContain(status)

    if (status === 'completed') {
      expect(data.result).toBeDefined()
      const result = data.result as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(result.schemas).toBeDefined()
    }
  })

  test('python pandas migration reaches completed or failed', async ({ apiHelper }) => {
    const script = `import pandas as pd

df = pd.read_csv('${USERS_CSV.replace(/\\/g, '\\\\')}')
assert df['name'].notnull().all()
assert df['email'].duplicated().sum() == 0
`
    const createResp = await apiHelper.post('/ai/config/migrate/jobs', makePayload(script, 'python'))
    expect(createResp.ok).toBe(true)
    const { job_id: jobId } = await createResp.json()

    const { status, data } = await pollJob(apiHelper, jobId)
    expect(['completed', 'failed']).toContain(status)

    if (status === 'completed') {
      expect(data.result).toBeDefined()
      const result = data.result as Record<string, unknown>
      expect(result.success).toBe(true)
    }
  })
})
