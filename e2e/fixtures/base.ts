import { test as base, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { BACKEND_URL, API_PREFIX } from '../config'

/**
 * E2E 测试共享 Fixture
 *
 * 提供：
 * - projectPage: 自动导航到项目页面的 page
 * - testProjectPath: 测试用项目配置路径
 * - apiHelper: 后端 API 调用辅助
 */

// 测试项目 fixture 路径
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const TEST_PROJECT_DIR = path.join(FIXTURES_DIR, 'test-project')

type Fixtures = {
  projectPage: import('@playwright/test').Page
  testProjectPath: string
  apiHelper: {
    get: (endpoint: string) => Promise<Response>
    post: (endpoint: string, body: unknown) => Promise<Response>
    put: (endpoint: string, body: unknown) => Promise<Response>
    delete: (endpoint: string) => Promise<Response>
    healthCheck: () => Promise<boolean>
  }
}

export const test = base.extend<Fixtures>({
  projectPage: async ({ page }, use) => {
    await use(page)
  },

  testProjectPath: async ({}, use) => {
    await use(TEST_PROJECT_DIR)
  },

    apiHelper: async ({}, use) => {
    const helper = {
      get: async (endpoint: string) => {
        const url = endpoint === '/health' ? `${BACKEND_URL}/health` : `${BACKEND_URL}${API_PREFIX}${endpoint}`
        return fetch(url, {
          headers: { 'X-Project-Config-Path': TEST_PROJECT_DIR },
        })
      },
      post: async (endpoint: string, body: unknown) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-Config-Path': TEST_PROJECT_DIR,
          },
          body: JSON.stringify(body),
        })
      },
      put: async (endpoint: string, body: unknown) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-Config-Path': TEST_PROJECT_DIR,
          },
          body: JSON.stringify(body),
        })
      },
      delete: async (endpoint: string) => {
        return fetch(`${BACKEND_URL}${API_PREFIX}${endpoint}`, {
          method: 'DELETE',
          headers: { 'X-Project-Config-Path': TEST_PROJECT_DIR },
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
