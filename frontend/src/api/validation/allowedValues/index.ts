/**
 * @file index.ts
 * @description 允许值约束校验 API
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import type { ValidationResult, ValidationResponse } from '../types'

export interface AllowedValuesRequest {
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    allowed_values?: string[]
  }
}

export interface AllowedValuesResponse extends ValidationResponse {
  data: {
    is_valid: boolean
    error_count: number
    total_rows: number
    match_count: number
    error_rows: Array<{ row_index: number; cell_value: string; invalid_value?: string }>
    validation_time: string
  } | null
}

export async function validateAllowedValues(
  request: AllowedValuesRequest
): Promise<AllowedValuesResponse> {
  const formData = new FormData()
  formData.append('validation_type', 'allowed_values')
  formData.append('target_column_name', request.target_column_name)
  formData.append('source_file_path', request.source_file_path)
  if (request.sheet_name) {
    formData.append('sheet_name', request.sheet_name)
  }
  formData.append('header_row', String(request.header_row ?? 0))
  if (request.validation_config?.allowed_values) {
    formData.append(
      'validation_config',
      JSON.stringify({
        allowed_values: request.validation_config.allowed_values,
      })
    )
  }

  try {
    const response = await apiClient.post<AllowedValuesResponse>(`/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
    return response.data
  } catch (error) {
    logger.error('允许值约束校验失败:', error)
    return {
      success: false,
      validation_type: 'allowed_values',
      data: null,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

export function mapAllowedValuesResult(response: AllowedValuesResponse): ValidationResult | null {
  if (!response.success || !response.data) {
    return null
  }
  return response.data
}
