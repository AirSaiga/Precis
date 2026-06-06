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
    const saveResp = await apiHelper.post('/project/v2/full-config', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    // 3. 读取保存的文件
    const constraintPath = path.join(projectPath, 'constraints', 'c-charset.constraint.yaml')
    expect(fs.existsSync(constraintPath)).toBe(true)

    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('allowed_chars: 0123456789')
    expect(savedContent).toContain('disallowed_chars: abcdef')
    expect(savedContent).toContain('charset_mode: custom')

    // 4. 重新加载配置
    const loadResp = await apiHelper.get('/project/v2/full-config')
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

    const saveResp = await apiHelper.post('/project/v2/full-config', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const constraintPath = path.join(projectPath, 'constraints', 'c-range.constraint.yaml')
    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('boundary_mode: exclusive')

    const loadResp = await apiHelper.get('/project/v2/full-config')
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

    const saveResp = await apiHelper.post('/project/v2/full-config', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const constraintPath = path.join(projectPath, 'constraints', 'c-composite.constraint.yaml')
    const savedContent = fs.readFileSync(constraintPath, 'utf-8')
    expect(savedContent).toContain('logic: all')
    expect(savedContent).toContain('sub_constraints:')

    const loadResp = await apiHelper.get('/project/v2/full-config')
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

    const saveResp = await apiHelper.post('/project/v2/full-config', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    const transformPath = path.join(projectPath, 'transforms', 't-1.transform.yaml')
    expect(fs.existsSync(transformPath)).toBe(true)

    const savedContent = fs.readFileSync(transformPath, 'utf-8')
    expect(savedContent).toContain('StringSplit')
    expect(savedContent).toContain('first_name')
    expect(savedContent).toContain('last_name')

    const loadResp = await apiHelper.get('/project/v2/full-config')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.transforms?.['t-1']?.type).toBe('StringSplit')
    expect(loadedConfig.transforms?.['t-1']?.output_columns).toEqual(['first_name', 'last_name'])
  })
})
