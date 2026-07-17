import { defineConfig } from '@playwright/test'

/**
 * Electron 打包 smoke 测试独立配置。
 *
 * 与主 playwright.config.ts 隔离的原因：
 * - 主配置绑定 Vite dev server（webServer），Electron 自启无需它
 * - 主配置强制 Desktop Chrome device，Electron 用 _electron.launch
 * - Electron 测试只跑 flows-electron/，避免与 web E2E 混跑
 *
 * 打包产物路径解析优先级：
 * 1. E2E_ELECTRON_PATH 环境变量（绝对路径）
 * 2. electron/release/ 下的 .exe（Windows）或 .app（macOS）
 */
export default defineConfig({
  testDir: './flows-electron',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000, // Electron 首启较慢
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
