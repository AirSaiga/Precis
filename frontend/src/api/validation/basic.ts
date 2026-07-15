/**
 * 基础校验 API（NotNull / Unique / Range）
 *
 * 封装到 /v2/validation 端点的 HTTP 请求。
 */
import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import { VALIDATION_API_PATH, logAxiosError } from './core'
import type { ValidationResponse, NotNullValidationRequest, RangeValidationRequest } from './core'
/** 非空约束校验 */
export async function validateNotNull(
  request: NotNullValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始非空约束校验:', {
      column: request.target_column_name,
      source: request.source_file_path,
    })

    const response = await apiClient.post<ValidationResponse>(`${VALIDATION_API_PATH}`, request, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = response.data

    if (result.success && result.data) {
      logger.debug('✅ 非空约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 非空约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 非空约束校验请求错误:', error)

    logAxiosError(error)

    throw error
  }
}

/**
 * 执行区间约束校验
 *
 * 检查列中的数值是否在指定的范围内
 *
 * @param request - 包含区间配置的校验请求
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateRange({
 *   validation_type: 'range',
 *   target_column_name: 'age',
 *   source_file_path: 'data.xlsx',
 *   validation_config: {
 *     min_value: 0,
 *     max_value: 150,
 *     boundary_mode: 'inclusive'
 *   }
 * });
 * ```
 */
export async function validateRange(request: RangeValidationRequest): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始区间约束校验:', {
      column: request.target_column_name,
      source: request.source_file_path,
      min: request.validation_config?.min_value,
      max: request.validation_config?.max_value,
      boundary: request.validation_config?.boundary_mode,
    })

    const response = await apiClient.post<ValidationResponse>(`${VALIDATION_API_PATH}`, request, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = response.data

    if (result.success && result.data) {
      logger.debug('✅ 区间约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 区间约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 区间约束校验请求错误:', error)

    logAxiosError(error)

    throw error
  }
}
