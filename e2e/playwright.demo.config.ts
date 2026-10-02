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
 * README 演示 GIF 录制专用配置（与主测试套件隔离，不影响 CI）
 *
 * 用法：
 *   1. 先起后端：cd backend && python app/start_server.py --port 0
 *   2. cd e2e && npx playwright test -c playwright.demo.config.ts
 *   3. 产物 webm 在 e2e/demo-output/，再用 ffmpeg 转 GIF/MP4（见 spec 头注释）
 *
 * 与主配置的差异：viewport 1440×900、video 全程录制、locale 随 DEMO_LOCALE
 * 切换（默认 zh-CN，DEMO_LOCALE=en-US 录英文版）、slowMo 让操作带人手节奏；
 * testDir 指向 ./demo 不进主套件。
 */
const FRONTEND_PORT = process.env.VITE_FRONTEND_PORT || '5173'
const FRONTEND_URL = process.env.E2E_BASE_URL || `http://localhost:${FRONTEND_PORT}`
const IS_EN = process.env.DEMO_LOCALE === 'en-US'

export default defineConfig({
  testDir: './demo',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './demo-output',
  use: {
    baseURL: FRONTEND_URL,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: IS_EN ? 'en-US' : 'zh-CN',
        timezoneId: IS_EN ? 'America/New_York' : 'Asia/Shanghai',
        video: { mode: 'on', size: { width: 1440, height: 900 } },
        launchOptions: { slowMo: 100 },
      },
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
