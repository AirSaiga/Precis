/**
 * 高级校验 API（AllowedValues / Conditional / ForeignKey / Scripted / Charset / DateLogic）
 *
 * 封装到 /v2/validation 端点的 HTTP 请求。
 */
import { logger } from '@/core/utils/logger'
import { isAxiosError } from 'axios'
import apiClient from '@/core/services/httpClient'
import { VALIDATION_API_PATH } from './core'
import type {
  ValidationResponse,
  ValidationRequestBase,
  AllowedValuesValidationRequest,
  ConditionalValidationRequest,
  ForeignKeyValidationRequest,
  ScriptedValidationRequest,
  CharsetValidationRequest,
} from './core'

/** 允许值约束校验 */
export async function validateAllowedValues(
  request: AllowedValuesValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始允许值约束校验:', {
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
      logger.debug('✅ 允许值约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 允许值约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 允许值约束校验请求错误:', error)

    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      })
    }

    throw error
  }
}

/**
 * 执行条件约束校验
 *
 * 根据条件逻辑执行校验，支持复杂的条件判断
 *
 * @param request - 包含条件逻辑的校验请求
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateConditional({
 *   validation_type: 'conditional',
 *   target_column_name: 'discount',
 *   source_file_path: 'data.xlsx',
 *   validation_config: {
 *     if_column: 'product_type',
 *     if_value: 'sale',
 *     then_column: 'discount',
 *     then_condition: { operator: 'greater_than', value: 50 }
 *   }
 * });
 * ```
 */
export async function validateConditional(
  request: ConditionalValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始条件约束校验:', {
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
      logger.debug('✅ 条件约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 条件约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 条件约束校验请求错误:', error)

    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      })
    }

    throw error
  }
}

/**
 * 执行外键约束校验
 *
 * 检查列值是否在参照表/参照列中真实存在，维护数据完整性
 *
 * @param request - 包含外键引用信息的校验请求
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateForeignKey({
 *   validation_type: 'foreign_key',
 *   target_column_name: 'category_id',
 *   source_file_path: 'products.xlsx',
 *   validation_config: {
 *     target_table: 'categories',
 *     target_column: 'id',
 *     target_values: ['1', '2', '3']
 *   }
 * });
 * ```
 */
export async function validateForeignKey(
  request: ForeignKeyValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始外键约束校验:', {
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
      logger.debug('✅ 外键约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 外键约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 外键约束校验请求错误:', error)

    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      })
    }

    throw error
  }
}

/**
 * 执行脚本约束校验
 *
 * 使用自定义脚本语言编写校验逻辑，支持复杂的自定义验证需求
 *
 * @param request - 包含校验脚本的请求参数
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateScripted({
 *   validation_type: 'scripted',
 *   target_column_name: 'amount',
 *   source_file_path: 'transactions.xlsx',
 *   validation_config: {
 *     script: 'value > 0 && value < 1000000'
 *   }
 * });
 * ```
 */
export async function validateScripted(
  request: ScriptedValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始脚本约束校验:', {
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
      logger.debug('✅ 脚本约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 脚本约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 脚本约束校验请求错误:', error)

    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      })
    }

    throw error
  }
}

/**
 * 执行字符集约束校验
 *
 * 检查列中的字符串是否符合指定的字符集要求（ASCII 或中文）
 *
 * @param request - 包含字符集配置的校验请求
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateCharset({
 *   validation_type: 'charset',
 *   target_column_name: 'username',
 *   source_file_path: 'data.xlsx',
 *   validation_config: { charset_mode: 'ascii' }
 * });
 * ```
 */
export async function validateCharset(
  request: CharsetValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始字符集约束校验:', {
      column: request.target_column_name,
      source: request.source_file_path,
      mode: request.validation_config?.charset_mode,
    })

    const response = await apiClient.post<ValidationResponse>(`${VALIDATION_API_PATH}`, request, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = response.data

    if (result.success && result.data) {
      logger.debug('✅ 字符集约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 字符集约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 字符集约束校验请求错误:', error)

    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      })
    }

    throw error
  }
}

export interface DateLogicValidationRequest extends ValidationRequestBase {
  validation_type: 'date_logic'
  validation_config?: Record<string, unknown>
}

/** 日期逻辑约束校验 */
export async function validateDateLogic(
  request: DateLogicValidationRequest
): Promise<ValidationResponse> {
  try {
    const response = await apiClient.post<ValidationResponse>(`${VALIDATION_API_PATH}`, request, {
      headers: { 'Content-Type': 'application/json' },
    })
    return response.data
  } catch (error) {
    logger.error('❌ 日期逻辑约束校验请求错误:', error)
    if (isAxiosError(error)) {
      logger.error('请求详情:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        data: error.response?.data,
      })
    }
    throw error
  }
}
