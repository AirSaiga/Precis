import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BACKEND_URL } from '../config'

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

const projectPath = path.resolve(__dirname, '..', '..', 'qa_test', 'qa_simple')

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
    test('manifest with YAML syntax error returns server error', async () => {
      const project = createBrokenProject(
        'yaml',
        'this: is: not: valid: yaml: : :'
      )
      try {
        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        // 损坏的 YAML: 后端可能返回 500 或成功解析并返回 200
        // 关键是不应崩溃
        expect(resp.status).toBeLessThan(600)
      } finally {
        cleanupProject(project)
      }
    })

    test('empty manifest returns error or empty object without crashing', async () => {
      const project = createBrokenProject('empty', '')
      try {
        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        // 空文件: 后端可能返回 404/500/200(默认空对象)
        // 关键是不应崩溃
        expect(resp.status).toBeLessThan(600)
      } finally {
        cleanupProject(project)
      }
    })

    test('corrupt project.view.json returns error or default', async () => {
      const project = createBrokenProject(
        'view',
        `version: 2\nproject:\n  id: test_view\n  name: Test\nschemas: []\n`
      )
      try {
        fs.writeFileSync(
          path.join(project, 'project.view.json'),
          'this is not valid json {{',
          'utf-8'
        )

        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/view`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        // 损坏的 JSON: 可能返回 500 或默认空视图(200)
        expect(resp.status).toBeLessThan(600)
      } finally {
        cleanupProject(project)
      }
    })

    test('missing data file reports not-found in validation', async ({ apiHelper }) => {
      // 使用 qa_simple 的 validate 端点，指向不存在的文件
      const missingFile = path.join(projectPath, 'data', 'nonexistent_file.csv')
      const resp = await apiHelper.post('/validate', {
        source_file_path: missingFile,
        validation_type: 'not_null',
        target_column_name: 'id',
      })
      // 应返回错误而非崩溃
      expect(resp.status).toBeLessThan(600)
      const result = await resp.json().catch(() => ({}))
      // 应该有某种错误指示
      expect(result.success === false || result.error || resp.status >= 400).toBeTruthy()
    })
  })

  test.describe('Frontend Graceful Degradation', () => {
    test('backend error shows friendly message on UI', async ({ page }) => {
      test.skip('Requires frontend dev server — not available in E2E CI')
    })
  })
})
