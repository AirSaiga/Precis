import { describe, it, expect } from 'vitest'
import { deriveValidationAllPass } from '@/utils/validationAllPass'
import type { FullValidationResponse } from '@/api/projectValidationApi'

function makeResponse(overrides?: Partial<FullValidationResponse>): FullValidationResponse {
  return {
    success: true,
    summary: {
      files_total: 2,
      files_loaded: 2,
      tables_loaded: 2,
      loading_error_count: 0,
      format_error_count: 0,
      constraint_error_count: 0,
      total_error_count: 0,
      duration_ms: 120,
    },
    errors: [],
    statistics: {
      total_checks: 34,
      passed_count: 34,
      failed_count: 0,
      pass_rate: 1,
      by_type: {},
      by_table: {},
    },
    ...overrides,
  }
}

describe('deriveValidationAllPass', () => {
  it('全部通过且 0 错误时判定全绿，携带通过统计', () => {
    const info = deriveValidationAllPass(makeResponse())
    expect(info.allPass).toBe(true)
    expect(info.passedCount).toBe(34)
    expect(info.totalChecks).toBe(34)
  })

  it('存在错误数时不算全绿', () => {
    const info = deriveValidationAllPass(
      makeResponse({
        summary: {
          ...makeResponse().summary,
          constraint_error_count: 2,
          total_error_count: 2,
        },
      })
    )
    expect(info.allPass).toBe(false)
  })

  it('存在失败检查项时不算全绿（即使汇总错误为 0）', () => {
    const info = deriveValidationAllPass(
      makeResponse({
        statistics: {
          total_checks: 34,
          passed_count: 30,
          failed_count: 4,
          pass_rate: 0.88,
          by_type: {},
          by_table: {},
        },
      })
    )
    expect(info.allPass).toBe(false)
  })

  it('业务失败（success=false 或 error 非空）不算全绿', () => {
    expect(deriveValidationAllPass(makeResponse({ success: false })).allPass).toBe(false)
    expect(deriveValidationAllPass(makeResponse({ error: 'boom' })).allPass).toBe(false)
  })

  it('遇错即停中断不算全绿', () => {
    const info = deriveValidationAllPass(
      makeResponse({
        summary: { ...makeResponse().summary, interrupted: true },
      })
    )
    expect(info.allPass).toBe(false)
  })

  it('空跑（0 检查项）不算全绿，避免庆祝空校验', () => {
    const info = deriveValidationAllPass(
      makeResponse({
        statistics: {
          total_checks: 0,
          passed_count: 0,
          failed_count: 0,
          pass_rate: 0,
          by_type: {},
          by_table: {},
        },
      })
    )
    expect(info.allPass).toBe(false)
  })

  it('statistics 缺失时不算全绿且统计为 0', () => {
    const info = deriveValidationAllPass(makeResponse({ statistics: null }))
    expect(info.allPass).toBe(false)
    expect(info.passedCount).toBe(0)
    expect(info.totalChecks).toBe(0)
  })
})
