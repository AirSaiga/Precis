/**
 * @file index.ts
 * @description 条件约束校验 API
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import type { ValidationResult, ValidationResponse } from '../types'

export interface ConditionalRequest {
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    condition_column?: string
    condition_value?: string
    condition_operator?:
      | 'equals'
      | 'not_equals'
      | 'greater_than'
      | 'less_than'
      | 'contains'
      | 'not_contains'
    target_value?: string
  }
}

export interface ConditionalResponse extends ValidationResponse {
  data: {
    is_valid: boolean
    error_count: number
    total_rows: number
    match_count: number
    error_rows: Array<{
      row_index: number
      cell_value: string
      condition?: string
      reason?: string
    }>
    validation_time: string
  } | null
}

export async function validateConditional(
  request: ConditionalRequest
): Promise<ConditionalResponse> {
  const formData = new FormData()
  formData.append('validation_type', 'conditional')
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
    const response = await apiClient.post<ConditionalResponse>(`/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
    return response.data
  } catch (error) {
    logger.error('条件约束校验失败:', error)
    return {
      success: false,
      validation_type: 'conditional',
      data: null,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

export function mapConditionalResult(response: ConditionalResponse): ValidationResult | null {
  if (!response.success || !response.data) {
    return null
  }
  return response.data
}
