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
 *
 * 描述设置面板左侧导航的分组结构，
 * 每个分组包含一组相关的设置项。
 */
export interface SettingsNavGroup {
  /** 分组唯一标识 */
  id: string
  /** 分组显示名称 */
  label: string
  /** 分组图标类名（可选） */
  icon?: string
  /** 分组内的导航项列表 */
  items: SettingsNavItem[]
  /** 分组显示条件（可选，返回 false 时隐藏整个分组） */
  condition?: () => boolean
}

/**
 * 导航项接口
 *
 * 描述设置面板中的一个具体设置页签。
 */
export interface SettingsNavItem {
  /** 导航项唯一标识 */
  id: string
  /** 导航项显示名称 */
  label: string
  /** 导航项图标类名 */
  icon: string
  /** 对应渲染的组件名称 */
  component: string
  /** 兼容旧版的 Tab 标识（可选） */
  tab?: SettingsTab
}

/**
 * 通用设置接口
 *
 * 描述应用级别的通用偏好设置。
 */
export interface GeneralSettings {
  /** 启动时是否自动加载最近项目 */
  loadRecentProjectOnStartup: boolean
  /** 界面语言 */
  language: 'zh-CN' | 'en-US'
  /** 主题模式 */
  theme: 'light' | 'dark' | 'system'
}

/**
 * 校验行为设置接口（与后端 API snake_case 命名一致）
 */
export interface ValidationSettings {
  /** 是否开启自动校验 */
  auto_validate: boolean
  /** 是否启用严格模式 */
  strict_mode: boolean
  /** 错误处理方式：停止 / 继续 / 仅报告 */
  error_handling: 'stop' | 'continue' | 'report'
  /** 超时时间（秒） */
  timeout_seconds: number
  /** 批量处理最大文件数 */
  batch_max_files: number
}

/**
 * 文件处理设置接口（与后端 API snake_case 命名一致）
 */
export interface FileProcessingSettings {
  /** 默认文件编码 */
  default_encoding: 'utf-8' | 'gbk' | 'auto'
  /** CSV 分隔符 */
  csv_delimiter: string
  /** 空值处理策略 */
  null_value_strategy: 'null' | 'empty' | 'default'
  /** 日期格式字符串 */
  date_format: string
}

/**
 * 脚本安全设置接口（与后端 API snake_case 命名一致）
 */
export interface ScriptSecuritySettings {
  /** 是否允许 eval 执行 */
  allow_eval: boolean
  /** 是否允许 exec 执行 */
  allow_exec: boolean
  /** 是否启用沙箱模式 */
  sandbox_mode: boolean
  /** 脚本超时时间（秒） */
  timeout_seconds: number
}

/**
 * 项目设置接口（从后端 YAML 文件持久化）
 *
 * 聚合校验、文件处理和脚本安全三类设置，
 * 对应 project.precis.yaml 中的 settings 字段。
 */
export interface ProjectSettings {
  /** 校验行为设置 */
  validation: ValidationSettings
  /** 文件处理设置 */
  file_processing: FileProcessingSettings
  /** 脚本安全设置 */
  script_security: ScriptSecuritySettings
}

/**
 * 脚本设置接口
 *
 * 描述前端脚本功能的启用状态及安全警告配置。
 */
export interface ScriptSettings {
  /** 是否启用脚本功能 */
  enabled: boolean
  /** 是否需要管理员权限 */
  requireAdmin: boolean
  /** 是否显示不安全 eval 警告 */
  unsafeEvalWarning: boolean
  /** 上次警告时间戳（用于控制警告频率） */
  lastWarningTimestamp: number | null
}

/**
 * 开发设置接口
 *
 * 描述开发阶段的功能开关。
 */
export interface DevSettings {
  /** 是否启用团队功能 */
  teamFeaturesEnabled: boolean
}

// ============================================================================
// 默认值
// ============================================================================

/** 校验行为默认设置 */
export const defaultValidationSettings: ValidationSettings = {
  auto_validate: true,
  strict_mode: false,
  error_handling: 'continue',
  timeout_seconds: 30,
  batch_max_files: 100,
}

/** 文件处理默认设置 */
export const defaultFileProcessingSettings: FileProcessingSettings = {
  default_encoding: 'utf-8',
  csv_delimiter: ',',
  null_value_strategy: 'null',
  date_format: '%Y-%m-%d',
}

/** 脚本安全默认设置 */
export const defaultScriptSecuritySettings: ScriptSecuritySettings = {
  allow_eval: false,
  allow_exec: false,
  sandbox_mode: true,
  timeout_seconds: 10,
}

/** 项目设置默认值（聚合三类子设置） */
export const defaultProjectSettings: ProjectSettings = {
  validation: defaultValidationSettings,
  file_processing: defaultFileProcessingSettings,
  script_security: defaultScriptSecuritySettings,
}

/** 脚本功能默认设置 */
export const defaultScriptSettings: ScriptSettings = {
  enabled: false,
  requireAdmin: false,
  unsafeEvalWarning: true,
  lastWarningTimestamp: null,
}

/** 通用设置默认值 */
export const defaultGeneralSettings: GeneralSettings = {
  loadRecentProjectOnStartup: true,
  language: 'zh-CN',
  theme: 'system',
}

/** 开发设置默认值 */
export const defaultDevSettings: DevSettings = {
  teamFeaturesEnabled: false,
}

// ============================================================================
// Tab → NavItem 映射（兼容层）
// ============================================================================

/**
 * 旧版 SettingsTab 到新版 NavItem ID 的映射表
 *
 * 用于兼容旧版基于 Tab 的路由/状态，迁移到新版基于 NavItem 的结构。
 */
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

/**
 * 新版 NavItem ID 到旧版 SettingsTab 的反向映射表
 *
 * 支持从 NavItem ID 还原为旧版 Tab 标识，用于兼容层转换。
 */
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
