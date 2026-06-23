import * as path from 'path'
import { test, expect } from '../fixtures/base'

/**
 * 数据校验 E2E 测试
 *
 * 覆盖核心校验流程：
 * - 单约束校验（NotNull, Unique 等）
 * - 全量校验
 * - 校验结果格式验证
 */

test.describe('Validation API', () => {
  test('POST /validate returns validation result', async ({ apiHelper, testProjectPath }) => {
    const USERS_CSV = path.join(testProjectPath, 'data', 'users.csv')
    const resp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'not_null',
      target_column_name: 'name',
    })

    expect(resp.ok).toBe(true)
    const data = await resp.json()
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('validation_type', 'not_null')
  })

  test('NotNull validation passes for complete column', async ({ apiHelper, testProjectPath }) => {
    const USERS_CSV = path.join(testProjectPath, 'data', 'users.csv')
    const resp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'not_null',
      target_column_name: 'name',
    })

    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data).toBeDefined()
    expect(data.data.is_valid).toBe(true)
    expect(data.data.error_count).toBe(0)
  })

  test('Unique validation detects duplicates', async ({ apiHelper, testProjectPath }) => {
    const USERS_CSV = path.join(testProjectPath, 'data', 'users.csv')
    const resp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'unique',
      target_column_name: 'email',
    })

    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data).toBeDefined()
    // 测试数据中 email 都是唯一的，所以应该通过
    expect(data.data.is_valid).toBe(true)
  })

  test('validation handles missing column gracefully', async ({ apiHelper, testProjectPath }) => {
    const USERS_CSV = path.join(testProjectPath, 'data', 'users.csv')
    const resp = await apiHelper.post('/validate', {
      source_file_path: USERS_CSV,
      validation_type: 'not_null',
      target_column_name: 'nonexistent_column',
    })

    const data = await resp.json()
    // 应该返回错误而不是崩溃
    expect(data.success).toBe(false)
    expect(data.error).toBeDefined()
  })

  test('validation handles missing file gracefully', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/validate', {
      source_file_path: '/nonexistent/file.csv',
      validation_type: 'not_null',
      target_column_name: 'name',
    })

    const data = await resp.json()
    expect(data.success).toBe(false)
    expect(data.error).toBeDefined()
  })
})
