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

/**
 * 文件预览请求接口
 *
 * 用于请求后端对指定文件进行预览解析。
 */
export interface FilePreviewRequest {
  /** 文件绝对路径 */
  file_path: string
  /** 最大预览行数（可选） */
  max_rows?: number
  /** 最大预览列数（可选） */
  max_cols?: number
}

/**
 * 文件预览响应接口
 *
 * 包含预览表格数据、文件元数据及错误信息。
 */
export interface FilePreviewResponse {
  /** 预览是否成功 */
  success: boolean
  /** 完整的表格数据，包含表头行 */
  data?: string[][]
  /** 文件类型（如 csv、excel） */
  file_type: string
  /** 文件名称 */
  file_name: string
  /** 总行数（可选） */
  total_rows?: number
  /** 总列数（可选） */
  total_cols?: number
  /** Excel 文件的工作表列表 */
  sheets?: string[]
  /** 当前选中的工作表 */
  current_sheet?: string
  /** 错误信息（如有） */
  error?: string
}

// ============================================================================
// Pattern 管理
// ============================================================================

/**
 * 创建 Pattern 请求接口
 */
export interface CreatePatternRequest {
  /** Pattern 名称 */
  name: string
  /** 正则表达式 */
  regex: string
  /** 描述（可选） */
  description?: string
  /** 输出配置（可选） */
  output?: Record<string, unknown>
  /** 是否覆盖已存在的同名 Pattern */
  overwrite?: boolean
}

/**
 * 创建 Pattern 响应接口
 */
export interface CreatePatternResponse {
  /** 操作结果消息 */
  message: string
  /** Pattern 文件路径 */
  pattern_path: string
  /** Pattern 名称 */
  pattern_name: string
}

// ============================================================================
// 校验任务
// ============================================================================

/**
 * 校验任务目标类型
 *
 * - full_project: 全项目校验
 * - single_table: 单表校验
 * - single_file: 单文件校验
 */
export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

/**
 * 校验任务目标接口
 *
 * 描述校验任务的作用范围。
 */
export interface ValidationTaskTarget {
  /** 目标类型 */
  type: ValidationTaskTargetType
  /** 表 ID（单表校验时必填） */
  table_id?: string
  /** 文件路径（单文件校验时必填） */
  file_path?: string
}

/**
 * 校验行为设置覆盖接口
 *
 * 所有字段均为可选，用于在单次校验请求中临时覆盖项目默认设置。
 */
export interface ValidationSettingsOverride {
  /** 是否开启自动校验 */
  auto_validate?: boolean
  /** 是否启用严格模式 */
  strict_mode?: boolean
  /** 错误处理方式 */
  error_handling?: 'stop' | 'continue' | 'report'
  /** 超时时间（秒） */
  timeout_seconds?: number
  /** 批量处理最大文件数 */
  batch_max_files?: number
}

/**
 * 文件处理设置覆盖接口
 *
 * 所有字段均为可选，用于在单次校验请求中临时覆盖项目默认设置。
 */
export interface FileProcessingSettingsOverride {
  /** 默认文件编码 */
  default_encoding?: 'utf-8' | 'auto' | 'gbk'
  /** CSV 分隔符 */
  csv_delimiter?: string
}

/**
 * 脚本安全设置覆盖接口
 *
 * 所有字段均为可选，用于在单次校验请求中临时覆盖项目默认设置。
 */
export interface ScriptSecuritySettingsOverride {
  /** 是否允许 eval 执行 */
  allow_eval?: boolean
  /** 是否允许 exec 执行 */
  allow_exec?: boolean
  /** 是否启用沙箱模式 */
  sandbox_mode?: boolean
  /** 脚本超时时间（秒） */
  timeout_seconds?: number
}

/**
 * 项目设置覆盖接口
 *
 * 聚合三类可覆盖设置，用于在单次校验请求中临时调整行为。
 */
export interface ProjectSettingsOverride {
  /** 校验行为覆盖 */
  validation?: ValidationSettingsOverride
  /** 文件处理覆盖 */
  file_processing?: FileProcessingSettingsOverride
  /** 脚本安全覆盖 */
  script_security?: ScriptSecuritySettingsOverride
}

/**
 * 全量校验请求接口
 */
export interface FullValidationRequest {
  /** 数据目录路径 */
  data_directory: string
  /** 设置覆盖（可选） */
  settings_override?: ProjectSettingsOverride
  /** 表过滤条件：单表 ID 或表 ID 数组（可选） */
  table_filter?: string | string[]
}

/**
 * 全量校验响应接口
 *
 * 包含原始数据集、解析后数据集、各类错误及校验详情。
 */
export interface FullValidationResponse {
  /** 原始数据集映射 */
  raw_datasets: Record<string, unknown>
  /** 解析后的数据集映射 */
  parsed_datasets: Record<string, unknown>
  /** 校验错误列表 */
  errors: Array<Record<string, unknown>>
  /** 数据加载错误列表 */
  loading_errors: Array<Record<string, unknown>>
  /** 校验耗时（毫秒） */
  duration_ms: number
  /** 是否发生超时 */
  timeout_occurred: boolean
  /** 校验详情 */
  validation_details: {
    /** 格式检查结果 */
    format_checks: Array<Record<string, unknown>>
    /** 约束检查结果 */
    constraint_checks: Array<Record<string, unknown>>
  }
}
