/**
 * @file inline.ts
 * @description 行内数据校验 API 调用模块
 *
 * 为前端纯数据节点（TransformOutput / ManualData）提供行内校验接口，
 * 将行数据发送至后端 POST /validate/inline 端点，由 UnifiedValidationService 统一执行校验。
 *
 * @module validation/inline
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import { VALIDATION_API_PATH, logAxiosError } from './core'
import type { ValidationResponse } from './core'

/**
 * 行内校验通用请求类型
 *
 * 对应后端 InlineValidationRequest 模型。
 * rows 的第一行默认视为表头（与 TransformOutput/ManualData 的 rows 结构一致）。
 * 当提供 column_names 时，rows 全部视为数据行。
 */
export interface InlineValidationRequest {
  /** 校验类型标识 */
  validation_type: string
  /** 目标列名 */
  target_column_name: string
  /** 行数据二维数组，默认第一行为表头 */
  rows: (string | number | boolean | null)[][]
  /** 列名列表（提供时 rows 全部视为数据行） */
  column_names?: string[]
  /** 校验特定配置 */
  validation_config?: Record<string, unknown>
  /** 是否允许脚本执行 */
  allow_unsafe_eval?: boolean
  /** 目标列在 Schema 中声明的数据类型（如 string/integer/decimal） */
  column_data_type?: string
}

/**
 * 执行行内数据校验
 *
 * 将行数据发送至后端 /validate/inline 端点，
 * 后端将数据转为 DataFrame 后通过 UnifiedValidationService 执行校验。
 *
 * @param request - 行内校验请求参数
 * @returns Promise<ValidationResponse> - 校验结果响应
 *
 * @example
 * ```typescript
 * const result = await validateInline({
 *   validation_type: 'not_null',
 *   target_column_name: 'name',
 *   rows: [['name', 'age'], ['Alice', '25'], ['', '30']]
 * });
 * ```
 */
export async function validateInline(
  request: InlineValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始行内数据校验:', {
      type: request.validation_type,
      column: request.target_column_name,
      rowCount: request.rows.length,
    })

    const response = await apiClient.post<ValidationResponse>(
      `${VALIDATION_API_PATH}/inline`,
      request,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    const result = response.data

    if (result.success && result.data) {
      logger.debug('✅ 行内数据校验完成:', {
        type: request.validation_type,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 行内数据校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 行内数据校验请求错误:', error)

    logAxiosError(error)

    throw error
  }
}
