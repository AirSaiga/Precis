/**
 * @file settings.ts
 * @description 设置相关类型定义与默认值
 *
 * 从 settingsStore.ts 提取，供多个 Store 和组件共享，
 * 避免 Store 间循环依赖。
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 旧版设置面板页签类型（保留兼容）
 */
export type SettingsTab =
  | 'general'
  | 'shortcuts'
  | 'script'
  | 'project'
  | 'file-processing'
  | 'connection-rules'
  | 'project-info'
  | 'update'
  | 'ai-assistant'

/**
 * 导航分组接口
 */
export interface SettingsNavGroup {
  id: string
  label: string
  icon: string
  items: SettingsNavItem[]
  condition?: () => boolean
}

/**
 * 导航项接口
 */
export interface SettingsNavItem {
  id: string
  label: string
  icon: string
  component: string
  tab?: SettingsTab // 兼容旧版 Tab
}

/**
 * 通用设置接口
 */
export interface GeneralSettings {
  loadRecentProjectOnStartup: boolean
  language: 'zh-CN' | 'en-US'
  theme: 'light' | 'dark' | 'system'
}

/**
 * 校验行为设置接口（与后端 API snake_case 命名一致）
 */
export interface ValidationSettings {
  auto_validate: boolean
  strict_mode: boolean
  error_handling: 'stop' | 'continue' | 'report'
  timeout_seconds: number
  batch_max_files: number
}

/**
 * 文件处理设置接口（与后端 API snake_case 命名一致）
 */
export interface FileProcessingSettings {
  default_encoding: 'utf-8' | 'gbk' | 'auto'
  csv_delimiter: string
  null_value_strategy: 'null' | 'empty' | 'default'
  date_format: string
}

/**
 * 脚本安全设置接口（与后端 API snake_case 命名一致）
 */
export interface ScriptSecuritySettings {
  allow_eval: boolean
  allow_exec: boolean
  sandbox_mode: boolean
  timeout_seconds: number
}

/**
 * 项目设置接口（从后端 YAML 文件持久化）
 */
export interface ProjectSettings {
  validation: ValidationSettings
  file_processing: FileProcessingSettings
  script_security: ScriptSecuritySettings
}

/**
 * 脚本设置接口
 */
export interface ScriptSettings {
  enabled: boolean
  requireAdmin: boolean
  unsafeEvalWarning: boolean
  lastWarningTimestamp: number | null
}

/**
 * 开发设置接口
 */
export interface DevSettings {
  teamFeaturesEnabled: boolean
}

// ============================================================================
// 默认值
// ============================================================================

export const defaultValidationSettings: ValidationSettings = {
  auto_validate: true,
  strict_mode: false,
  error_handling: 'continue',
  timeout_seconds: 30,
  batch_max_files: 100,
}

export const defaultFileProcessingSettings: FileProcessingSettings = {
  default_encoding: 'utf-8',
  csv_delimiter: ',',
  null_value_strategy: 'null',
  date_format: '%Y-%m-%d',
}

export const defaultScriptSecuritySettings: ScriptSecuritySettings = {
  allow_eval: false,
  allow_exec: false,
  sandbox_mode: true,
  timeout_seconds: 10,
}

export const defaultProjectSettings: ProjectSettings = {
  validation: defaultValidationSettings,
  file_processing: defaultFileProcessingSettings,
  script_security: defaultScriptSecuritySettings,
}

export const defaultScriptSettings: ScriptSettings = {
  enabled: false,
  requireAdmin: false,
  unsafeEvalWarning: true,
  lastWarningTimestamp: null,
}

export const defaultGeneralSettings: GeneralSettings = {
  loadRecentProjectOnStartup: true,
  language: 'zh-CN',
  theme: 'system',
}

export const defaultDevSettings: DevSettings = {
  teamFeaturesEnabled: false,
}

// ============================================================================
// Tab → NavItem 映射（兼容层）
// ============================================================================

export const TAB_TO_NAV_ITEM_MAP: Record<SettingsTab, string> = {
  general: 'general',
  shortcuts: 'shortcuts',
  script: 'script-security',
  project: 'validation-params',
  'file-processing': 'file-processing',
  'connection-rules': 'connection-rules',
  'project-info': 'project-overview',
  update: 'update',
  'ai-assistant': 'ai-assistant',
}

export const NAV_ITEM_TO_TAB_MAP: Record<string, SettingsTab> = {
  general: 'general',
  shortcuts: 'shortcuts',
  'script-security': 'script',
  'validation-params': 'project',
  'file-processing': 'file-processing',
  'connection-rules': 'connection-rules',
  'project-overview': 'project-info',
  'data-sources': 'project-info',
  update: 'update',
  'ai-assistant': 'ai-assistant',
}
