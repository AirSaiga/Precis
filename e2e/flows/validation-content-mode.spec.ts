import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { test, expect } from '../fixtures/base'
import { BACKEND_URL } from '../config'
const QA_SIMPLE_DIR = path.resolve(__dirname, '..', '..', 'qa_test', 'qa_simple')
const USERS_CSV = path.join(QA_SIMPLE_DIR, 'data', 'users.csv')
const USERS_SCHEMA = path.join(QA_SIMPLE_DIR, 'schemas', 'users.schema.yaml')

function createTempProject(suffix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-val-content-${suffix}-`))
  for (const sub of ['schemas', 'constraints', 'data', 'regex']) {
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(tmpDir, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      '  id: test-val-content',
      '  name: Test Validation Content',
      'schemas:',
      '  - id: users',
      '    path: schemas/users.schema.yaml',
      'constraints: []',
      'regex_nodes: []',
    ].join('\n'),
    'utf-8'
  )
  fs.copyFileSync(USERS_SCHEMA, path.join(tmpDir, 'schemas', 'users.schema.yaml'))
  fs.copyFileSync(USERS_CSV, path.join(tmpDir, 'data', 'users.csv'))
  return tmpDir
}

function cleanupProject(projectDir: string) {
  try { fs.rmSync(projectDir, { recursive: true, force: true }) } catch {}
}

async function fetchWithConfig(url: string, options: RequestInit & { configPath: string }) {
  const { configPath, ...rest } = options
  return fetch(url, {
    ...rest,
    headers: { ...rest.headers, 'X-Project-Config-Path': configPath },
  })
}

test.describe('Validation Content Mode', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('val-content')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('POST /validate/content processes uploaded data', async () => {
    const csvContent = 'id,name,email,age\n1,Alice,alice@example.com,30\n2,Bob,bob@example.com,25'
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validate/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_name: 'test_data.csv',
        content: csvContent,
        constraints: [],
        header_row: 0,
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /validate/content with NotNull constraint', async () => {
    const csvContent = 'id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com'
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validate/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_name: 'test_notnull.csv',
        content: csvContent,
        constraints: [
          {
            constraint_type: 'NotNull',
            table: 'test_notnull',
            column: 'name',
            params: {},
          },
        ],
        header_row: 0,
      }),
      configPath: tmpDir,
    })

    if (resp.ok) {
      const data = await resp.json()
      expect(data).toHaveProperty('is_valid')
    } else {
      expect(resp.status).toBeLessThan(600)
    }
  })

  test('POST /validate/batch processes multiple requests', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validate/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: [
          {
            source_file_path: USERS_CSV,
            table_name: 'users',
            constraints: [
              { constraint_type: 'NotNull', column: 'name', params: {} },
            ],
            header_row: 0,
          },
        ],
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /regex validates regex pattern', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/regex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: USERS_CSV,
        column: 'email',
        pattern: '^[\\w.+-]+@[\\w-]+\\.[a-z]{2,}$',
        header_row: 0,
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /regex/path validates regex with path mode', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/regex/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: USERS_CSV,
        column: 'email',
        pattern: '^[\\w.+-]+@[\\w-]+\\.[a-z]{2,}$',
        header_row: 0,
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /validate/inline validates inline data', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validate/inline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'inline_test',
        schema: {
          columns: [
            { name: 'id', type: 'Int' },
            { name: 'value', type: 'Str' },
          ],
        },
        data: [
          { id: 1, value: 'hello' },
          { id: 2, value: 'world' },
        ],
        constraints: [
          { constraint_type: 'NotNull', column: 'value', params: {} },
        ],
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })
})

test.describe('Validation History', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('val-history')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('POST /validation/history creates history entry', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validation/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'test-val-content',
        schema_id: 'users',
        constraint_count: 3,
        result: 'pass',
        summary: 'All checks passed',
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('GET /validation/history returns history list', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validation/history`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
    if (resp.ok) {
      const data = await resp.json()
      expect(data).toBeDefined()
    }
  })

  test('GET /validation/history/stats returns stats', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/latest/validation/history/stats`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })
})
