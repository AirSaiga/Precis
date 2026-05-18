/**
 * @file api.ts
 * @description API相关类型定义
 *
 * 设计意图：
 * - 集中存放所有 API 请求/响应类型，避免分散在多个 api/*.ts 文件中
 * - 保持与后端 Pydantic 模型的字段一致性
 */

// ============================================================================
// 文件预览
// ============================================================================

export interface FilePreviewRequest {
  file_path: string
  max_rows?: number
  max_cols?: number
}

export interface FilePreviewResponse {
  success: boolean
  data?: string[][]  // 完整的表格数据，包含表头行
  file_type: string
  file_name: string
  total_rows?: number
  total_cols?: number
  sheets?: string[]  // Excel文件的工作表列表
  current_sheet?: string  // 当前选中的工作表
  error?: string
}

// ============================================================================
// Pattern 管理
// ============================================================================

export interface CreatePatternRequest {
  name: string
  regex: string
  description?: string
  output?: Record<string, unknown>
  overwrite?: boolean
}

export interface CreatePatternResponse {
  message: string
  pattern_path: string
  pattern_name: string
}

// ============================================================================
// 校验任务
// ============================================================================

export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

export interface ValidationTaskTarget {
  type: ValidationTaskTargetType
  table_id?: string
  file_path?: string
}

export interface ValidationSettingsOverride {
  auto_validate?: boolean
  strict_mode?: boolean
  error_handling?: 'stop' | 'continue' | 'report'
  timeout_seconds?: number
  batch_max_files?: number
}

export interface FileProcessingSettingsOverride {
  default_encoding?: 'utf-8' | 'auto' | 'gbk'
  csv_delimiter?: string
}

export interface ScriptSecuritySettingsOverride {
  allow_eval?: boolean
  allow_exec?: boolean
  sandbox_mode?: boolean
  timeout_seconds?: number
}

export interface ProjectSettingsOverride {
  validation?: ValidationSettingsOverride
  file_processing?: FileProcessingSettingsOverride
  script_security?: ScriptSecuritySettingsOverride
}

export interface FullValidationRequest {
  data_directory: string
  settings_override?: ProjectSettingsOverride
  table_filter?: string | string[]
}

export interface FullValidationResponse {
  raw_datasets: Record<string, unknown>
  parsed_datasets: Record<string, unknown>
  errors: Array<Record<string, unknown>>
  loading_errors: Array<Record<string, unknown>>
  duration_ms: number
  timeout_occurred: boolean
  validation_details: {
    format_checks: Array<Record<string, unknown>>
    constraint_checks: Array<Record<string, unknown>>
  }
}