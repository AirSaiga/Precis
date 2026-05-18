/**
 * @file index.ts
 * @description 唯一性约束校验 API
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import type { ValidationResult, ValidationResponse } from '../types'

export interface UniqueRequest {
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: Record<string, unknown>
}

export interface UniqueResponse extends ValidationResponse {
  data: {
    is_valid: boolean
    error_count: number
    total_rows: number
    match_count: number
    error_rows: Array<{ row_index: number; cell_value: string; duplicate_count?: number }>
    validation_time: string
  } | null
}

export async function validateUnique(request: UniqueRequest): Promise<UniqueResponse> {
  const formData = new FormData()
  formData.append('validation_type', 'unique')
  formData.append('target_column_name', request.target_column_name)
  formData.append('source_file_path', request.source_file_path)
  if (request.sheet_name) {
    formData.append('sheet_name', request.sheet_name)
  }
  formData.append('header_row', String(request.header_row ?? 0))
  if (request.validation_config) {
    formData.append('validation_config', JSON.stringify(request.validation_config))
  }

  try {
    const response = await apiClient.post<UniqueResponse>(`/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
    return response.data
  } catch (error) {
    logger.error('唯一性约束校验失败:', error)
    return {
      success: false,
      validation_type: 'unique',
      data: null,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

export function mapUniqueResult(response: UniqueResponse): ValidationResult | null {
  if (!response.success || !response.data) {
    return null
  }
  return response.data
}
