/**
 * @file core.ts
 * @description 校验 API 核心类型和函数
 *
 * 该模块提供与后端数据校验服务通信的接口函数，支持多种数据验证类型：
 * - 非空约束校验 (not_null)
 * - 唯一性约束校验 (unique)
 * - 允许值约束校验 (allowed_values)
 * - 条件约束校验 (conditional)
 * - 外键约束校验 (foreign_key)
 * - 脚本约束校验 (scripted)
 *
 * 架构说明：
 * - 所有校验请求通过统一的 /validate 端点发送
 * - 后端根据校验类型（validation_type）执行相应的验证逻辑
 *
 * @module validation/core
 */

import { logger } from '@/core/utils/logger'
import { isAxiosError } from 'axios'
import apiClient from '@/core/services/httpClient'

/**
 * 校验 API 基础路径
 * 用于构建完整的校验服务请求URL
 */
export const VALIDATION_API_PATH = '/validate'

// ========================================
// 校验请求类型定义
// ========================================

/**
 * 非空约束校验请求参数
 * 用于检查指定列是否存在空值
 */
export interface NotNullValidationRequest {
  /** 校验类型标识，固定为 'not_null' */
  validation_type: 'not_null'
  /** 目标列名，需要校验的列名称 */
  target_column_name: string
  /** 源文件路径，被校验的Excel或CSV文件路径 */
  source_file_path: string
  /** 工作表名称，Excel文件的工作表名称，CSV文件可省略 */
  sheet_name?: string
  /** 表头行号，表头所在行号，默认为0（第一行） */
  header_row?: number
  /** 校验配置，可选的额外校验参数 */
  validation_config?: Record<string, unknown>
}

/**
 * 唯一性约束校验请求参数
 * 用于检查指定列的值是否唯一（无重复）
 */
export interface UniqueValidationRequest {
  /** 校验类型标识，固定为 'unique' */
  validation_type: 'unique'
  /** 目标列名，需要校验的列名称 */
  target_column_name: string
  /** 源文件路径，被校验的Excel或CSV文件路径 */
  source_file_path: string
  /** 工作表名称，Excel文件的工作表名称，CSV文件可省略 */
  sheet_name?: string
  /** 表头行号，表头所在行号，默认为0（第一行） */
  header_row?: number
  /** 校验配置，可选的额外校验参数 */
  validation_config?: Record<string, unknown>
}

// ========================================
// 校验结果类型定义
// ========================================

/**
 * 校验错误行信息
 * 描述校验失败的具体行及其错误详情
 */
export interface ValidationErrorRow {
  /** 行索引，从0开始的行号 */
  row_index: number
  /** 单元格值，导致错误的单元格内容 */
  cell_value: string
  /** 错误消息，详细的错误描述信息 */
  error_message?: string
}

/**
 * 非空约束校验结果
 * 包含非空校验的完整结果信息
 */
export interface NotNullValidationResult {
  /** 是否通过校验，全部通过为true，存在空值为false */
  is_valid: boolean
  /** 错误数量，存在空值的行数 */
  error_count: number
  /** 总行数，被校验的数据总行数 */
  total_rows: number
  /** 匹配数量，非空值的行数 */
  match_count: number
  /** 错误行列表，包含空值的行详细信息 */
  error_rows: ValidationErrorRow[]
  /** 校验时间，执行校验的时间戳 */
  validation_time: string
}

/**
 * 唯一性约束校验结果
 * 包含唯一性校验的完整结果信息
 */
export interface UniqueValidationResult {
  /** 是否通过校验，全部通过为true，存在重复值为false */
  is_valid: boolean
  /** 错误数量，存在重复值的行数 */
  error_count: number
  /** 总行数，被校验的数据总行数 */
  total_rows: number
  /** 匹配数量，唯一值的行数 */
  match_count: number
  /** 错误行列表，包含重复值的行详细信息 */
  error_rows: ValidationErrorRow[]
  /** 校验时间，执行校验的时间戳 */
  validation_time: string
}

/**
 * 统一校验响应格式
 * 后端返回的校验结果统一包装格式
 */
export interface ValidationResponse {
  /** 请求是否成功 */
  success: boolean
  /** 执行的校验类型 */
  validation_type: string
  /** 校验结果数据，失败时为null */
  data: NotNullValidationResult | UniqueValidationResult | null
  /** 错误信息，成功时为null */
  error: string | null
}

// ========================================
// 非空约束校验函数
// ========================================

/**
 * 执行非空约束校验
 *
 * 检查指定列中是否存在空值（null、空字符串等）
 *
 * @param request - 校验请求参数，包含目标列和源文件信息
 * @returns Promise<ValidationResponse> - 校验结果响应
 *
 * @example
 * ```typescript
 * const result = await validateNotNull({
 *   validation_type: 'not_null',
 *   target_column_name: 'email',
 *   source_file_path: '/path/to/data.xlsx',
 *   sheet_name: 'Sheet1'
 * });
 * ```
 */

// ========================================
// 唯一性约束校验函数
// ========================================

/**
 * 执行唯一性约束校验
 *
 * 检查指定列中是否存在重复值
 *
 * @param request - 校验请求参数，包含目标列和源文件信息
 * @returns Promise<ValidationResponse> - 校验结果响应
 *
 * @example
 * ```typescript
 * const result = await validateUnique({
 *   validation_type: 'unique',
 *   target_column_name: 'user_id',
 *   source_file_path: '/path/to/data.xlsx'
 * });
 * ```
 */
export async function validateUnique(
  request: UniqueValidationRequest
): Promise<ValidationResponse> {
  try {
    logger.debug('🔍 开始唯一性约束校验:', {
      column: request.target_column_name,
      source: request.source_file_path,
      requestData: JSON.stringify(request),
    })

    const response = await apiClient.post<ValidationResponse>(`${VALIDATION_API_PATH}`, request, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = response.data

    if (result.success && result.data) {
      logger.debug('✅ 唯一性约束校验完成:', {
        column: request.target_column_name,
        isValid: result.data.is_valid,
        errorCount: result.data.error_count,
        totalRows: result.data.total_rows,
      })
    } else {
      logger.warn('⚠️ 唯一性约束校验失败:', result.error)
    }

    return result
  } catch (error) {
    logger.error('❌ 唯一性约束校验请求错误:', error)

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

// ========================================
// 其他校验类型的请求类型定义
// ========================================

/**
 * 允许值约束校验请求参数
 * 检查列值是否在允许的值列表中
 */
export interface AllowedValuesValidationRequest {
  validation_type: 'allowed_values'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    /**
     * 允许值列表
     *
     * 为什么不是纯 string[]：
     * - 后端使用 pandas 读取 Excel/CSV 时，会对列做类型推断（int/float/bool/object）；
     * - 若列是数值类型，而前端只发送 string[]，pandas isin 会因类型不一致导致误判；
     * - 因此前端会做"双编码"：同一个输入值可能同时发送 string 与 number/bool 版本，提高命中率。
     */
    allowed_values: Array<string | number | boolean>
  }
}

/**
 * 条件约束校验请求参数
 * 根据条件逻辑执行校验
 */
export interface ConditionalValidationRequest {
  validation_type: 'conditional'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    if_column?: string
    if_value?: string | number | boolean
    if_logic?: 'and' | 'or'
    if_conditions?: Array<{
      if_column: string
      operator: 'eq' | 'neq' | 'in' | 'not_null' | 'greater_than'
      value?: string | number | boolean
      values?: Array<string | number | boolean>
    }>
    then_column?: string
    then_condition?: Record<string, unknown> | string
    then_condition_config?: Record<string, unknown> | string
  }
}

/**
 * 外键约束校验请求参数
 * 检查列值是否在参照表中存在
 */
export interface ForeignKeyValidationRequest {
  validation_type: 'foreign_key'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    target_table: string
    target_column: string
    target_values?: string[]
  }
}

/**
 * 脚本约束校验请求参数
 * 使用自定义脚本执行校验
 */
export interface ScriptedValidationRequest {
  validation_type: 'scripted'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    script: string
    script_name?: string
  }
  allow_unsafe_eval?: boolean
}

/**
 * 区间约束校验请求参数
 * 验证数值是否在指定范围内
 */
export interface RangeValidationRequest {
  validation_type: 'range'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    min_value?: number
    max_value?: number
    boundary_mode?: 'inclusive' | 'exclusive'
  }
}

/**
 * 字符集约束校验请求参数
 * 验证字符串是否符合指定字符集要求
 */
export interface CharsetValidationRequest {
  validation_type: 'charset'
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    charset_mode?: 'ascii' | 'chinese'
  }
}

// ========================================
// 其他校验类型的执行函数
// ========================================

/**
 * 执行允许值约束校验
 *
 * 检查列中的每个值是否都在预定义的允许值列表中
 *
 * @param request - 包含允许值配置的校验请求
 * @returns Promise<ValidationResponse> - 校验结果
 *
 * @example
 * ```typescript
 * const result = await validateAllowedValues({
 *   validation_type: 'allowed_values',
 *   target_column_name: 'status',
 *   source_file_path: 'data.xlsx',
 *   validation_config: { allowed_values: ['active', 'inactive', 'pending'] }
 * });
 * ```
 */
