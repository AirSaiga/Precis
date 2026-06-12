import { describe, it, expect } from 'vitest'
import {
  normalizeValidationStage,
  getValidationStageLabelKey,
  truncateLongIds,
  formatValidationReportMessage,
  createValidationReportViewModel,
} from '@/services/validationReportViewModel'

describe('normalizeValidationStage', () => {
  it('已知阶段转为小写', () => {
    expect(normalizeValidationStage('PREFLIGHT')).toBe('preflight')
    expect(normalizeValidationStage('Loading')).toBe('loading')
    expect(normalizeValidationStage('FORMAT')).toBe('format')
    expect(normalizeValidationStage('Constraint')).toBe('constraint')
  })

  it('null/undefined 默认返回 constraint', () => {
    expect(normalizeValidationStage(null)).toBe('constraint')
    expect(normalizeValidationStage(undefined)).toBe('constraint')
  })

  it('空字符串返回 constraint', () => {
    expect(normalizeValidationStage('')).toBe('constraint')
  })
})

describe('getValidationStageLabelKey', () => {
  it('preflight 阶段', () => {
    expect(getValidationStageLabelKey('preflight')).toContain('preflight')
  })

  it('loading 阶段', () => {
    expect(getValidationStageLabelKey('loading')).toContain('loading')
  })

  it('format 阶段', () => {
    expect(getValidationStageLabelKey('format')).toContain('format')
  })

  it('constraint 阶段', () => {
    expect(getValidationStageLabelKey('constraint')).toContain('constraint')
  })

  it('regex 阶段', () => {
    expect(getValidationStageLabelKey('regex')).toContain('regex')
  })

  it('未知阶段返回默认 key', () => {
    const result = getValidationStageLabelKey('unknown')
    expect(result).toBeTruthy()
  })
})

describe('truncateLongIds', () => {
  it('短 ID 不截断', () => {
    expect(truncateLongIds('sc_abc123')).toBe('sc_abc123')
  })

  it('超长 sc_ 前缀 ID 截断', () => {
    const long = 'sc_' + 'A'.repeat(30)
    const result = truncateLongIds(long)
    expect(result).toContain('...')
    expect(result.length).toBeLessThan(long.length)
  })

  it('多个长 ID 都截断', () => {
    const msg = 'Error: c_' + 'B'.repeat(25) + ' and fk_' + 'C'.repeat(25)
    const result = truncateLongIds(msg)
    expect(result).toContain('...')
    expect(result.length).toBeLessThan(msg.length)
  })

  it('无 ID 的消息原样返回', () => {
    const msg = 'Simple error message without any IDs'
    expect(truncateLongIds(msg)).toBe(msg)
  })
})

describe('formatValidationReportMessage', () => {
  it('空消息返回占位符', () => {
    expect(formatValidationReportMessage('')).toBe('-')
  })

  it('普通消息原样返回', () => {
    expect(formatValidationReportMessage('Validation failed')).toBe('Validation failed')
  })

  it('去除表格前缀', () => {
    expect(formatValidationReportMessage("表 'users' 列 'email' 校验失败", 'users')).toBe(
      "列 'email' 校验失败"
    )
  })
})

describe('createValidationReportViewModel', () => {
  const defaultOptions = { rowLabel: 'Row' }

  it('null 输入返回空结构', () => {
    const vm = createValidationReportViewModel(null, defaultOptions)
    expect(vm.errors).toEqual([])
    expect(vm.passedItems).toEqual([])
    expect(vm.allCount).toBe(0)
    expect(vm.failedCount).toBe(0)
    expect(vm.passedCount).toBe(0)
  })

  it('包含错误的响应返回错误行', () => {
    const data: any = {
      success: false,
      summary: {
        files_total: 1,
        files_loaded: 1,
        tables_loaded: 1,
        loading_error_count: 0,
        format_error_count: 0,
        constraint_error_count: 1,
        total_error_count: 1,
        duration_ms: 100,
      },
      errors: [
        {
          stage: 'constraint',
          error_type: 'not_null',
          check_type: 'NotNull',
          message: "表 'users' 列 'name' 不能为空",
          table: 'users',
          column: 'name',
          source_file: '/data/users.csv',
          row_index: 0,
        },
      ],
    }

    const vm = createValidationReportViewModel(data, defaultOptions)
    expect(vm.errors).toHaveLength(1)
    expect(vm.errors[0].type_label).toBe('NotNull')
    expect(vm.errors[0].normalized_stage).toBe('constraint')
    expect(vm.errors[0].key).toBe('error-0')
    expect(vm.failedCount).toBe(1)
    expect(vm.allCount).toBe(1)
  })

  it('passed_items 转换为 passed 行', () => {
    const data: any = {
      success: true,
      summary: {
        files_total: 1,
        files_loaded: 1,
        tables_loaded: 1,
        loading_error_count: 0,
        format_error_count: 0,
        constraint_error_count: 0,
        total_error_count: 0,
        duration_ms: 50,
      },
      errors: [],
      passed_items: [
        {
          stage: 'constraint',
          check_type: 'NotNull',
          table: 'users',
          column: 'name',
        },
      ],
    }

    const vm = createValidationReportViewModel(data, defaultOptions)
    expect(vm.passedItems).toHaveLength(1)
    expect(vm.passedItems[0].type_label).toBe('NotNull')
    expect(vm.passedCount).toBe(1)
    expect(vm.failedCount).toBe(0)
  })

  it('没有 source_file 时使用 table 作为位置', () => {
    const data: any = {
      success: false,
      summary: { constraint_error_count: 1, total_error_count: 1 },
      errors: [
        {
          stage: 'constraint',
          error_type: 'unique',
          check_type: 'Unique',
          message: 'Duplicate',
          table: 'users',
        },
      ],
    }

    const vm = createValidationReportViewModel(data, defaultOptions)
    expect(vm.errors[0].location).toContain('users')
  })

  it('消息包含建议时分离', () => {
    const data: any = {
      success: false,
      summary: { constraint_error_count: 1, total_error_count: 1 },
      errors: [
        {
          stage: 'constraint',
          error_type: 'range',
          check_type: 'Range',
          message: 'Value out of range 建议: Set value between 0-100',
        },
      ],
    }

    const vm = createValidationReportViewModel(data, defaultOptions)
    expect(vm.errors[0].display_message).not.toContain('建议')
    expect(vm.errors[0].suggestion).toBeTruthy()
  })
})
