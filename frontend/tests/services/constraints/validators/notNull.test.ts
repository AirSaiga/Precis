/**
 * @fileoverview notNull 校验器单元测试
 *
 * 验证服务层纯函数 validateNotNull：
 * - 成功响应且存在空值时返回 error 详情
 * - 成功响应且无空值时返回零错误
 * - API 失败时抛出异常
 */

import { describe, it, expect, vi } from 'vitest'
import { validateNotNull } from '@/services/constraints/validators/notNull'
import { validateNotNull as apiValidateNotNull } from '@/api/validationApi'

vi.mock('@/api/validationApi', () => ({
  validateNotNull: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('notNull validator', () => {
  it('将文件路径和列名转换为后端请求并返回格式化结果', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: true,
      validation_type: 'not_null',
      data: {
        is_valid: false,
        error_count: 2,
        total_rows: 10,
        match_count: 8,
        error_rows: [
          { row_index: 0, cell_value: '' },
          { row_index: 3, cell_value: '' },
        ],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    })

    const result = await validateNotNull('/data/users.csv', 'email', 'Sheet1', 1, {
      columnDataType: 'String',
      jsonPath: '$.users',
    })

    expect(apiValidateNotNull).toHaveBeenCalledWith({
      validation_type: 'not_null',
      target_column_name: 'email',
      source_file_path: '/data/users.csv',
      sheet_name: 'Sheet1',
      header_row: 1,
      column_data_type: 'String',
      json_path: '$.users',
      json_format: undefined,
      record_path: undefined,
    })

    expect(result.errorCount).toBe(2)
    expect(result.totalRows).toBe(10)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toEqual({ row: 0, value: '', message: '值不能为空' })
    expect(result.errors[1]).toEqual({ row: 3, value: '', message: '值不能为空' })
  })

  it('无空值时返回零错误', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: true,
      validation_type: 'not_null',
      data: {
        is_valid: true,
        error_count: 0,
        total_rows: 5,
        match_count: 5,
        error_rows: [],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    })

    const result = await validateNotNull('/data/users.csv', 'id')
    expect(result.errorCount).toBe(0)
    expect(result.totalRows).toBe(5)
    expect(result.errors).toEqual([])
  })

  it('API 返回 success=false 时返回零错误（不抛异常）', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: false,
      validation_type: 'not_null',
      data: null,
      error: 'network error',
    })

    const result = await validateNotNull('/data/users.csv', 'id')
    expect(result.errorCount).toBe(0)
    expect(result.totalRows).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('API 抛异常时向上抛出', async () => {
    vi.mocked(apiValidateNotNull).mockRejectedValue(new Error('backend down'))
    await expect(validateNotNull('/data/users.csv', 'id')).rejects.toThrow('backend down')
  })
})
