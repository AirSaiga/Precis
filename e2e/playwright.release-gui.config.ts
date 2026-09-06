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
 * 发布控制台（scripts/release-gui.html）专属 Playwright 配置
 *
 * 与主 E2E 的区别：被测对象是 release-gui.mjs 自带的本地服务（无需前端/后端），
 * 由测试在 beforeAll 里自行 spawn（端口 3311），因此本配置不声明 webServer。
 */
export default defineConfig({
  testDir: './release-gui',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.RELEASE_GUI_URL || 'http://127.0.0.1:3311',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
