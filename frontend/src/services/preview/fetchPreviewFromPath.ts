/**
 * @file fetchPreviewFromPath.ts
 * @description 从本地文件路径获取预览数据的纯服务函数
 *
 * 从 composable 层提取到 service 层，消除 utils/features 对 composables 的反向依赖。
 * 本模块无 Vue/Pinia 依赖，可被任何层安全引用。
 */

import apiClient from '@/core/services/httpClient'
import { isAxiosError } from 'axios'

export interface JsonPreviewOptions {
  jsonPath?: string
  jsonFormat?: string
  recordPath?: string
}

export interface FilePreviewResult {
  [key: string]: unknown
  data: string[][]
  actualRowCount: number
  actualColCount: number
  previewRowCount: number
  previewColCount: number
  sheets?: string[]
  currentSheet?: string
  source_type: string
  file_name: string
  size_mb: number
  modified_time: number
  raw_data?: unknown[]
  type_inference?: Record<string, string>
  field_count?: number
  nest_depth?: number
}

export const fetchPreviewDataFromPath = async (
  filePath: string,
  maxRows: number,
  maxCols: number,
  sheetName?: string,
  jsonOptions?: JsonPreviewOptions
): Promise<FilePreviewResult> => {
  const requestBody: Record<string, unknown> = {
    file_path: filePath,
    max_rows: maxRows,
    max_cols: maxCols,
    sheet_name: sheetName || null,
  }

  if (jsonOptions?.jsonPath) {
    requestBody.json_path = jsonOptions.jsonPath
  }
  if (jsonOptions?.jsonFormat) {
    requestBody.json_format = jsonOptions.jsonFormat
  }
  if (jsonOptions?.recordPath) {
    requestBody.record_path = jsonOptions.recordPath
  }

  let result: Record<string, unknown>
  try {
    const response = await apiClient.post('/preview/file/path', requestBody)
    result = response.data as Record<string, unknown>
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const status = error.response?.status
      const data = error.response?.data
      const errorText =
        typeof data === 'string'
          ? data
          : (data?.error as string | undefined) ||
            (data?.message as string | undefined) ||
            (error?.message as string | undefined) ||
            '\u672A\u77E5\u9519\u8BEF'
      throw new Error(`HTTP\u9519\u8BEF ${status ?? ''}: ${errorText}`.trim())
    }
    throw error
  }
  if (!result.success) {
    throw new Error((result.error as string | undefined) || '\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25')
  }

  return {
    data: (result.data as string[][]) || [],
    actualRowCount: (result.total_rows as number | undefined) || 0,
    actualColCount: (result.total_cols as number | undefined) || 0,
    previewRowCount: (result.total_rows as number | undefined) || 0,
    previewColCount: (result.total_cols as number | undefined) || 0,
    sheets: (result.sheets as string[] | undefined) || undefined,
    currentSheet: (result.current_sheet as string | undefined) || undefined,
    source_type: (result.file_type as string | undefined) || 'unknown',
    file_name:
      (result.file_name as string | undefined) || filePath.split(/[/\\]/).pop() || 'unknown',
    size_mb: 0,
    modified_time: Date.now(),
    raw_data: result.raw_data as unknown[] | undefined,
    type_inference: result.type_inference as Record<string, string> | undefined,
    field_count: result.field_count as number | undefined,
    nest_depth: result.nest_depth as number | undefined,
  }
}
