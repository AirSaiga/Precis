/**
 * @fileoverview unique 校验器单元测试
 *
 * 验证服务层纯函数 validateUnique：
 * - 成功响应且存在重复值时返回 error 详情
 * - 成功响应且无重复值时返回零错误
 * - API 失败时抛出异常
 */

import { describe, it, expect, vi } from 'vitest'
import { validateUnique } from '@/services/constraints/validators/unique'
import { validateUnique as apiValidateUnique } from '@/api/validationApi'

vi.mock('@/api/validationApi', () => ({
  validateUnique: vi.fn(),
}))

vi.spyOn(console, 'error').mockImplementation(() => {})

describe('unique validator', () => {
  it('将文件路径和列名转换为后端请求并返回格式化结果', async () => {
    vi.mocked(apiValidateUnique).mockResolvedValue({
      success: true,
      validation_type: 'unique',
      data: {
        is_valid: false,
        error_count: 1,
        total_rows: 10,
        match_count: 9,
        error_rows: [{ row_index: 5, cell_value: 'dup@example.com', duplicate_count: 2 }],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    })

    const result = await validateUnique('/data/users.csv', 'email', 'Sheet1', 1, {
      columnDataType: 'String',
      jsonFormat: 'array',
    })

    expect(apiValidateUnique).toHaveBeenCalledWith({
      validation_type: 'unique',
      target_column_name: 'email',
      source_file_path: '/data/users.csv',
      sheet_name: 'Sheet1',
      header_row: 1,
      column_data_type: 'String',
      json_path: undefined,
      json_format: 'array',
      record_path: undefined,
    })

    expect(result.errorCount).toBe(1)
    expect(result.totalRows).toBe(10)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      row: 5,
      value: 'dup@example.com',
      message: '值必须唯一',
    })
  })

  it('无重复值时返回零错误', async () => {
    vi.mocked(apiValidateUnique).mockResolvedValue({
      success: true,
      validation_type: 'unique',
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

    const result = await validateUnique('/data/users.csv', 'id')
    expect(result.errorCount).toBe(0)
    expect(result.totalRows).toBe(5)
    expect(result.errors).toEqual([])
  })

  it('API 返回 success=false 时返回零错误（不抛异常）', async () => {
    vi.mocked(apiValidateUnique).mockResolvedValue({
      success: false,
      validation_type: 'unique',
      data: null,
      error: 'network error',
    })

    const result = await validateUnique('/data/users.csv', 'id')
    expect(result.errorCount).toBe(0)
    expect(result.totalRows).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('API 抛异常时向上抛出', async () => {
    vi.mocked(apiValidateUnique).mockRejectedValue(new Error('backend down'))
    await expect(validateUnique('/data/users.csv', 'id')).rejects.toThrow('backend down')
  })
})
