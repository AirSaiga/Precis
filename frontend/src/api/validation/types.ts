/**
 * @file types.ts
 * @description 校验 API 通用类型定义
 *
 * 该模块定义校验 API 的通用类型，
 * 供各校验类型 API 使用。
 */

export interface ValidationErrorRow {
  row_index: number
  cell_value: string
  error_message?: string
}

export interface ValidationResult {
  is_valid: boolean
  error_count: number
  total_rows: number
  match_count: number
  error_rows: ValidationErrorRow[]
  validation_time: string
}

export interface ValidationResponse {
  success: boolean
  validation_type: string
  data: ValidationResult | null
  error?: string
}

export interface ValidationRequest {
  validation_type: string
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: Record<string, unknown>
}

export type ValidationType =
  | 'not_null'
  | 'unique'
  | 'allowed_values'
  | 'range'
  | 'conditional'
  | 'foreign_key'
  | 'scripted'
  | 'charset'
  | 'date_logic'

export function isValidationType(value: string): value is ValidationType {
  return [
    'not_null',
    'unique',
    'allowed_values',
    'range',
    'conditional',
    'foreign_key',
    'scripted',
    'charset',
    'date_logic',
  ].includes(value)
}
