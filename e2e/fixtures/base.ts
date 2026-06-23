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
    await use(page)
  },

  isolatedProjectPath: async ({}, use) => {
    // 每个测试一份独立副本，零跨测试/跨 spec 共享
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-e2e-${process.pid}-`))
    fs.cpSync(QA_SIMPLE_SOURCE, copyDir, { recursive: true })
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
