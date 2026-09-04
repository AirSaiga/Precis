import { test as base, expect } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { BACKEND_URL, API_PREFIX } from '../config'

/**
 * E2E 测试共享 Fixture
 *
 * 隔离原则：原件 qa_test/qa_simple 永远只作为拷贝源，任何测试都不通过
 * X-Project-Config-Path 指向它。每个测试拷贝一份副本到 OS 临时目录，
 * apiHelper 的 X-Project-Config-Path 指向副本，原件不再被 API 写入。
 *
 * 实现细节：
 * - isolatedProjectPath 是 test 级 fixture（每个测试一份副本）。
 *   注意：workers=1 下 scope:'worker' 会让所有 spec 共享一个副本（跨 spec 污染），
 *   故必须用 test 级，确保每个测试独立、零共享状态。
 * - testProjectPath 为兼容别名，语义=isolatedProjectPath（副本）。
 */

// 原件路径 — 仅用作拷贝源，禁止直接作为 X-Project-Config-Path
export const QA_SIMPLE_SOURCE = path.resolve(__dirname, '..', '..', 'qa_test', 'qa_simple')

type ApiHelper = {
  get: (endpoint: string) => Promise<Response>
  post: (endpoint: string, body: unknown) => Promise<Response>
  put: (endpoint: string, body: unknown) => Promise<Response>
  delete: (endpoint: string) => Promise<Response>
  healthCheck: () => Promise<boolean>
}

type Fixtures = {
  projectPage: import('@playwright/test').Page
  // 副本路径（每个测试一份），写测试可随意改写而不污染原件、不互相踩
  isolatedProjectPath: string
  // testProjectPath 为兼容别名，语义=isolatedProjectPath（副本）
  testProjectPath: string
  apiHelper: ApiHelper & { configPath: string }
}

export const test = base.extend<Fixtures>({
  projectPage: async ({ page }, use) => {
    // 可选 CPU 限速：E2E_CPU_THROTTLE=<倍率> 时经 CDP 注入（默认关闭）。
    // 用于本地模拟 CI 慢环境——部分时序缺陷（迟到 fitView、动画与交互重叠）
    // 只在慢机器上复现。
    if (process.env.E2E_CPU_THROTTLE) {
      const rate = Number(process.env.E2E_CPU_THROTTLE) || 4
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    }
    // 可选后端延迟：E2E_API_DELAY=<ms> 时延迟所有 /api/ 请求（默认关闭），
    // 模拟 CI 上后端冷启动/慢盘导致的加载链路整体后移（迟到 epoch/水合）。
    if (process.env.E2E_API_DELAY) {
      const delay = Number(process.env.E2E_API_DELAY) || 300
      await page.route('**/api/**', async (route) => {
        await new Promise((r) => setTimeout(r, delay))
        await route.continue()
      })
    }
    // 隐藏画布 MiniMap 与 Controls 悬浮件：两者是画布角落的悬浮层，会吞掉落点
    // 在其区域的 locator 点击（hit-test 拦截）与连线 pointerup（Vue Flow 收不到
    // 完成事件）。加载后自动取景会把节点铺到视口各处，慢环境下节点与悬浮件的
    // 相对位置不确定，导致仅 CI 复现的几何遮挡类抖动。没有任何 e2e 用例覆盖
    // 两者自身功能（个别用例 best-effort 点击"整理节点"，已在调用侧用 isVisible
    // 守卫），测试环境统一隐藏以消除该变量。
    await page.addInitScript(() => {
      const inject = () => {
        if (document.getElementById('e2e-hide-minimap')) return
        const style = document.createElement('style')
        style.id = 'e2e-hide-minimap'
        style.textContent =
          '.vue-flow__minimap, .vue-flow__controls, .custom-controls { display: none !important; }'
        ;(document.head || document.documentElement).appendChild(style)
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject)
      } else {
        inject()
      }
    })
    await use(page)
  },

  isolatedProjectPath: async ({}, use) => {
    // 每个测试一份独立副本，零跨测试/跨 spec 共享。
    // 排除 .precis/（运行时产物：workspaces.json/validation_history.json）：
    // 本机源目录会被历史运行污染，带上它会让"全新项目"路径（首次打开无工作区）
    // 在本地永远走不到，造成本地绿、CI 红的假象（2026-08-25 CI 排障实证）。
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-e2e-${process.pid}-`))
    fs.cpSync(QA_SIMPLE_SOURCE, copyDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== '.precis',
    })
    await use(copyDir)
    // 测试结束后清理本副本
    try { fs.rmSync(copyDir, { recursive: true, force: true }) } catch {}
  },

  testProjectPath: async ({ isolatedProjectPath }, use) => {
    await use(isolatedProjectPath)
  },

  apiHelper: async ({ isolatedProjectPath }, use) => {
    const configPath = isolatedProjectPath
    const helper: ApiHelper & { configPath: string } = {
      configPath,
      get: async (endpoint: string) => {
        const url =
          endpoint === '/health' ? `${BACKEND_URL}/health` : `${BACKEND_URL}${API_PREFIX}${endpoint}`
        return fetch(url, {
          headers: { 'X-Project-Config-Path': configPath },
        })
      },
      post: async (endpoint: string, body: unknown) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-Config-Path': configPath,
          },
          body: JSON.stringify(body),
        })
      },
      put: async (endpoint: string, body: unknown) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-Config-Path': configPath,
          },
          body: JSON.stringify(body),
        })
      },
      delete: async (endpoint: string) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'DELETE',
          headers: { 'X-Project-Config-Path': configPath },
        })
      },
      healthCheck: async () => {
        try {
          const resp = await fetch(`${BACKEND_URL}/health`)
          return resp.ok
        } catch {
          return false
        }
      },
    }
    await use(helper)
  },
})

export { expect }
