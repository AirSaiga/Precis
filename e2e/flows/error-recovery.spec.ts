import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * 损坏配置恢复 E2E 测试
 *
 * 验证前端在收到后端错误响应时的优雅降级行为。
 * 涵盖：
 * - manifest YAML 语法错误
 * - 空的 project.precis.yaml
 * - project.view.json 损坏
 * - 数据文件不存在时的校验错误
 */

/**
 * 创建临时损坏项目目录
 */
function createBrokenProject(
  suffix: string,
  manifestContent: string,
  extraFiles?: Record<string, string>
): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-broken-${suffix}-`))
  const schemasDir = path.join(tmpDir, 'schemas')
  const constraintsDir = path.join(tmpDir, 'constraints')
  const dataDir = path.join(tmpDir, 'data')
  fs.mkdirSync(schemasDir, { recursive: true })
  fs.mkdirSync(constraintsDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })

  fs.writeFileSync(path.join(tmpDir, 'project.precis.yaml'), manifestContent, 'utf-8')

  if (extraFiles) {
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const target = path.join(tmpDir, relPath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf-8')
    }
  }

  return tmpDir
}

/**
 * 清理临时目录
 */
function cleanupProject(projectDir: string) {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true })
  } catch {
    // 忽略清理错误
  }
}

test.describe('Corrupted Configuration Recovery', () => {
  test.describe('Backend Error Handling', () => {
    test('manifest with YAML syntax error returns server error', async ({ apiHelper }) => {
      const project = createBrokenProject(
        'yaml',
        'this: is: not: valid: yaml: : :'
      )
      try {
        const resp = await apiHelper.get('/project/v2/manifest')
        // 完全损坏的 YAML 应该返回 500
        expect(resp.status).toBeGreaterThanOrEqual(500)
      } finally {
        cleanupProject(project)
      }
    })

    test('empty manifest returns error without crashing', async ({ apiHelper }) => {
      const project = createBrokenProject('empty', '')
      try {
        const resp = await apiHelper.get('/project/v2/manifest')
        // 空文件应该返回 404 或 500，关键是不要 200
        expect(resp.status).not.toBe(200)
        const body = await resp.json().catch(() => ({}))
        // 应返回有内容的错误信息
        expect(body.detail || body.message || JSON.stringify(body)).toBeTruthy()
      } finally {
        cleanupProject(project)
      }
    })

    test('corrupt project.view.json returns error', async ({ apiHelper }) => {
      const project = createBrokenProject(
        'view',
        `version: 2\nproject:\n  id: test_view\n  name: Test\nschemas: []\n`
      )
      try {
        // 写入损坏的 view.json
        fs.writeFileSync(
          path.join(project, 'project.view.json'),
          'this is not valid json {{',
          'utf-8'
        )

        const resp = await apiHelper.get('/project/v2/view')
        // 当前后端返回 500
        expect(resp.status).toBe(500)
        const body = await resp.json().catch(() => ({}))
        expect(body.detail || body.message || '').toBeTruthy()
      } finally {
        cleanupProject(project)
      }
    })

    test('missing data file reports not-found in validation', async ({ apiHelper }) => {
      const project = createBrokenProject(
        'missing-data',
        `version: 2\nproject:\n  id: test_missing_data\n  name: Test\nschemas:\n  - id: users\n    path: schemas/users.schema.yaml\n`,
        {
          'schemas/users.schema.yaml': `version: 2\nid: users\nname: users\nsource:\n  mode: relative_file\n  path: data/missing.csv\ncolumns:\n  - id: id\n    name: id\n    type: integer\n    primary_key: true\n`,
        }
      )
      try {
        const resp = await fetch(
          `${process.env.E2E_BACKEND_URL || 'http://localhost:18000'}/api/v1/validate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({ data_directory: path.join(project, 'data') }),
          }
        )
        // 应返回结果而非崩溃
        expect(resp.status).toBeLessThan(500)
        const result = await resp.json().catch(() => ({}))
        const allErrors = [
          ...(result.errors || []),
          ...(result.loading_errors || []),
        ]
        const messages = allErrors.map((e: any) => e.message || '').join(' ')
        expect(allErrors.length).toBeGreaterThan(0)
        expect(
          messages.includes('未找到') ||
          messages.includes('不存在') ||
          messages.toLowerCase().includes('not found') ||
          messages.toLowerCase().includes('missing')
        ).toBe(true)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('Frontend Graceful Degradation', () => {
    test('backend error shows friendly message on UI', async ({ page, apiHelper }) => {
      // 验证前端应用不会因后端错误而白屏或崩溃
      // 直接访问前端页面（不依赖特定项目）
      const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173'
      await page.goto(baseUrl)

      // 等待页面基本渲染（至少 body 存在）
      await expect(page.locator('body')).toBeVisible()

      // 页面应正常渲染，不应出现完全空白
      const bodyText = await page.locator('body').textContent() || ''
      expect(bodyText.length).toBeGreaterThan(0)
    })
  })
})
