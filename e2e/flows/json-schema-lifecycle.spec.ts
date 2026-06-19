/**
 * @fileoverview JsonSchema 生命周期 E2E 测试
 *
 * 覆盖 JSON Schema 节点核心数据流：
 * 1. 创建临时项目并写入嵌套 JSON 数据
 * 2. 通过全量配置 API 保存带嵌套列的 JsonSchema
 * 3. 加载配置验证嵌套结构与约束持久化
 * 4. 预览 JSON 数据（支持 json_path / record_path）
 * 5. 对嵌套列执行 NotNull 校验（透传 JSON 解析参数）
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { test, expect } from '../fixtures/base'
import { BACKEND_URL } from '../config'

function createTempProject(suffix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-json-schema-${suffix}-`))
  for (const sub of ['schemas', 'constraints', 'data', 'regex']) {
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(tmpDir, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      '  id: test-json-schema',
      '  name: Test JSON Schema',
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

test.describe('JsonSchema Lifecycle', () => {
  let tmpDir: string
  let jsonDataPath: string

  const schemaId = 'inventory_json'
  const constraintId = 'c_notnull_profile_name'

  test.beforeAll(() => {
    tmpDir = createTempProject('lifecycle')

    // 写入带嵌套对象和数组的 JSON 数据文件
    jsonDataPath = path.join(tmpDir, 'data', 'inventory.json')
    fs.writeFileSync(
      jsonDataPath,
      JSON.stringify({
        warehouse: 'A1',
        items: [
          { id: 1, profile: { name: 'Alice', age: 30 }, tags: ['new'] },
          { id: 2, profile: { name: 'Bob', age: 25 }, tags: ['used'] },
          { id: 3, profile: { name: null, age: 28 }, tags: ['new'] },
        ],
      }),
      'utf-8'
    )
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('保存并加载带嵌套列的 JSON Schema', async () => {
    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'test-json-schema', name: 'Test JSON Schema' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: schemaId, path: `schemas/${schemaId}.schema.yaml` }],
        constraints: [{ id: constraintId, path: `constraints/${constraintId}.constraint.yaml` }],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Inventory JSON',
          source: { mode: 'absolute_file' as const, path: jsonDataPath, header_row: 0 },
          columns: [
            {
              id: 'col-id',
              name: 'id',
              type: 'Int',
              json_path: '$.id',
            },
            {
              id: 'col-profile',
              name: 'profile',
              type: 'JsonObject',
              json_path: '$.profile',
              children: [
                {
                  id: 'col-profile-name',
                  name: 'name',
                  type: 'Str',
                  json_path: '$.profile.name',
                },
                {
                  id: 'col-profile-age',
                  name: 'age',
                  type: 'Int',
                  json_path: '$.profile.age',
                },
              ],
            },
            {
              id: 'col-tags',
              name: 'tags',
              type: 'JsonArray',
              json_path: '$.tags',
            },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        [constraintId]: {
          version: 2,
          id: constraintId,
          type: 'NotNull',
          enabled: true,
          refs: { table_id: schemaId, column_id: 'col-profile-name' },
          params: {},
        },
      },
    }

    const saveResp = await fetchWithConfigPath(`${BACKEND_URL}/api/latest/project/config/full`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullConfig),
      configPath: tmpDir,
    })
    expect(saveResp.status).toBeLessThan(300)

    const loadResp = await fetchWithConfigPath(`${BACKEND_URL}/api/latest/project/config/full`, {
      method: 'GET',
      configPath: tmpDir,
    })
    expect(loadResp.ok).toBe(true)
    const loaded = await loadResp.json()

    const schema = loaded.schemas?.[schemaId]
    expect(schema).toBeDefined()
    expect(schema.name).toBe('Inventory JSON')
    expect(schema.columns).toHaveLength(3)

    const profileColumn = schema.columns.find((c: { id: string }) => c.id === 'col-profile')
    expect(profileColumn).toBeDefined()
    expect(profileColumn.children).toHaveLength(2)
    expect(profileColumn.children.map((c: { name: string }) => c.name)).toContain('name')

    const constraint = loaded.constraints?.[constraintId]
    expect(constraint).toBeDefined()
    expect(constraint.type).toBe('NotNull')
    expect(constraint.refs.column_id).toBe('col-profile-name')
  })

  test('预览 JSON 数据支持 json_path', async () => {
    const previewResp = await fetchWithConfigPath(`${BACKEND_URL}/api/latest/preview/file/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: jsonDataPath,
        json_path: '$.items',
        json_format: 'array',
      }),
      configPath: tmpDir,
    })

    expect(previewResp.ok).toBe(true)
    const previewData = await previewResp.json()
    expect(previewData.success).toBe(true)
    expect(previewData.file_type).toBe('json')
    expect(previewData.raw_data).toBeDefined()
    expect(previewData.raw_data.length).toBe(3)

    const firstItem = previewData.raw_data[0]
    expect(firstItem.profile).toBeDefined()
    expect(firstItem.profile.name).toBe('Alice')
  })

  test('对嵌套列执行 NotNull 校验并透传 JSON 解析参数', async () => {
    const validateResp = await fetchWithConfigPath(`${BACKEND_URL}/api/latest/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: jsonDataPath,
        validation_type: 'not_null',
        target_column_name: 'profile.name',
        json_path: '$.items',
        json_format: 'array',
      }),
      configPath: tmpDir,
    })

    expect(validateResp.ok).toBe(true)
    const result = await validateResp.json()
    expect(result.success).toBe(true)
    expect(result.data.is_valid).toBe(false)
    expect(result.data.error_count).toBe(1)
    expect(result.data.total_rows).toBe(3)

    expect(result.data.error_rows.length).toBe(1)
    expect(result.data.error_rows[0].row_index).toBe(2)
  })
})
