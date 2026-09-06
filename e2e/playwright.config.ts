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
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 测试配置
 *
 * 测试策略：
 * - 使用 Vite dev server 作为测试目标（快速启动）
 * - 后端需要单独启动（或通过 CI 脚本管理）
 * - 核心流程测试覆盖：项目创建、Schema 绑定、约束添加、校验执行
 */
const FRONTEND_PORT = process.env.VITE_FRONTEND_PORT || '5173'
const FRONTEND_URL = process.env.E2E_BASE_URL || `http://localhost:${FRONTEND_PORT}`

export default defineConfig({
  testDir: './flows',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'cd ../frontend && npm run dev',
        url: FRONTEND_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
