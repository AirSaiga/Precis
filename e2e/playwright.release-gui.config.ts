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
