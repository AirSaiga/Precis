/**
 * @file index.ts
 * @description 脚本校验 API
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import type { ValidationResult, ValidationResponse } from '../types'

export interface ScriptedRequest {
  target_column_name: string
  source_file_path: string
  sheet_name?: string
  header_row?: number
  validation_config?: {
    script?: string
    script_language?: 'python' | 'javascript'
    script_file_path?: string
  }
}

export interface ScriptedResponse extends ValidationResponse {
  data: {
    is_valid: boolean
    error_count: number
    total_rows: number
    match_count: number
    error_rows: Array<{ row_index: number; cell_value: string; error_message?: string }>
    validation_time: string
  } | null
}

export async function validateScripted(request: ScriptedRequest): Promise<ScriptedResponse> {
  const formData = new FormData()
  formData.append('validation_type', 'scripted')
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
    const response = await apiClient.post<ScriptedResponse>(`/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    })
    return response.data
  } catch (error) {
    logger.error('脚本校验失败:', error)
    return {
      success: false,
      validation_type: 'scripted',
      data: null,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

export function mapScriptedResult(response: ScriptedResponse): ValidationResult | null {
  if (!response.success || !response.data) {
    return null
  }
  return response.data
}
