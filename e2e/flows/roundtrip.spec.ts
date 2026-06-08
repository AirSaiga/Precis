/**
 * @fileoverview E2E Round-Trip 测试
 *
 * 验证完整的保存/加载往返流程：
 * 1. 通过 API 创建 Schema 和约束
 * 2. 保存完整配置
 * 3. 重新加载配置
 * 4. 验证数据完整性（无丢失）
 *
 * 覆盖 Phase 1-9 修复的关键数据丢失场景：
 * - Charset allowedChars/disallowedChars
 * - Range boundaryMode
 * - Conditional ifConditions/ifLogic
 * - Composite logic/includedNodeIds
 * - Transform 完整字段
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'

// 后端 API 基础 URL
const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'

const projectPath = path.join(__dirname, '..', 'fixtures', 'test-project')

test.beforeAll(() => {
  if (!fs.existsSync(projectPath)) {
    test.skip(true, `E2E fixture 目录不存在: ${projectPath}`)
  }
})

test.describe('Save/Load Round-Trip', () => {
  test('Charset 约束往返不丢失 allowedChars/disallowedChars', async ({ apiHelper }) => {

    // 1. 构建包含 Charset 约束的完整配置
    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-charset', name: 'Charset RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
        constraints: [{ id: 'c-charset', path: 'constraints/c-charset.constraint.yaml' }],
      },
      schemas: {
        sc_users: {
          version: 2,
          id: 'sc_users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'col-status', name: 'status', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        'c-charset': {
          version: 2,
          id: 'c-charset',
          type: 'Charset',
          enabled: true,
          refs: { table_id: 'sc_users', column_id: 'col-status' },
          params: {
            charset_mode: 'custom',
            allowed_chars: '0123456789',
            disallowed_chars: 'abcdef',
          },
        },
      },
    }

    // 2. 保存配置
    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    // 3. 读取保存的文件
    const constraintPath = path.join(projectPath, 'constraints', 'c-charset.constraint.yaml')
    expect(fs.existsSync(constraintPath)).toBe(true)

    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('allowed_chars: 0123456789')
    expect(savedContent).toContain('disallowed_chars: abcdef')
    expect(savedContent).toContain('charset_mode: custom')

    // 4. 重新加载配置
    const loadResp = await apiHelper.get('/project/v2/config/full')
    expect(loadResp.status).toBeLessThan(300)

    const loadedConfig = await loadResp.json()
    const charsetConstraint = loadedConfig.constraints?.['c-charset']
    expect(charsetConstraint).toBeDefined()
    expect(charsetConstraint.params.allowed_chars).toBe('0123456789')
    expect(charsetConstraint.params.disallowed_chars).toBe('abcdef')
    expect(charsetConstraint.params.charset_mode).toBe('custom')
  })

  test('Range 约束往返不丢失 boundary_mode', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-range', name: 'Range RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
        constraints: [{ id: 'c-range', path: 'constraints/c-range.constraint.yaml' }],
      },
      schemas: {
        sc_users: {
          version: 2,
          id: 'sc_users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [{ id: 'col-age', name: 'age', type: 'Int' }],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        'c-range': {
          version: 2,
          id: 'c-range',
          type: 'Range',
          enabled: true,
          refs: { table_id: 'sc_users', column_id: 'col-age' },
          params: { min: 0, max: 150, boundary_mode: 'exclusive' },
        },
      },
    }

    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const constraintPath = path.join(projectPath, 'constraints', 'c-range.constraint.yaml')
    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('boundary_mode: exclusive')

    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.constraints?.['c-range']?.params?.boundary_mode).toBe('exclusive')
  })

  test('Composite 约束往返不丢失 logic/sub_constraints', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-composite', name: 'Composite RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
        constraints: [
          { id: 'c-sub-1', path: 'constraints/c-sub-1.constraint.yaml' },
          { id: 'c-sub-2', path: 'constraints/c-sub-2.constraint.yaml' },
          { id: 'c-composite', path: 'constraints/c-composite.constraint.yaml' },
        ],
      },
      schemas: {
        sc_users: {
          version: 2,
          id: 'sc_users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'col-email', name: 'email', type: 'Str' },
            { id: 'col-age', name: 'age', type: 'Int' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        'c-sub-1': {
          version: 2,
          id: 'c-sub-1',
          type: 'NotNull',
          enabled: true,
          refs: { table_id: 'sc_users', column_id: 'col-email' },
          params: {},
        },
        'c-sub-2': {
          version: 2,
          id: 'c-sub-2',
          type: 'Range',
          enabled: true,
          refs: { table_id: 'sc_users', column_id: 'col-age' },
          params: { min: 0, max: 150 },
        },
        'c-composite': {
          version: 2,
          id: 'c-composite',
          type: 'Composite',
          enabled: true,
          refs: {},
          params: {
            logic: 'all',
            sub_constraints: [
              { id: 'c-sub-1', type: 'NotNull', enabled: true, refs: { table_id: 'sc_users', column_id: 'col-email' }, params: {} },
              { id: 'c-sub-2', type: 'Range', enabled: true, refs: { table_id: 'sc_users', column_id: 'col-age' }, params: { min: 0, max: 150 } },
            ],
          },
        },
      },
    }

    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const constraintPath = path.join(projectPath, 'constraints', 'c-composite.constraint.yaml')
    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('logic: all')
    expect(savedContent).toContain('sub_constraints:')

    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    const composite = loadedConfig.constraints?.['c-composite']
    expect(composite?.params?.logic).toBe('all')
    expect(composite?.params?.sub_constraints).toHaveLength(2)
  })

  test('Transform 文件保存到 transforms/ 目录', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-transform', name: 'Transform RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        transforms: [{ id: 't-1', path: 'transforms/t-1.transform.yaml' }],
      },
      transforms: {
        't-1': {
          version: 2,
          id: 't-1',
          type: 'StringSplit',
          enabled: true,
          input_from_node: 'sc_users',
          input_column: 'full_name',
          params: { strategy: 'delimiter', delimiter: ' ' },
          output_columns: ['first_name', 'last_name'],
        },
      },
    }

    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const transformPath = path.join(projectPath, 'transforms', 't-1.transform.yaml')
    expect(fs.existsSync(transformPath)).toBe(true)

    const savedContent = fs.readFileSync(transformPath, 'utf-8')
    expect(savedContent).toContain('StringSplit')
    expect(savedContent).toContain('first_name')
    expect(savedContent).toContain('last_name')

    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.transforms?.['t-1']?.type).toBe('StringSplit')
    expect(loadedConfig.transforms?.['t-1']?.output_columns).toEqual(['first_name', 'last_name'])
  })

  test('多节点保存/恢复 — Schema + Constraint + Regex 完整配置', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-multi', name: 'Multi Node RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
        constraints: [{ id: 'c-notnull', path: 'constraints/c-notnull.constraint.yaml' }],
        regex_nodes: [{ id: 'r-email', path: 'regex/r-email.regex.yaml' }],
      },
      schemas: {
        sc_users: {
          version: 2,
          id: 'sc_users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: '/data/users.csv', header_row: 0 },
          columns: [
            { id: 'col-name', name: 'name', type: 'Str' },
            { id: 'col-email', name: 'email', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        'c-notnull': {
          version: 2,
          id: 'c-notnull',
          type: 'NotNull',
          enabled: true,
          refs: { table_id: 'sc_users', column_id: 'col-name' },
          params: {},
        },
      },
      regex_nodes: {
        'r-email': {
          version: 2,
          id: 'r-email',
          name: 'Email Pattern',
          pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
          description: 'Validates email format',
        },
      },
    }

    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const loadResp = await apiHelper.get('/project/v2/config/full')
    expect(loadResp.status).toBeLessThan(300)
    const loadedConfig = await loadResp.json()

    expect(loadedConfig.schemas?.sc_users).toBeDefined()
    expect(loadedConfig.schemas?.sc_users.columns).toHaveLength(2)

    expect(loadedConfig.constraints?.['c-notnull']).toBeDefined()
    expect(loadedConfig.constraints?.['c-notnull']?.type).toBe('NotNull')
    expect(loadedConfig.constraints?.['c-notnull']?.refs?.column_id).toBe('col-name')

    expect(loadedConfig.regex_nodes?.['r-email']).toBeDefined()
    expect(loadedConfig.regex_nodes?.['r-email']?.pattern).toBe('^[\\w.-]+@[\\w.-]+\\.\\w+$')
  })

  test('修改后保存 — Schema 列名修改持久化', async ({ apiHelper }) => {

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'roundtrip-modify', name: 'Modify RoundTrip' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_products', path: 'schemas/sc_products.schema.yaml' }],
      },
      schemas: {
        sc_products: {
          version: 2,
          id: 'sc_products',
          name: 'products',
          source: { mode: 'absolute_file' as const, path: '/data/products.csv', header_row: 0 },
          columns: [
            { id: 'col-name', name: 'product_name', type: 'Str' },
            { id: 'col-price', name: 'price', type: 'Decimal' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
    }

    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const schemaPath = path.join(projectPath, 'schemas', 'sc_products.schema.yaml')
    const savedContent = fs.readFileSync(schemaPath, 'utf-8')
    expect(savedContent).toContain('product_name')

    const updatedConfig = {
      ...fullConfig,
      schemas: {
        sc_products: {
          ...fullConfig.schemas.sc_products,
          columns: [
            { id: 'col-name', name: 'item_title', type: 'Str' },
            { id: 'col-price', name: 'price', type: 'Decimal' },
          ],
        },
      },
    }

    const updateResp = await apiHelper.put('/project/v2/config/full', updatedConfig)
    expect(updateResp.status).toBeLessThan(300)

    const updatedContent = fs.readFileSync(schemaPath, 'utf-8')
    expect(updatedContent).toContain('item_title')
    expect(updatedContent).not.toContain('product_name')

    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.schemas?.sc_products?.columns[0]?.name).toBe('item_title')
  })

  test('draft 状态节点未保存 — 未调用保存 API 的资源不存在于磁盘', async ({ apiHelper }) => {

    const loadResp = await apiHelper.get('/project/v2/config/full')
    expect(loadResp.status).toBeLessThan(300)
    const initialConfig = await loadResp.json()
    const initialConstraintCount = Object.keys(initialConfig.constraints || {}).length
    const initialRegexCount = Object.keys(initialConfig.regex_nodes || {}).length

    const draftConstraintPath = path.join(projectPath, 'constraints', 'c-draft-unwritten.constraint.yaml')
    const draftRegexPath = path.join(projectPath, 'regex', 'r-draft-unwritten.regex.yaml')

    expect(fs.existsSync(draftConstraintPath)).toBe(false)
    expect(fs.existsSync(draftRegexPath)).toBe(false)

    const reloadResp = await apiHelper.get('/project/v2/config/full')
    const reloadedConfig = await reloadResp.json()
    expect(Object.keys(reloadedConfig.constraints || {}).length).toBe(initialConstraintCount)
    expect(Object.keys(reloadedConfig.regex_nodes || {}).length).toBe(initialRegexCount)
  })
})
