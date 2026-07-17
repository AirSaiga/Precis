/**
 * @file projectValidationApi.ts
 * @description 项目全量校验 API
 *
 * 封装后端 `/validation/*` 接口，支持项目级全量数据校验。
 *
 * 功能概述：
 * - runFullValidation: 执行全量校验（加载数据 → 格式校验 → 约束校验）
 * - getValidationStatus: 查询校验任务状态
 * - FullValidationSummary: 校验结果摘要（错误数、加载统计、耗时）
 * - FullValidationErrorItem: 单个错误项详情（阶段、类型、消息、行列信息）
 *
 * 架构设计：
 * - 使用 apiClient 统一 HTTP 客户端（支持拦截器和重试）
 * - 类型定义与后端响应结构对齐
 * - 支持按表过滤（table_filter）
 */

import apiClient from '@/core/services/httpClient'

export interface FullValidationSummary {
  files_total: number
  files_loaded: number
  tables_loaded: number
  loading_error_count: number
  format_error_count: number
  constraint_error_count: number
  total_error_count: number
  duration_ms: number
  /** C6: 校验是否因遇错即停(error_handling=stop)提前终止 */
  interrupted?: boolean
}

export interface FullValidationErrorItem {
  stage: 'preflight' | 'loading' | 'format' | 'constraint'
  error_type: string
  message: string
  check_type?: string | null
  table?: string | null
  table_id?: string | null
  column?: string | null
  column_id?: string | null
  row_index?: number | null
  value?: string | null
  source_path?: string | null
  source_file?: string | null
  source_sheet?: string | null
}

/**
 * 校验通过项
 * 记录全量校验中通过的检查项详情
 */
export interface ValidationPassedItem {
  stage: 'loading' | 'format' | 'constraint' | 'regex'
  check_type: string
  message: string
  table?: string | null
  table_id?: string | null
  column?: string | null
  column_id?: string | null
  source_path?: string | null
  source_file?: string | null
  source_sheet?: string | null
}

/**
 * 校验统计信息
 * 汇总全量校验的详细统计信息
 */
export interface ValidationStatistics {
  total_checks: number
  passed_count: number
  failed_count: number
  pass_rate: number
  by_type: Record<string, { total: number; passed: number; failed: number }>
  by_table: Record<string, { total: number; passed: number; failed: number }>
}

export interface CoverageRef {
  id: string
  path: string
}

export interface CoverageGroup {
  schemas: CoverageRef[]
  constraints: CoverageRef[]
  regex_nodes: CoverageRef[]
}

export interface ValidationCoverage {
  is_complete: boolean
  unlisted: CoverageGroup
  dangling: CoverageGroup
}

export interface FullValidationResponse {
  success: boolean
  summary: FullValidationSummary
  errors: FullValidationErrorItem[]
  passed_items?: ValidationPassedItem[]
  statistics?: ValidationStatistics | null
  error?: string | null
  warnings?: string[]
  coverage?: ValidationCoverage | null
}

export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

export interface ValidationTaskTarget {
  type: ValidationTaskTargetType
  table_id?: string | null
  file_path?: string | null
  display_name?: string | null
}

export interface ValidationSettingsOverride {
  auto_validate?: boolean
  strict_mode?: boolean
  error_handling?: 'stop' | 'continue' | 'report'
  timeout_seconds?: number
  batch_max_files?: number
}

export interface FileProcessingSettingsOverride {
  default_encoding?: 'utf-8' | 'gbk' | 'auto'
  csv_delimiter?: string
  null_value_strategy?: 'null' | 'empty' | 'default'
  date_format?: string
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
  target?: ValidationTaskTarget
  options?: {
    data_directory?: string
    override_settings?: ProjectSettingsOverride
  }
}

export interface ValidationTaskRunOptions {
  data_directory?: string
  override_settings?: ProjectSettingsOverride
}

export interface ValidationTaskPreflightOptions {
  save_before_run?: boolean
  missing_resources_strategy?: 'ask' | 'merge_then_run' | 'run_directly'
}

export interface ValidationTaskRequest {
  target: ValidationTaskTarget
  run_options?: ValidationTaskRunOptions
  preflight_options?: ValidationTaskPreflightOptions
}

export async function validateV2Full(
  payload: FullValidationRequest
): Promise<FullValidationResponse> {
  const res = await apiClient.post<FullValidationResponse>('/project/validate/full', payload)
  return res.data
}

export async function validateValidationTask(
  payload: ValidationTaskRequest
): Promise<FullValidationResponse> {
  return validateV2Full({
    target: payload.target,
    options: {
      data_directory: payload.run_options?.data_directory,
      override_settings: payload.run_options?.override_settings,
    },
  })
}
