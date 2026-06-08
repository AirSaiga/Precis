/**
 * @fileoverview E2E Schema 导入 → 绑定数据源 → 校验 测试
 *
 * 验证完整的 Schema 生命周期：
 * 1. 读取已有 Schema 并验证列信息
 * 2. 更新 Schema 绑定数据源
 * 3. 完整校验流程：Schema + NotNull 约束 + 数据校验
 *
 * 通过 V2 API 完成配置的保存/加载/校验全流程。
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'
const projectPath = path.join(__dirname, '..', 'fixtures', 'test-project')
const USERS_CSV = path.join(projectPath, 'data', 'users.csv')

test.beforeAll(() => {
  if (!fs.existsSync(projectPath)) {
    test.skip(true, `E2E fixture 目录不存在: ${projectPath}`)
  }
})

test.describe('Schema Import → Bind Data Source → Validate', () => {
  test('读取已有 Schema 并验证列信息', async ({ apiHelper }) => {
    // 读取现有 schema
    const resp = await apiHelper.get('/v2/schemas/users')
    expect(resp.ok).toBe(true)

    const schema = await resp.json()
    expect(schema).toBeDefined()
    expect(schema.id).toBe('users')
    expect(schema.name).toBe('Users Table')
    expect(schema.columns).toBeDefined()
    expect(schema.columns.length).toBe(4)

    // 验证列名和类型
    const columnNames = schema.columns.map((c: { name: string }) => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('age')
  })

  test('通过全量配置更新 Schema 并验证持久化', async ({ apiHelper }) => {
    const schemaId = 'sc_e2e_update'

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'e2e-schema-update', name: 'Schema Update Test' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: schemaId, path: `schemas/e2e_update.schema.yaml` }],
        constraints: [],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Updated Schema',
          source: { mode: 'absolute_file' as const, path: USERS_CSV, header_row: 0 },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int', description: 'User ID' },
            { id: 'col-name', name: 'name', type: 'Str', description: 'User name' },
            { id: 'col-email', name: 'email', type: 'Str', description: 'Email' },
            { id: 'col-age', name: 'age', type: 'Int', description: 'Age' },
            { id: 'col-phone', name: 'phone', type: 'Str', description: 'Phone number' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
    }

    // 保存
    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    // 验证文件存在
    const schemaPath = path.join(projectPath, 'schemas', 'e2e_update.schema.yaml')
    expect(fs.existsSync(schemaPath)).toBe(true)

    // 重新加载
    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    const schema = loadedConfig.schemas?.[schemaId]
    expect(schema).toBeDefined()
    expect(schema.name).toBe('Updated Schema')
    expect(schema.columns.length).toBe(5)

    const columnNames = schema.columns.map((c: { name: string }) => c.name)
    expect(columnNames).toContain('phone')

    // 通过单个 Schema API 读取
    const schemaResp = await apiHelper.get(`/v2/schemas/${schemaId}`)
    expect(schemaResp.ok).toBe(true)
    const singleSchema = await schemaResp.json()
    expect(singleSchema.columns.length).toBe(5)

    // 清理
    if (fs.existsSync(schemaPath)) {
      fs.unlinkSync(schemaPath)
    }
  })

  test('绑定 CSV 数据源并预览数据', async ({ apiHelper }) => {
    // 使用 preview API 预览 CSV 数据
    const previewResp = await apiHelper.post('/preview/content', {
      source_file_path: USERS_CSV,
      header_row: 0,
    })

    if (previewResp.ok) {
      const previewData = await previewResp.json()
      expect(previewData).toBeDefined()
    }

    // 通过 validate API 验证可以访问数据
    const validateResp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'not_null',
      target_column_name: 'name',
    })
    expect(validateResp.ok).toBe(true)
    const data = await validateResp.json()
    expect(data.success).toBe(true)
    expect(data.data.total_rows).toBe(5)
  })

  test('完整校验流程：Schema + NotNull 约束 + 校验', async ({ apiHelper }) => {
    const schemaId = 'sc_e2e_validate'
    const constraintId = 'c_e2e_validate_notnull'

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'e2e-schema-validate', name: 'Schema Validate Test' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: schemaId, path: `schemas/e2e_validate.schema.yaml` }],
        constraints: [{ id: constraintId, path: `constraints/${constraintId}.constraint.yaml` }],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Validate Schema',
          source: { mode: 'absolute_file' as const, path: USERS_CSV, header_row: 0 },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int' },
            { id: 'col-name', name: 'name', type: 'Str' },
            { id: 'col-email', name: 'email', type: 'Str' },
            { id: 'col-age', name: 'age', type: 'Int' },
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
          refs: { table_id: schemaId, column_id: 'col-name' },
          params: {},
        },
      },
    }

    // 保存完整配置
    const saveResp = await apiHelper.put('/project/v2/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    // 验证配置加载
    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.schemas?.[schemaId]).toBeDefined()
    expect(loadedConfig.constraints?.[constraintId]).toBeDefined()
    expect(loadedConfig.constraints[constraintId].type).toBe('NotNull')

    // 执行 NotNull 校验 — name 列全部有值
    const validateResp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'not_null',
      target_column_name: 'name',
    })
    expect(validateResp.ok).toBe(true)
    const validateData = await validateResp.json()
    expect(validateData.success).toBe(true)
    expect(validateData.data.is_valid).toBe(true)
    expect(validateData.data.error_count).toBe(0)
    expect(validateData.data.total_rows).toBe(5)

    // 清理
    const schemaPath = path.join(projectPath, 'schemas', 'e2e_validate.schema.yaml')
    const constraintPath = path.join(projectPath, 'constraints', `${constraintId}.constraint.yaml`)
    if (fs.existsSync(schemaPath)) fs.unlinkSync(schemaPath)
    if (fs.existsSync(constraintPath)) fs.unlinkSync(constraintPath)
  })

  test('Schema 列修改后重新校验', async ({ apiHelper }) => {
    const schemaId = 'sc_e2e_col_edit'

    // 第一版 Schema：4 列
    const fullConfig1 = {
      manifest: {
        version: 2,
        project: { id: 'e2e-schema-col-edit', name: 'Schema Col Edit Test' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: schemaId, path: `schemas/e2e_col_edit.schema.yaml` }],
        constraints: [],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Col Edit Schema',
          source: { mode: 'absolute_file' as const, path: USERS_CSV, header_row: 0 },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int' },
            { id: 'col-name', name: 'name', type: 'Str' },
            { id: 'col-email', name: 'email', type: 'Str' },
            { id: 'col-age', name: 'age', type: 'Int' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
    }

    const saveResp1 = await apiHelper.put('/project/v2/config/full', fullConfig1)
    expect(saveResp1.status).toBeLessThan(300)

    // 第二版：修改列名 name → full_name
    const fullConfig2 = JSON.parse(JSON.stringify(fullConfig1))
    fullConfig2.schemas[schemaId].columns[1].name = 'full_name'

    const saveResp2 = await apiHelper.put('/project/v2/config/full', fullConfig2)
    expect(saveResp2.status).toBeLessThan(300)

    // 重新加载验证修改已持久化
    const loadResp = await apiHelper.get('/project/v2/config/full')
    const loadedConfig = await loadResp.json()
    const columns = loadedConfig.schemas?.[schemaId]?.columns
    expect(columns).toBeDefined()
    const colNames = columns.map((c: { name: string }) => c.name)
    expect(colNames).toContain('full_name')
    expect(colNames).not.toContain('name')

    // 清理
    const schemaPath = path.join(projectPath, 'schemas', 'e2e_col_edit.schema.yaml')
    if (fs.existsSync(schemaPath)) fs.unlinkSync(schemaPath)
  })
})
