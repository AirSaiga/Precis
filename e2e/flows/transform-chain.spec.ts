/**
 * @fileoverview E2E Transform 链端到端测试
 *
 * 验证 Transform 节点的完整生命周期：
 * 1. 创建 Transform 并连接到 Schema
 * 2. 保存/加载配置 roundtrip
 * 3. 配合 NotNull 约束完成数据校验链路
 */

import { test, expect, QA_SIMPLE_SOURCE } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'

test.beforeAll(() => {
  if (!fs.existsSync(QA_SIMPLE_SOURCE)) {
    test.skip(true, `E2E fixture 目录不存在: ${QA_SIMPLE_SOURCE}`)
  }
})

function buildBaseManifest(projectId: string, projectName: string, extras: Record<string, unknown> = {}) {
  return {
    version: 2,
    project: { id: projectId, name: projectName },
    settings: {
      validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
      file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
      script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
    },
    ...extras,
  }
}

test.describe('Transform Chain E2E', () => {
  test('创建 StringSplit Transform 并保存到 transforms/ 目录', async ({ apiHelper, isolatedProjectPath }) => {
    const projectPath = isolatedProjectPath

    const fullConfig = {
      manifest: buildBaseManifest('transform-split', 'Transform Split', {
        schemas: [{ id: 'users', path: 'schemas/users.schema.yaml' }],
        transforms: [{ id: 't-split-name', path: 'transforms/t-split-name.transform.yaml' }],
      }),
      schemas: {
        users: {
          version: 2,
          id: 'users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'id', name: 'id', type: 'Int' },
            { id: 'name', name: 'name', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      transforms: {
        't-split-name': {
          version: 2,
          id: 't-split-name',
          type: 'StringSplit',
          enabled: true,
          input_from_node: 'users',
          input_column: 'name',
          params: { strategy: 'delimiter', delimiter: ' ' },
          output_columns: ['first_name', 'last_name'],
        },
      },
    }

    const saveResp = await apiHelper.put('/project/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const transformPath = path.join(projectPath, 'transforms', 't-split-name.transform.yaml')
    expect(fs.existsSync(transformPath)).toBe(true)

    const savedContent = fs.readFileSync(transformPath, 'utf-8')
    expect(savedContent).toContain('StringSplit')
    expect(savedContent).toContain('delimiter')
    expect(savedContent).toContain('first_name')
    expect(savedContent).toContain('last_name')
    expect(savedContent).toContain('input_from_node')
    expect(savedContent).toContain('users')
  })

  test('Schema → Transform 保存/加载 roundtrip 保留完整字段', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: buildBaseManifest('transform-roundtrip', 'Transform RoundTrip', {
        schemas: [{ id: 'users', path: 'schemas/users.schema.yaml' }],
        transforms: [{ id: 't-regex-extract', path: 'transforms/t-regex-extract.transform.yaml' }],
      }),
      schemas: {
        users: {
          version: 2,
          id: 'users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'email', name: 'email', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      transforms: {
        't-regex-extract': {
          version: 2,
          id: 't-regex-extract',
          type: 'RegexExtract',
          enabled: true,
          input_from_node: 'users',
          input_column: 'email',
          params: { pattern: '^(.+)@(.+)$', group_names: ['user', 'domain'] },
          output_columns: ['user', 'domain'],
        },
      },
    }

    const saveResp = await apiHelper.put('/project/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const loadResp = await apiHelper.get('/project/config/full')
    expect(loadResp.status).toBeLessThan(300)
    const loaded = await loadResp.json()

    const transform = loaded.transforms?.['t-regex-extract']
    expect(transform).toBeDefined()
    expect(transform.type).toBe('RegexExtract')
    expect(transform.input_from_node).toBe('users')
    expect(transform.input_column).toBe('email')
    expect(transform.params.pattern).toBe('^(.+)@(.+)$')
    expect(transform.output_columns).toEqual(['user', 'domain'])
    expect(transform.enabled).toBe(true)
  })

  test('Schema → Transform → Constraint 完整校验链路', async ({ apiHelper, isolatedProjectPath }) => {
    const projectPath = isolatedProjectPath

    const fullConfig = {
      manifest: buildBaseManifest('transform-validate', 'Transform Validate', {
        schemas: [{ id: 'users', path: 'schemas/users.schema.yaml' }],
        transforms: [{ id: 't-strip', path: 'transforms/t-strip.transform.yaml' }],
        constraints: [{ id: 'c-notnull-name', path: 'constraints/c-notnull-name.constraint.yaml' }],
      }),
      schemas: {
        users: {
          version: 2,
          id: 'users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'name', name: 'name', type: 'Str' },
            { id: 'email', name: 'email', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      transforms: {
        't-strip': {
          version: 2,
          id: 't-strip',
          type: 'Strip',
          enabled: true,
          input_from_node: 'users',
          input_column: 'name',
          params: {},
          output_columns: ['name_stripped'],
        },
      },
      constraints: {
        'c-notnull-name': {
          version: 2,
          id: 'c-notnull-name',
          type: 'NotNull',
          enabled: true,
          refs: { table_id: 'users', column_id: 'name' },
          params: {},
        },
      },
    }

    const saveResp = await apiHelper.put('/project/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const loadResp = await apiHelper.get('/project/config/full')
    expect(loadResp.status).toBeLessThan(300)
    const loaded = await loadResp.json()

    expect(loaded.schemas?.users).toBeDefined()
    expect(loaded.transforms?.['t-strip']).toBeDefined()
    expect(loaded.constraints?.['c-notnull-name']).toBeDefined()
    expect(loaded.constraints?.['c-notnull-name']?.refs?.table_id).toBe('users')
    expect(loaded.constraints?.['c-notnull-name']?.refs?.column_id).toBe('name')

    const constraintPath = path.join(projectPath, 'constraints', 'c-notnull-name.constraint.yaml')
    expect(fs.existsSync(constraintPath)).toBe(true)
    const constraintContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(constraintContent).toContain('NotNull')
  })
})
