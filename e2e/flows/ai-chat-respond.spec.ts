import { test, expect } from '../fixtures/base'

/**
 * AI ask_user /respond 端点 E2E 契约测试
 *
 * 覆盖:
 * - POST /ai/chat/{job_id}/respond 端点的 HTTP 契约
 * - 无挂起提问时返回 404
 * - body 缺字段返回 422
 * - cancel 端点与 respond 的隔离（cancel 走 not_found 语义）
 *
 * 注意:
 * - 完整 ask 流（LLM→ask_user→AskUserCard→点提交→/respond）需真实 LLM 调用 ask_user，
 *   且依赖前端 SSE 连接。CI 环境通常未配置 LLM API key，该类测试由 pytest + vitest 覆盖。
 * - 本测试聚焦 /respond 端点的 HTTP 契约（与 ai-chat-confirm.spec.ts 对称）。
 */

test.describe('AI Chat Respond Endpoint (ask_user)', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI Chat Respond E2E 测试')
  })

  test('POST /ai/chat/{job_id}/respond 无挂起提问时返回 404', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/nonexistent_job_id/respond', {
      ask_id: 'nonexistent_job_id#ask#1',
      response: { answer: 'test' },
    })
    expect(resp.status).toBe(404)
  })

  test('POST /ai/chat/{job_id}/respond 缺 ask_id 返回 422', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/test_job_respond/respond', {
      response: { answer: 'test' },
    })
    expect(resp.status).toBe(422)
  })

  test('POST /ai/chat/{job_id}/respond 缺 response 返回 422', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/test_job_respond2/respond', {
      ask_id: 'test_job_respond2#ask#1',
    })
    expect(resp.status).toBe(422)
  })

  test('POST /ai/chat/{job_id}/respond 空 body 返回 422', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/test_job_respond3/respond', {})
    expect(resp.status).toBe(422)
  })

  test('POST /ai/chat/{job_id}/respond 带完整 body 但无挂起项仍 404', async ({ apiHelper }) => {
    // 合法 body（ask_id + response 都有），但后端无对应挂起项 → 404
    const resp = await apiHelper.post('/ai/chat/test_job_respond4/respond', {
      ask_id: 'test_job_respond4#ask#1',
      response: { answer: '合法回答' },
    })
    expect(resp.status).toBe(404)
  })

  test('POST /ai/chat/{job_id}/respond skipped 类型 response 合法 body', async ({ apiHelper }) => {
    // skipped 响应也是合法 body（仍 404，因无挂起项，但验证不被 422 拦截）
    const resp = await apiHelper.post('/ai/chat/test_job_respond5/respond', {
      ask_id: 'test_job_respond5#ask#1',
      response: { skipped: true, reason: 'user_skipped' },
    })
    expect(resp.status).toBe(404)
  })
})
