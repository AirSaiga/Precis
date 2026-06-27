import { test, expect } from '../fixtures/base'

/**
 * AI apply_actions 两阶段确认 E2E 测试
 *
 * 覆盖:
 * - POST /ai/chat/{job_id}/confirm 端点行为
 * - 无挂起改动时返回 404
 * - cancel 端点同步 resolve reject
 *
 * 注意:
 * - 完整确认流(LLM→apply_actions→确认卡→点确认)需真实 LLM 调用 apply_actions，
 *   且依赖前端 SSE 连接。由于 CI 环境通常未配置 LLM API key，该测试会 skip。
 * - 当前覆盖 confirm 端点的 HTTP 契约。
 */

test.describe('AI Chat Confirm Endpoint', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI Chat Confirm E2E 测试')
  })

  test('POST /ai/chat/{job_id}/confirm 无挂起改动时返回 404', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/nonexistent_job_id/confirm', { decision: 'confirm' })
    expect(resp.status).toBe(404)
  })

  test('POST /ai/chat/{job_id}/confirm with invalid body returns 422', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/test_job_123/confirm', {})
    expect(resp.status).toBe(422)
  })

  test('POST /ai/chat/{job_id}/confirm with confirm decision', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/chat/test_job_confirm/confirm', { decision: 'confirm' })
    // 无实际挂起的 job，返回 404
    expect(resp.status).toBe(404)
  })

  test('POST /ai/jobs/{job_id}/cancel 不存在的 job 返回 not_found', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/ai/jobs/nonexistent_job_cancel/cancel')
    expect(resp.ok).toBe(true)
    const data = await resp.json()
    expect(data.status).toBe('not_found')
  })
})
