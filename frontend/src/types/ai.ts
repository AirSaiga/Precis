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
import i18n from '@/i18n'

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
  | 'canceled'

/**
 * AI 生成任务状态查询响应。
 */
export interface AiGenerateV2ConfigJobStatus {
  job_id: string
  status: AiGenerateV2ConfigJobStatusValue
  stage?: string
  message?: string
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
 * 云端 AI Provider 类型
 */
export type CloudAIProviderType =
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'azure_openai'
  | 'anthropic'
  | 'custom'
  | 'glm'
  | 'minimax'
  | 'kimi'
  | 'deepseek'
  | 'qwen'

/**
 * 云端 AI Provider 显示名称映射
 */
export const CloudAIProviderNames: Record<CloudAIProviderType, string> = {
  get ollama() {
    return i18n.global.t('cloudAI.providerTypes.ollama')
  },
  get openai() {
    return i18n.global.t('cloudAI.providerTypes.openai')
  },
  get openrouter() {
    return i18n.global.t('cloudAI.providerTypes.openrouter')
  },
  get azure_openai() {
    return i18n.global.t('cloudAI.providerTypes.azure_openai')
  },
  get anthropic() {
    return i18n.global.t('cloudAI.providerTypes.anthropic')
  },
  get custom() {
    return i18n.global.t('cloudAI.providerTypes.custom')
  },
  get glm() {
    return i18n.global.t('cloudAI.providerTypes.glm')
  },
  get minimax() {
    return i18n.global.t('cloudAI.providerTypes.minimax')
  },
  get kimi() {
    return i18n.global.t('cloudAI.providerTypes.kimi')
  },
  get deepseek() {
    return i18n.global.t('cloudAI.providerTypes.deepseek')
  },
  get qwen() {
    return i18n.global.t('cloudAI.providerTypes.qwen')
  },
}

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
  is_configured?: boolean // 是否已配置（有 API Key）
  created_at?: string
  updated_at?: string
}

/**
 * 云端 AI Provider 添加/更新请求
 */
export interface CloudAIProviderRequest {
  name: string
  provider_type: CloudAIProviderType
  api_key: string
  base_url?: string
  model: string
  api_version?: string
  deployment?: string
  extra_params?: Record<string, string>
  is_default?: boolean
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
