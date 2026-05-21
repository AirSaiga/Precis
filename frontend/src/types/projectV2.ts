/**
 * @file projectV2.ts
 * @description V2 项目配置（前端类型）
 *
 * 与后端 backend/app/core/project/ 目录保持结构一致，用于：
 * - Graph ⇄ V2 配置的序列化/反序列化
 * - V2 API 调用的请求/响应类型
 *
 * 字段层级说明：
 * - L1（核心）：用户必须理解的字段
 * - L2（可选）：用户可能需要调整的字段
 * - L3（内部）：程序生成，人为编辑可忽略
 *
 * 约束配置说明：
 * 支持两种约束配置方式：
 * 1. 独立文件：constraints/*.constraint.yaml
 * 2. 内嵌约束：直接在 schema.yaml 的 constraints 字段中定义
 */

// ============================================================================
// L3 - 内部类型（前端使用）
// ============================================================================

export interface RegexNodeInternalV2 {
  parameters: Array<Record<string, unknown>>
  rules: Array<Record<string, unknown>>
  source_ref?: RegexSourceRefV2
  flags: string
  case_sensitive: boolean
}

export interface SchemaInternalV2 {
  expand: boolean
  script_checks: Array<Record<string, unknown>>
}

// ============================================================================
// L1 - 核心类型（用户需要理解）
// ============================================================================

export type SourceModeV2 = 'relative_file' | 'absolute_file'

export interface ProjectInfoV2 {
  id: string
  name: string
}

/**
 * JSON 格式选项（对应后端 JSONOptions）
 */
export interface JSONOptionsV2 {
  format?: 'auto' | 'array' | 'lines' | 'object'
  json_path?: string
  record_path?: string
  meta_prefix?: string
  sep?: string
  dtype?: Record<string, string>
}

/**
 * CSV 格式选项
 */
export interface CSVOptionsV2 {
  delimiter?: string
  quotechar?: string
  escapechar?: string
  encoding?: string
  skip_rows?: number
  on_bad_lines?: 'error' | 'warn' | 'skip'
}

/**
 * Excel 格式选项
 */
export interface ExcelOptionsV2 {
  engine?: 'openpyxl' | 'xlrd'
  dtype_inference?: boolean
}

/**
 * 格式选项联合类型
 */
export type FormatOptionsV2 = JSONOptionsV2 | CSVOptionsV2 | ExcelOptionsV2

export interface SourceSpecV2 {
  mode: SourceModeV2
  path: string
  sheet?: string
  header_row: number
  /** 格式特定选项（JSON/CSV/Excel）*/
  options?: FormatOptionsV2
}

/** 后端列类型：字符串或对象配置（如 Expr / Extracted） */
export type BackendColumnTypeV2 = string | Record<string, unknown>

export interface ColumnSpecV2 {
  id: string
  name: string
  type: BackendColumnTypeV2
  primary_key?: boolean
  /** 是否允许为空（对应后端 ColumnSpec.nullable） */
  nullable?: boolean
  expand?: boolean
  /** JSON 列的 JSONPath 路径 */
  json_path?: string
}

// ============================================================================
// 内嵌约束类型（可直接在 schema.yaml 中定义）
// ============================================================================

export type ConstraintTypeV2 =
  | 'NotNull'
  | 'Unique'
  | 'AllowedValues'
  | 'ForeignKey'
  | 'Conditional'
  | 'Scripted'
  | 'Range'
  | 'Charset'
  | 'DateLogic'
  | 'Composite'

export interface ConstraintItemV2 {
  /** 约束 ID（同一表内必须唯一） */
  id: string

  /** 约束类型 */
  type: ConstraintTypeV2

  /** 是否启用 */
  enabled?: boolean

  /** 约束描述 */
  description?: string

  /** 目标列名（简化写法） */
  column?: string

  /** 目标列名列表（多列约束） */
  columns?: string[]

  /** 外键源表名 */
  from_table?: string

  /** 外键源列名 */
  from_column?: string

  /** 外键目标表名 */
  to_table?: string

  /** 外键目标列名 */
  to_column?: string

  /** 约束参数（如 allowed_values 等） */
  params?: Record<string, unknown>
}

// ============================================================================
// V2 Schema 配置
// ============================================================================

export interface TableSchemaFileV2 {
  /** L1 - 核心：配置版本（固定为 2） */
  version: number

  /** L1 - 核心：表 ID */
  id: string

  /** L1 - 核心：表名称 */
  name: string

  /** L1 - 核心：数据源描述 */
  source?: SourceSpecV2

  /** L2 - 可选：Excel Sheet 名称（后端也支持顶层 sheet 字段） */
  sheet?: string

  /** L1 - 核心：列定义列表 */
  columns: ColumnSpecV2[]

  /** L1 - 内嵌约束列表（可直接在 schema.yaml 中定义） */
  constraints?: ConstraintItemV2[]

  script_checks?: unknown[]

  /** L3 - 内部：前端专用配置 */
  _internal?: SchemaInternalV2
}

export interface SchemaRefV2 {
  id: string
  path: string
}

export type SchemaSaveMode = 'create' | 'merge' | 'overwrite'

export interface SchemaConflictInfo {
  exists: boolean
  file_path: string
  has_conflict: boolean
  conflict_fields: string[]
  existing_schema?: Record<string, unknown>
  new_schema?: Record<string, unknown>
}

export interface ConstraintRefV2 {
  id: string
  path: string
}

export interface RegexNodeRefV2 {
  id: string
  path: string
}

export interface TransformRefV2 {
  id: string
  path: string
}

export type TransformTypeV2 =
  | 'StringSplit'
  | 'RegexExtract'
  | 'MathExpr'
  | 'DateFormat'
  | 'Lookup'
  | 'Strip'
  | 'UpperCase'
  | 'LowerCase'
  | 'Replace'
  | 'FilterRows'
  | 'FillNA'
  | 'DropDuplicates'
  | 'CastType'
  | 'Concat'
  | 'Substring'
  | 'Aggregate'
  | 'ConditionalAssign'
  | 'SortRows'
  // 原子化校验操作
  | 'Digits'
  | 'WeightedSum'
  | 'Modulo'
  | 'MapValue'

export interface DataSourceRefV2 {
  /** 数据源唯一标识符 */
  id: string
  /** 数据源目录路径 */
  path: string
  /** 路径模式: 'relative'（相对项目目录）或 'absolute'（绝对路径） */
  mode: 'relative' | 'absolute'
  /** 数据源描述（可选） */
  description?: string
}

export interface TemplateRefV2 {
  id: string
  path: string
}

export interface TemplateInstanceRefV2 {
  id: string
  template_id: string
  enabled: boolean
  input_from_node: string
  params: Record<string, unknown>
}

export interface ProjectManifestV2 {
  version: number
  project: ProjectInfoV2
  /** 项目设置（后端始终返回，前端创建时需提供默认值） */
  settings: ProjectSettings
  schemas: SchemaRefV2[]
  constraints: ConstraintRefV2[]
  regex_nodes: RegexNodeRefV2[]
  transforms: TransformRefV2[]
  data_sources?: DataSourceRefV2[]
  templates?: TemplateRefV2[]
  template_instances?: TemplateInstanceRefV2[]
  patterns_dir: string
  warnings?: string[]
}

export interface ConstraintFileV2 {
  version: number
  id: string
  type: ConstraintTypeV2
  enabled: boolean
  description?: string
  refs: Record<string, unknown>
  params: Record<string, unknown>
  /** 上游数据流节点 ID（优先于 Schema 引用） */
  input_from_node?: string
}

export interface TransformFileV2 {
  version: number
  id: string
  name?: string
  type: TransformTypeV2
  enabled: boolean
  description?: string
  /** 上游数据流节点 ID */
  input_from_node?: string
  /** 上游节点中的目标列名 */
  input_column?: string
  /** 转换参数（因类型而异） */
  params: Record<string, unknown>
  /** 转换后产生的列名列表 */
  output_columns: string[]
}

export interface RegexSourceRefV2 {
  table_id: string
  column_id: string
}

export type PatternRegistryTypeV2 = 'patterns'

export interface PatternRefV2 {
  registry: PatternRegistryTypeV2
  pattern_name: string
  as_alias?: string
}

// ============================================================================
// V2 Regex 节点配置
// ============================================================================

export interface RegexNodeFileV2 {
  /** L1 - 核心：节点名称（展示用） */
  name: string

  /** L1 - 核心：功能描述 */
  description?: string

  /** L1 - 核心：直接编写正则表达式（与 uses_pattern 二选一） */
  pattern?: string

  /** L1 - 核心：引用已注册的表达式模式（与 pattern 二选一） */
  uses_pattern?: PatternRefV2

  /** L2 - 可选：对引用表达式的覆盖配置 */
  pattern_overrides?: Record<string, unknown>

  /** L2 - 可选：匹配模式 */
  match_mode: 'full' | 'partial' | 'extract'

  /** L2 - 可选：是否启用 */
  enabled: boolean

  case_sensitive?: boolean
  flags?: string
  parameters?: unknown[]
  rules?: unknown[]

  /** 数据流输入接口 */
  input_from_node?: string
  input_column?: string

  /** Extract 模式专用：捕获组定义 */
  capture_groups?: Array<{ name: string; group_index: number }>
  /** Extract 模式专用：输出列名 */
  output_columns?: string[]

  source_ref?: RegexSourceRefV2
  source_column_name?: string

  /** L3 - 内部：配置版本（程序生成） */
  version: number

  /** L3 - 内部：节点 ID（程序生成） */
  id: string

  /** L3 - 内部：前端专用配置 */
  _internal?: RegexNodeInternalV2
}

export interface FullConfigV2Response {
  manifest: ProjectManifestV2
  effective_manifest?: ProjectManifestV2
  schemas: Record<string, TableSchemaFileV2>
  constraints: Record<string, ConstraintFileV2>
  regex_registries: Record<string, unknown>
  regex_nodes: Record<string, RegexNodeFileV2>
  transforms: Record<string, TransformFileV2>
  coverage?: {
    is_complete: boolean
    unlisted: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
    dangling: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
  } | null
  manifest_modified?: boolean
  /** Schema 文件解析错误映射: schema_id -> 错误信息 */
  schema_errors?: Record<string, string>
}

export interface FullConfigV2Request {
  manifest: ProjectManifestV2
  schemas: Record<string, TableSchemaFileV2>
  constraints: Record<string, ConstraintFileV2>
  regex_nodes: Record<string, RegexNodeFileV2>
  transforms: Record<string, TransformFileV2>
}

// ============================================================================
// V2 项目视图（前端画布布局）配置
// ============================================================================

/**
 * V2 项目视图文件
 *
 * 设计目标：
 * - 将“画布布局（节点坐标/视口）”与“校验语义配置（schema/constraint/regex）”解耦
 * - 避免把 UI 相关信息写入后端全量校验所需的配置文件
 */
export interface ProjectViewV2 {
  /** 视图版本号，用于未来扩展兼容 */
  version: number
  /** 节点坐标映射：nodeId -> position */
  nodes: Record<string, { x: number; y: number }>
  /** 可选视口信息（不强依赖，缺省时前端使用默认缩放） */
  viewport?: { x: number; y: number; zoom: number }
}

// ============================================================================
// 项目设置类型（从前端设置面板持久化到 project.precis.yaml）
// ============================================================================

export interface ValidationSettings {
  auto_validate: boolean
  strict_mode: boolean
  error_handling: 'stop' | 'continue' | 'report'
  timeout_seconds: number
  batch_max_files: number
}

export type ValidationRunSettings = ValidationSettings

export interface FileProcessingSettings {
  default_encoding: 'utf-8' | 'gbk' | 'auto'
  csv_delimiter: string
  null_value_strategy: 'null' | 'empty' | 'default'
  date_format: string
}

export interface ScriptSecuritySettings {
  allow_eval: boolean
  allow_exec: boolean
  sandbox_mode: boolean
  timeout_seconds: number
}

export interface ProjectSettings {
  validation: ValidationSettings
  file_processing: FileProcessingSettings
  script_security: ScriptSecuritySettings
}

export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

export interface ValidationTaskTarget {
  type: ValidationTaskTargetType
  table_id?: string | null
  file_path?: string | null
  display_name?: string | null
}

// ============================================================================
// 约束配置示例
// ============================================================================

// ============================================================================
// 工作区类型
// ============================================================================

export interface WorkspaceV2Viewport {
  x?: number
  y?: number
  zoom?: number
}

export interface WorkspaceV2Item {
  id: string
  title: string
  index: number
  createdAt: string
  lastActiveAt: string
  visibleNodeIds: string[]
  viewport?: WorkspaceV2Viewport
}

export interface WorkspacesV2Response {
  version: number
  activeWorkspaceId: string | null
  workspaces: WorkspaceV2Item[]
}

/**
 * 内嵌约束示例（直接在 schema.yaml 中定义）：
 *
 * constraints:
 *   - id: email_notnull
 *     type: NotNull
 *     column: email
 *   - id: gender_allowed
 *     type: AllowedValues
 *     column: gender
 *     params:
 *       allowed_values: [男, 女]
 *   - id: username_unique
 *     type: Unique
 *     columns: [username]
 *
 * 独立文件示例（constraints/users_email_notnull.constraint.yaml）：
 *
 * version: 2
 * id: users_email_notnull
 * type: NotNull
 * enabled: true
 * description: 用户邮箱不能为空
 * refs:
 *   table_id: users
 *   column_id: email
 * params: {}
 */
