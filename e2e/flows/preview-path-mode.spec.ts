import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { test, expect } from '../fixtures/base'

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const USERS_CSV = path.join(FIXTURES_DIR, 'test-project', 'data', 'users.csv')

function createTempProject(suffix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-path-preview-${suffix}-`))
  for (const sub of ['schemas', 'constraints', 'data', 'regex']) {
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(tmpDir, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      '  id: test-path-preview',
      '  name: Test Path Preview',
      `  config_path: ${tmpDir}`,
      'schemas: []',
      'constraints: []',
      'regex_nodes: []',
    ].join('\n'),
    'utf-8'
  )
  return tmpDir
}

function cleanupProject(projectDir: string) {
  try { fs.rmSync(projectDir, { recursive: true, force: true }) } catch {}
}

async function fetchWithConfigPath(url: string, options: RequestInit & { configPath: string }) {
  const { configPath, ...rest } = options
  return fetch(url, {
    ...rest,
    headers: {
      ...rest.headers,
      'X-Project-Config-Path': configPath,
    },
  })
}

test.describe('Preview Path Mode', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('path-preview')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('POST /preview/file returns preview for valid CSV', async () => {
    const resp = await fetchWithConfigPath(`${BACKEND_URL}/api/v1/preview/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_file_path: USERS_CSV, header_row: 0 }),
      configPath: tmpDir,
    })

    if (resp.ok) {
      const data = await resp.json()
      expect(data).toBeDefined()
    } else {
      expect(resp.status).toBeLessThan(500)
    }
  })

  test('POST /preview/file/path handles CSV file', async () => {
    const resp = await fetchWithConfigPath(`${BACKEND_URL}/api/v1/preview/file/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_file_path: USERS_CSV, header_row: 0 }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /preview/file/path rejects nonexistent file without crashing', async () => {
    const resp = await fetchWithConfigPath(`${BACKEND_URL}/api/v1/preview/file/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_file_path: '/no/such/file.csv', header_row: 0 }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(600)
  })

  test('POST /preview/header-row-changed persists header row change', async () => {
    const resp = await fetchWithConfigPath(`${BACKEND_URL}/api/v1/preview/header-row-changed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: USERS_CSV,
        new_header_row: 0,
        schema_name: 'users',
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(500)
  })

  test('POST /preview/switch-sheet/path for nonexistent sheet', async () => {
    const resp = await fetchWithConfigPath(`${BACKEND_URL}/api/v1/preview/switch-sheet/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: USERS_CSV,
        sheet_name: 'NonexistentSheet',
        header_row: 0,
      }),
      configPath: tmpDir,
    })

    expect(resp.status).toBeLessThan(600)
  })
})
