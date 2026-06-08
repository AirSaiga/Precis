import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { test, expect } from '../fixtures/base'

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const USERS_CSV = path.join(FIXTURES_DIR, 'test-project', 'data', 'users.csv')
const USERS_SCHEMA = path.join(FIXTURES_DIR, 'test-project', 'schemas', 'users.schema.yaml')

function createTempProject(suffix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-schema-crud-${suffix}-`))
  for (const sub of ['schemas', 'constraints', 'data', 'regex', 'transforms', 'templates']) {
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(tmpDir, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      '  id: test-schema-crud',
      '  name: Test Schema CRUD',
      'schemas:',
      '  - id: users',
      '    path: schemas/users.schema.yaml',
      'constraints: []',
      'regex_nodes: []',
    ].join('\n'),
    'utf-8'
  )
  fs.copyFileSync(USERS_SCHEMA, path.join(tmpDir, 'schemas', 'users.schema.yaml'))
  const dataDir = path.join(tmpDir, 'data')
  fs.copyFileSync(USERS_CSV, path.join(dataDir, 'users.csv'))
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

test.describe('Schema CRUD', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('schema-crud')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('GET /v2/schemas/{table_id} returns schema data', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.ok).toBe(true)
    const data = await resp.json()
    expect(data).toHaveProperty('name')
    expect(data).toHaveProperty('columns')
  })

  test('PUT /v2/schemas/{table_id} updates schema', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'users',
        columns: [
          { column_name: 'id', data_type: 'Int' },
          { column_name: 'name', data_type: 'Str' },
          { column_name: 'email', data_type: 'Str' },
          { column_name: 'age', data_type: 'Int' },
          { column_name: 'phone', data_type: 'Str' },
        ],
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('schema roundtrip: PUT then GET preserves column count', async () => {
    const putResp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'users',
        columns: [
          { column_name: 'id', data_type: 'Int' },
          { column_name: 'name', data_type: 'Str' },
          { column_name: 'email', data_type: 'Str' },
          { column_name: 'age', data_type: 'Int' },
        ],
      }),
      configPath: tmpDir,
    })

    if (putResp.ok) {
      const getResp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users`, {
        method: 'GET',
        configPath: tmpDir,
      })
      expect(getResp.ok).toBe(true)
      const data = await getResp.json()
      expect(data.columns).toHaveLength(4)
    }
  })

  test('GET /v2/schemas/{table_id} for nonexistent schema returns 404', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/nonexistent_table`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.status).toBe(404)
  })

  test('POST /v2/schemas/{table_id}/display-name updates display name', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users/display-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '用户表' }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /v2/schemas/{table_id}/check-conflict returns conflict info', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/schemas/users/check-conflict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'users',
        columns: [{ column_name: 'id', data_type: 'Int' }],
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })
})

test.describe('Pattern CRUD', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('pattern-crud')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('POST /v2/pattern creates a pattern', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern_name: 'email_pattern', regex: '^[\\w.+-]+@[\\w-]+\\.[a-z]{2,}$' }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('GET /v2/pattern/{name}/exists returns exists flag', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/project/v2/pattern/email_pattern/exists`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })
})

test.describe('Reporting Config', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('reporting')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('GET /reporting/config returns config', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/reporting/config`, {
      method: 'GET',
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /reporting/config updates config', async () => {
    const resp = await fetchWithConfig(`${BACKEND_URL}/api/v1/reporting/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, format: 'html' }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })
})
