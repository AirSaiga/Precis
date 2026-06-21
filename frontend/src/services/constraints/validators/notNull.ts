/**
 * @file notNull.ts
 * @description 非空约束校验纯函数
 *
 * 从 composable 下沉到服务层的领域逻辑：
 * 将文件路径、列名等运行时参数转换为后端 API 请求，
 * 并将后端响应映射为前端统一的 NotNullValidationResult。
 */

import { logger } from '@/core/utils/logger'
import { validateNotNull as apiValidateNotNull } from '@/api/validationApi'
import type { ValidationErrorRow } from '@/api/validation/core'

export interface NotNullValidationResult {
  /** 检测到的空值数量 */
  errorCount: number
  /** 总行数 */
  totalRows: number
  /** 错误详情数组 */
  errors: Array<{
    /** 行号 */
    row: number
    /** 空值 */
    value: string
    /** 错误消息 */
    message: string
  }>
}

export interface NotNullValidationOptions {
  jsonPath?: string
  jsonFormat?: string
  recordPath?: string
  columnDataType?: string
}

/**
 * 执行非空约束校验（纯函数）
 *
 * @param sourceFilePath - 源文件路径
 * @param columnName - 要校验的列名
 * @param sheetName - 工作表名称（可选）
 * @param headerRow - 表头行索引（可选，默认为 0）
 * @param options - JSON 数据源等额外选项
 * @returns 包含校验结果的 NotNullValidationResult 对象
 */
export async function validateNotNull(
  sourceFilePath: string,
  columnName: string,
  sheetName?: string,
  headerRow?: number,
  options?: NotNullValidationOptions
): Promise<NotNullValidationResult> {
  logger.debug('🔄 执行非空验证:', columnName)

  try {
    const response = await apiValidateNotNull({
      validation_type: 'not_null',
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
      column_data_type: options?.columnDataType,
      json_path: options?.jsonPath,
      json_format: options?.jsonFormat,
      record_path: options?.recordPath,
    })

    if (response.success && response.data) {
      return {
        errorCount: response.data.error_count,
        totalRows: response.data.total_rows,
        errors: response.data.error_rows.map((err: ValidationErrorRow) => ({
          row: err.row_index,
          value: err.cell_value,
          message: '值不能为空',
        })),
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('非空验证失败:', error)
    throw error
  }
}
