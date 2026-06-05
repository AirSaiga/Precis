import { test, expect } from '../fixtures/base'

/**
 * 后端健康检查 E2E 测试
 *
 * 验证后端服务正常启动并响应请求。
 * 这是所有其他 E2E 测试的前置条件。
 */
test.describe('Backend Health', () => {
  test('backend health endpoint returns OK', async ({ apiHelper }) => {
    const isHealthy = await apiHelper.healthCheck()
    expect(isHealthy).toBe(true)
  })

  test('backend returns proper CORS headers', async ({ apiHelper }) => {
    const resp = await apiHelper.get('/health')
    expect(resp.status).toBeLessThan(500)
  })
})
