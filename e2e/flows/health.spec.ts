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
