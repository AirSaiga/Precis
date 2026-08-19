/**
 * @file validationAllPass.ts
 * @description 全量校验"全绿时刻"判定（纯函数）
 *
 * 全量校验完成且 0 错误、0 阻塞（未中断、无业务错误、无失败检查项）
 * 且实际执行过检查时，判定为"全绿"，触发一次性的正反馈
 * （状态栏成功计数 status-pulse + success toast 显示通过统计）。
 *
 * 判定与 UI/通知解耦，便于单测。
 */

import type { FullValidationResponse } from '@/api/projectValidationApi'

/** 全绿判定结果 */
export interface ValidationAllPassInfo {
  /** 是否全绿（满足全部条件才为 true） */
  allPass: boolean
  /** 通过的检查项数（toast 统计文案用） */
  passedCount: number
  /** 总检查项数 */
  totalChecks: number
}

/**
 * 判定一次全量校验结果是否"全绿"。
 *
 * 条件（全部满足）：
 * 1. response.success 为 true 且无业务错误（response.error 为空）
 * 2. 未因"遇错即停"中断（summary.interrupted 不为 true）
 * 3. 汇总错误数为 0（total_error_count === 0）
 * 4. 无失败检查项（statistics.failed_count === 0）
 * 5. 实际执行过检查（total_checks > 0，空跑不庆祝）
 */
export function deriveValidationAllPass(response: FullValidationResponse): ValidationAllPassInfo {
  const totalChecks = response.statistics?.total_checks ?? 0
  const passedCount = response.statistics?.passed_count ?? 0
  const failedCount = response.statistics?.failed_count ?? 0
  const totalErrorCount = response.summary?.total_error_count ?? 0
  const interrupted = response.summary?.interrupted === true

  const allPass =
    response.success &&
    !response.error &&
    !interrupted &&
    totalErrorCount === 0 &&
    failedCount === 0 &&
    totalChecks > 0

  return { allPass, passedCount, totalChecks }
}
