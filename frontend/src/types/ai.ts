/**
 * @file ai.ts
 * @description AI/LLM 相关类型定义（前端）
 *
 * 说明：
 * - 与后端 /ai/* 接口保持字段对齐
 * - 生成结果复用 V2 FullConfig 的类型（manifest/schemas/constraints/regex_nodes）
 */

import type {
  ConstraintFileV2,
  ProjectManifestV2,
  RegexNodeFileV2,
  TableSchemaFileV2,
  TransformFileV2,
} from './projectV2'

export interface AiGenerateV2ConfigOptions {
  sample_rows: number
  sample_values_per_column: number
  max_files: number
  max_cell_chars: number
  generate_schemas: boolean
  generate_constraints: boolean
  generate_regex_nodes: boolean
  keep_existing: boolean
  model?: string
  agent_mode: boolean
  max_iterations: number
  validation_sample_size: number
  auto_chunking: boolean
  chunk_max_columns: number
  chunk_max_files: number
}

export interface AiGenerateV2ConfigMetrics {
  total_rules?: number
  passed_rules?: number
  failed_rules?: number
  removed_rules?: number
  modified_rules?: number
  issues?: Array<{
    rule_id?: string
    type?: string
    severity?: string
    message?: string
    [key: string]: unknown
  }>
}

export interface AiGenerateV2ConfigRequest {
  file_paths: string[]
  target_files?: string[]
  project_name?: string
  project_id?: string
  provider_id?: string
  options: AiGenerateV2ConfigOptions
}

export interface AiGenerateV2ConfigResponse {
  success: boolean
  warnings: string[]
  yaml_preview?: string
  manifest?: ProjectManifestV2
  schemas: Record<string, TableSchemaFileV2>
  constraints: Record<string, ConstraintFileV2>
  regex_nodes: Record<string, RegexNodeFileV2>
  transforms?: Record<string, TransformFileV2>
  error?: string
}

export interface AiMigrateV2ConfigSource {
  content: string
  language: string
  name?: string
}

export interface AiMigrateV2ConfigRequest {
  script_content: string
  language: string
  sources?: AiMigrateV2ConfigSource[]
  file_paths: string[]
  project_name: string
  project_id: string
  provider_id?: string
  options: AiGenerateV2ConfigOptions
}

/**
 * 创建 AI 生成任务响应。
 */
export interface AiGenerateV2ConfigJobCreateResponse {
  job_id: string
}

/**
 * AI 生成任务状态枚举（与后端保持一致）。
 */
export type AiGenerateV2ConfigJobStatusValue =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * AI 生成任务状态查询响应。
 */
export interface AiGenerateV2ConfigJobStatus {
  job_id: string
  status: AiGenerateV2ConfigJobStatusValue
  stage?: string
  message?: string
  progress?: number
  iterations?: number
  max_iterations?: number
  metrics?: AiGenerateV2ConfigMetrics
  current_plan?: Array<Record<string, unknown>>
  checkpoints?: Array<Record<string, unknown>>
  received_chars: number
  warnings: string[]
  result?: AiGenerateV2ConfigResponse
  error?: string
}

/**
 * AI 模型模式配置（由后端配置文件提供）。
 */
export interface AiModelModes {
  basic: string
  advanced: string
  super: string
}

/**
 * 前端可选的模型模式枚举。
 */
export type AiModelModeKey = keyof AiModelModes

export interface AiHardwareRequirement {
  min_cpu_cores: number
  min_memory_gb: number
  min_disk_free_gb: number
  recommend_nvidia_gpu: boolean
}

export interface AiHardwareInfo {
  os_name: string
  os_version: string
  arch: string
  cpu_cores: number
  memory_total_gb: number
  disk_free_gb: number
  has_nvidia_gpu: boolean
}

export interface AiHardwareDiagnoseResponse {
  meets_requirements: boolean
  warnings: string[]
  requirement: AiHardwareRequirement
  info: AiHardwareInfo
}

/**
 * 云端 AI Provider 类型（简化版，后端只有 openai/ollama 两种协议）
 */
export type CloudAIProviderType = 'ollama' | 'openai'

/**
 * 云端 AI Provider 配置响应（不包含 api_key）
 */
export interface CloudAIProviderResponse {
  id: string
  name: string
  provider: CloudAIProviderType
  base_url?: string
  model: string
  api_version?: string
  azure_deployment?: string
  extra_params?: Record<string, string>
  enabled?: boolean
  is_configured?: boolean
  created_at?: string
  updated_at?: string
}

/**
 * 创建 Provider 请求
 */
export interface CreateProviderRequest {
  name: string
  type: CloudAIProviderType
  base_url: string
  api_key?: string
  model: string
}

/**
 * 更新 Provider 请求（所有字段可选）
 */
export interface UpdateProviderRequest {
  name?: string
  type?: CloudAIProviderType
  base_url?: string
  api_key?: string
  model?: string
}

/**
 * 服务商预设
 */
export interface ProviderPreset {
  id: string
  name: string
  type: CloudAIProviderType
  base_url: string
  default_model: string
  models: string[]
}

/**
 * 云端 AI Provider 测试连接结果
 */
export interface CloudAIProviderTestResponse {
  success: boolean
  message: string
  response_time_ms?: number
  error?: string
}

/**
 * 云端 AI Provider 配置信息
 * 用于前端展示配置文件路径和模板
 */
export interface CloudAIProviderConfigInfo {
  /** 当前使用的配置文件路径（如果不存在则为 null） */
  path: string | null
  /** 默认配置文件路径 */
  default_path: string
  /** 配置文件模板内容 */
  template: string
  /** 配置文件是否存在 */
  exists: boolean
}
