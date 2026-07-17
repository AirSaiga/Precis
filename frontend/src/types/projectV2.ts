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

/**
 * Regex 节点内部配置（L3 - 前端内部使用）。
 *
 * 存储 Regex 节点的前端专用内部配置，不直接暴露给用户编辑。
 */
export interface RegexNodeInternalV2 {
  /** 正则参数列表 */
  parameters: Array<Record<string, unknown>>
  /** 正则规则列表 */
  rules: Array<Record<string, unknown>>
  /** 源引用信息 */
  source_ref?: RegexSourceRefV2
  /** 正则标志位（如 'g', 'i', 'm' 等） */
  flags: string
  /** 是否区分大小写 */
  case_sensitive: boolean
}

/**
 * Schema 内部配置（L3 - 前端内部使用）。
 */
export interface SchemaInternalV2 {
  /** 是否展开列详情面板 */
  expand: boolean
  /** 脚本检查配置列表 */
  script_checks: Array<Record<string, unknown>>
}

// ============================================================================
// L1 - 核心类型（用户需要理解）
// ============================================================================

/**
 * 数据源路径模式。
 *
 * @values
 * - 'relative_file': 相对项目目录的文件路径
 * - 'absolute_file': 本地文件系统的绝对路径
 */
export type SourceModeV2 = 'relative_file' | 'absolute_file'

/**
 * 项目基本信息。
 */
export interface ProjectInfoV2 {
  /** 项目唯一标识符 */
  id: string
  /** 项目名称 */
  name: string
}

/**
 * JSON 格式选项（对应后端 JSONOptions）。
 *
 * 用于配置 pandas read_json 的解析行为。
 */
export interface JSONOptionsV2 {
  /**
   * JSON 格式变体
   * @values
   * - 'auto': 自动检测
   * - 'array': JSON 数组格式
   * - 'lines': JSON Lines 格式
   * - 'object': JSON 对象格式
   */
  format?: 'array' | 'lines' | 'object'
  /** JSONPath 表达式，用于从嵌套 JSON 中提取数据 */
  json_path?: string
  /** record_path，用于 pandas read_json 的 record_path 参数 */
  record_path?: string
  /** 元数据前缀，用于区分元数据列 */
  meta_prefix?: string
  /** 分隔符（用于 lines 格式） */
  sep?: string
  /** 列数据类型映射 */
  dtype?: Record<string, string>
}

/**
 * CSV 格式选项。
 *
 * 用于配置 pandas read_csv 的解析行为。
 */
export interface CSVOptionsV2 {
  /** 字段分隔符 */
  delimiter?: string
  /** 引号字符 */
  quotechar?: string
  /** 转义字符 */
  escapechar?: string
  /** 文件编码 */
  encoding?: string
  /** 跳过的行数 */
  skip_rows?: number
  /**
   * 遇到坏行时的处理方式
   * @values
   * - 'error': 抛出错误
   * - 'warn': 发出警告并跳过
   * - 'skip': 静默跳过
   */
  on_bad_lines?: 'error' | 'warn' | 'skip'
}

/**
 * Excel 格式选项。
 *
 * 用于配置 pandas read_excel 的解析行为。
 */
export interface ExcelOptionsV2 {
  /**
   * Excel 解析引擎
   * @values
   * - 'openpyxl': 现代 Excel 格式（.xlsx）
   * - 'xlrd': 旧版 Excel 格式（.xls）
   */
  engine?: 'openpyxl' | 'xlrd'
  /** 是否启用数据类型推断 */
  dtype_inference?: boolean
}

/**
 * 格式选项联合类型。
 *
 * 根据数据源类型选择对应的格式选项配置。
 */
export type FormatOptionsV2 = JSONOptionsV2 | CSVOptionsV2 | ExcelOptionsV2

/**
 * 数据源规格定义。
 *
 * 描述 Schema 所引用的外部数据源文件的位置和解析方式。
 */
export interface SourceSpecV2 {
  /** 路径模式：相对路径或绝对路径 */
  mode: SourceModeV2
  /** 文件路径 */
  path: string
  /** Excel Sheet 名称（仅 Excel 有效） */
  sheet?: string
  /** 表头所在行索引（0-based） */
  header_row: number
  /** 格式特定选项（JSON/CSV/Excel） */
  options?: FormatOptionsV2
}

/**
 * 后端列类型。
 *
 * 可以是简单的字符串类型名，也可以是对象配置（如表达式列、提取列）。
 */
export type BackendColumnTypeV2 = string | Record<string, unknown>

/**
 * 列规格定义。
 *
 * 描述 Schema 中单个列的结构和属性。
 */
export interface ColumnSpecV2 {
  /** 列唯一标识符 */
  id: string
  /** 列名称 */
  name: string
  /** 列数据类型（字符串或对象配置） */
  type: BackendColumnTypeV2
  /** 是否为主键 */
  primary_key?: boolean
  /** 是否允许为空（对应后端 ColumnSpec.nullable） */
  nullable?: boolean
  /** 是否展开列详情（UI 状态） */
  expand?: boolean
  /** JSON 列的 JSONPath 路径 */
  json_path?: string
  /** JSON 嵌套子列（树形结构） */
  children?: ColumnSpecV2[]
}

// ============================================================================
// 内嵌约束类型（可直接在 schema.yaml 中定义）
// ============================================================================

/**
 * 约束类型枚举。
 *
 * 对应后端支持的约束种类，用于 ConstraintItemV2 和 ConstraintFileV2 的 type 字段。
 *
 * @values
 * - 'NotNull': 非空约束
 * - 'Unique': 唯一约束
 * - 'AllowedValues': 允许值约束
 * - 'ForeignKey': 外键约束
 * - 'Conditional': 条件约束
 * - 'Scripted': 脚本约束
 * - 'Range': 区间约束
 * - 'Charset': 字符集约束
 * - 'DateLogic': 日期逻辑约束
 * - 'Composite': 复合约束
 */
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

/**
 * 内嵌约束项定义。
 *
 * 可直接在 schema.yaml 的 constraints 字段中定义，无需单独创建约束文件。
 */
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

  /** 约束参数（如 allowed_values 等，因约束类型而异） */
  params?: Record<string, unknown>
}

// ============================================================================
// V2 Schema 配置
// ============================================================================

/**
 * Schema 配置文件结构（*.schema.yaml）。
 *
 * 定义数据表的完整结构，包括数据源引用、列定义和内嵌约束。
 */
export interface TableSchemaFileV2 {
  /** L1 - 核心：配置版本（固定为 2） */
  version: number

  /** L1 - 核心：表唯一标识符 */
  id: string

  /** L1 - 核心：表名称 */
  name: string

  /** L1 - 核心：数据源规格描述 */
  source?: SourceSpecV2

  /** L2 - 可选：Excel Sheet 名称（后端也支持顶层 sheet 字段） */
  sheet?: string

  /** L1 - 核心：列定义列表 */
  columns: ColumnSpecV2[]

  /** L1 - 内嵌约束列表（可直接在 schema.yaml 中定义） */
  constraints?: ConstraintItemV2[]

  /** 脚本检查配置列表 */
  script_checks?: unknown[]

  /** L3 - 内部：前端专用配置 */
  _internal?: SchemaInternalV2
}

/**
 * Schema 资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Schema 文件。
 */
export interface SchemaRefV2 {
  /** Schema 唯一标识符 */
  id: string
  /** Schema 文件路径（相对于项目目录） */
  path: string
}

/**
 * Schema 保存模式。
 *
 * @values
 * - 'create': 创建新文件（文件必须不存在）
 * - 'merge': 合并到现有文件（保留现有字段，覆盖冲突字段）
 * - 'overwrite': 覆盖现有文件（完全替换）
 */
export type SchemaSaveMode = 'create' | 'merge' | 'overwrite'

/**
 * Schema 冲突信息。
 *
 * 在保存 Schema 时检测到的冲突详情，用于前端展示差异对比。
 */
export interface SchemaConflictInfo {
  /** 文件是否已存在 */
  exists: boolean
  /** 现有文件路径 */
  file_path: string
  /** 是否存在字段冲突 */
  has_conflict: boolean
  /** 冲突字段列表 */
  conflict_fields: string[]
  /** 现有 Schema 内容（用于对比） */
  existing_schema?: Record<string, unknown>
  /** 新 Schema 内容（用于对比） */
  new_schema?: Record<string, unknown>
}

/**
 * 约束资源引用。
 *
 * 用于在 project.precis.yaml 中索引约束文件。
 */
export interface ConstraintRefV2 {
  /** 约束唯一标识符 */
  id: string
  /** 约束文件路径（相对于项目目录） */
  path: string
}

/**
 * Regex 节点资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Regex 节点文件。
 */
export interface RegexNodeRefV2 {
  /** Regex 节点唯一标识符 */
  id: string
  /** Regex 节点文件路径（相对于项目目录） */
  path: string
}

/**
 * Transform 资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Transform 文件。
 */
export interface TransformRefV2 {
  /** Transform 唯一标识符 */
  id: string
  /** Transform 文件路径（相对于项目目录） */
  path: string
}

/**
 * ManualData 节点引用（manifest 中的 manual_data 列表项）。
 */
export interface ManualDataRefV2 {
  /** ManualData 节点唯一标识符 */
  id: string
  /** ManualData 文件路径（相对于项目目录） */
  path: string
}

/**
 * ManualData 节点文件内容。
 *
 * 对应 manual_data/{id}.yaml 配置文件。
 */
export interface ManualDataFileV2 {
  /** 配置版本号（固定为 2） */
  version: number
  /** 节点 ID（与 manifest ref id 一致） */
  id: string
  /** 列名 */
  column_name: string
  /** 列数据类型 */
  column_data_type: 'string' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date'
  /** 二维字符串数组，每行一个字段值 */
  rows: string[][]
  /** 是否启用 */
  enabled: boolean
  /** 描述 */
  description?: string
  /** 上游节点 ID（当从 Schema 列注入数据时设置） */
  input_from_node?: string
}

/**
 * Transform 类型枚举。
 *
 * 定义所有支持的数据转换操作类型。
 *
 * 分类说明：
 * - 字符串操作：StringSplit, Strip, UpperCase, LowerCase, Replace, Concat, Substring
 * - 正则操作：RegexExtract
 * - 数学计算：MathExpr, Digits, WeightedSum, Modulo
 * - 日期处理：DateFormat
 * - 查找替换：Lookup, MapValue
 * - 数据清洗：FilterRows, FillNA, DropDuplicates, CastType
 * - 聚合排序：Aggregate, SortRows
 * - 条件赋值：ConditionalAssign
 */
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

/**
 * 数据源资源引用。
 *
 * 用于在 project.precis.yaml 中索引外部数据源。
 */
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

/**
 * 模板资源引用。
 *
 * 用于在 project.precis.yaml 中索引模板定义文件。
 */
export interface TemplateRefV2 {
  /** 模板唯一标识符 */
  id: string
  /** 模板文件路径（相对于项目目录） */
  path: string
}

/**
 * 模板实例引用。
 *
 * 用于在 project.precis.yaml 中记录模板实例的配置。
 */
export interface TemplateInstanceRefV2 {
  /** 模板实例唯一标识符 */
  id: string
  /** 引用的模板定义 ID */
  template_id: string
  /** 是否启用 */
  enabled: boolean
}

/**
 * 项目清单文件结构（project.precis.yaml）。
 *
 * 项目的入口配置文件，索引所有 Schema、Constraint、Regex、Transform 等资源。
 */
export interface ProjectManifestV2 {
  /** 清单版本号 */
  version: number
  /** 项目基本信息 */
  project: ProjectInfoV2
  /** 项目设置（后端始终返回，前端创建时需提供默认值） */
  settings: ProjectSettings
  /** Schema 资源引用列表 */
  schemas: SchemaRefV2[]
  /** 约束资源引用列表 */
  constraints: ConstraintRefV2[]
  /** Regex 节点资源引用列表 */
  regex_nodes: RegexNodeRefV2[]
  /** Transform 资源引用列表 */
  transforms: TransformRefV2[]
  /** ManualData 内联数据节点资源引用列表（可选） */
  manual_data?: ManualDataRefV2[]
  /** 数据源资源引用列表（可选） */
  data_sources?: DataSourceRefV2[]
  /** 模板资源引用列表（可选） */
  templates?: TemplateRefV2[]
  /** 模板实例列表（可选） */
  template_instances?: TemplateInstanceRefV2[]
  /** 正则模式目录路径 */
  patterns_dir: string
  /** 加载时的警告信息列表 */
  warnings?: string[]
}

/**
 * 约束配置文件结构（*.constraint.yaml）。
 */
export interface ConstraintFileV2 {
  /** 配置版本号 */
  version: number
  /** 约束唯一标识符 */
  id: string
  /** 约束类型 */
  type: ConstraintTypeV2
  /** 是否启用 */
  enabled: boolean
  /** 约束描述（可选） */
  description?: string
  /** 引用配置（如表 ID、列 ID 等） */
  refs: Record<string, unknown>
  /** 约束参数（因类型而异） */
  params: Record<string, unknown>
  /** 上游数据流节点 ID（优先于 Schema 引用） */
  input_from_node?: string
}

/**
 * Transform 配置文件结构（*.transform.yaml）。
 */
export interface TransformFileV2 {
  /** 配置版本号 */
  version: number
  /** Transform 唯一标识符 */
  id: string
  /** Transform 名称（可选） */
  name?: string
  /** Transform 类型 */
  type: TransformTypeV2
  /** 是否启用 */
  enabled: boolean
  /** Transform 描述（可选） */
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

/**
 * Regex 源引用。
 *
 * 用于 Regex 节点引用 Schema 中的特定列作为数据源。
 */
export interface RegexSourceRefV2 {
  /** 源表 ID */
  table_id: string
  /** 源列 ID */
  column_id: string
}

/**
 * 模式注册表类型。
 *
 * 当前仅支持 'patterns' 一种注册表。
 */
export type PatternRegistryTypeV2 = 'patterns'

/**
 * 模式引用定义。
 *
 * 用于 Regex 节点引用已注册的正则表达式模式。
 */
export interface PatternRefV2 {
  /** 注册表类型 */
  registry: PatternRegistryTypeV2
  /** 模式名称 */
  pattern_name: string
  /** 别名（可选），用于在节点中显示替代名称 */
  as_alias?: string
}

// ============================================================================
// V2 Regex 节点配置
// ============================================================================

/**
 * Regex 节点配置文件结构（*.regex.yaml）。
 *
 * 定义正则表达式节点的完整配置，支持直接编写正则或引用已注册的模式。
 */
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

  /**
   * L2 - 可选：匹配模式
   * @values
   * - 'full': 全匹配模式
   * - 'partial': 部分匹配模式
   * - 'extract': 提取模式（生成派生列）
   */
  match_mode: 'full' | 'partial' | 'extract'

  /** L2 - 可选：是否启用 */
  enabled: boolean

  /** 是否区分大小写 */
  case_sensitive?: boolean
  /** 正则标志位（如 'g', 'i', 'm' 等） */
  flags?: string
  /** 参数列表（前端内部使用） */
  parameters?: unknown[]
  /** 规则列表（前端内部使用） */
  rules?: unknown[]

  /** 数据流输入接口：上游数据流节点 ID */
  input_from_node?: string
  /** 数据流输入接口：上游节点中的目标列名 */
  input_column?: string

  /** Extract 模式专用：捕获组定义（名称与组索引映射） */
  capture_groups?: Array<{ name: string; group_index: number }>
  /** Extract 模式专用：输出列名列表 */
  output_columns?: string[]

  /** 源引用信息，指向 Schema 中的特定列 */
  source_ref?: RegexSourceRefV2
  /** 源列名称（显示用） */
  source_column_name?: string

  /** L3 - 内部：配置版本（程序生成） */
  version: number

  /** L3 - 内部：节点唯一标识符（程序生成） */
  id: string

  /** L3 - 内部：前端专用配置 */
  _internal?: RegexNodeInternalV2
}

/**
 * V2 完整配置响应。
 *
 * 后端 getV2FullConfig() API 返回的完整项目配置，包含清单和所有资源文件内容。
 */
export interface FullConfigV2Response {
  /** 项目清单 */
  manifest: ProjectManifestV2
  /** 生效的清单（合并后的实际配置） */
  effective_manifest?: ProjectManifestV2
  /** Schema 文件映射：schema_id -> TableSchemaFileV2 */
  schemas: Record<string, TableSchemaFileV2>
  /** 约束文件映射：constraint_id -> ConstraintFileV2 */
  constraints: Record<string, ConstraintFileV2>
  /** 正则注册表映射 */
  regex_registries: Record<string, unknown>
  /** Regex 节点文件映射：regex_id -> RegexNodeFileV2 */
  regex_nodes: Record<string, RegexNodeFileV2>
  /** Transform 文件映射：transform_id -> TransformFileV2 */
  transforms: Record<string, TransformFileV2>
  /**
   * 配置覆盖信息。
   *
   * 描述 manifest 中列出的资源与实际文件之间的差异：
   * - unlisted: 文件存在但 manifest 中未列出
   * - dangling: manifest 列出但文件不存在
   */
  coverage?: {
    /** 配置是否完整（无遗漏、无悬空） */
    is_complete: boolean
    /** 未列入清单的资源 */
    unlisted: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
    /** 悬空引用（manifest 列出但文件缺失） */
    dangling: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
  } | null
  /** 清单是否被修改过（与原始文件对比） */
  manifest_modified?: boolean
  /** Schema 文件解析错误映射: schema_id -> 错误信息 */
  schema_errors?: Record<string, string>
  /** 配置自检结果（仅 inspect=true 时返回） */
  inspection?: InspectionResultV2
}

/**
 * 配置自检 — 可执行动作
 *
 * 前端 InspectionDrawer 根据 type 渲染对应按钮：
 * - open_file : 调 Electron IPC 打开本地文件（或 fallback 到复制路径）
 * - copy      : 把 payload.text 写入剪贴板
 * - dismiss   : 局部"忽略"动作（持久化到 localStorage）
 * - auto_fix  : 调后端 fix_api 描述的接口执行一键修复
 * - navigate  : 跳转到画布/资源树等其他位置
 */
export interface InspectionAction {
  type: 'open_file' | 'copy' | 'dismiss' | 'auto_fix' | 'navigate'
  label: string
  /** i18n key，前端优先使用此字段渲染（缺失时 fallback 到 label） */
  label_key?: string
  /** open_file / copy 使用 */
  file_path?: string
  /** copy 使用 */
  text?: string
  /** navigate 使用 */
  target?: string
  /** auto_fix 使用：用于匹配前端的 fix handler */
  fix_kind?: string
  /** auto_fix 使用：附加参数 */
  payload?: Record<string, unknown>
}

/**
 * 一键修复 API 描述
 *
 * 前端 auto_fix 动作处理器读取此字段，调用对应后端 API。
 * 出于安全考虑，仅"安全操作"（不破坏数据）会填充此字段。
 */
export interface InspectionFixApi {
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: Record<string, unknown>
}

/**
 * 单条配置自检问题
 *
 * 后端 LoadingError.to_dict() 直接序列化为此结构。
 * 前端可零成本展示 title / description / fix_hint，无需翻译错误类型。
 *
 * i18n 支持：当 *_key 字段存在时，前端用 t(key, message_params) 渲染；
 * 否则 fallback 到对应的中文字符串字段。
 */
export interface InspectionIssue {
  /** 稳定唯一 id，用于"忽略"持久化 */
  id: string
  /** 严重度：blocker=阻塞、warning=警告、info=提示 */
  severity: 'blocker' | 'warning' | 'info'
  /** 人类可读短标题（中文 fallback） */
  title: string
  /** 根因说明（中文 fallback） */
  description: string
  /** 高亮显示的修复建议（中文 fallback） */
  fix_hint: string
  /** 原始错误类型（保留用于日志/高级用户排查） */
  error_type: string
  /** 出错的文件路径 */
  file_path: string
  /** 涉及的资源 id（可能为 null） */
  ref_id: string | null
  /** 后端原始 message（保留向后兼容） */
  message: string
  /** 后端原始 suggestion（保留向后兼容） */
  suggestion: string
  /** 可执行动作列表 */
  actions: InspectionAction[]
  /** 一键修复 API 描述（仅安全操作） */
  fix_api?: InspectionFixApi
  /** 上下文数据，用于渲染对比表（如 available_schemas、available_columns 等） */
  context?: Record<string, unknown>
  /** i18n key for title（可选，存在时前端优先用 i18n 渲染） */
  title_key?: string
  /** i18n key for description（可选） */
  description_key?: string
  /** i18n key for fix_hint（可选） */
  fix_hint_key?: string
  /** i18n 插值参数（如 {constraintId, tableId, columnId}） */
  message_params?: Record<string, unknown>
}

/**
 * 配置自检完整结果
 */
export interface InspectionResultV2 {
  /** 自检执行时间（ISO 字符串） */
  inspected_at: string
  /** 自检发现的所有问题（已按类型合并/排序） */
  errors: InspectionIssue[]
}

/**
 * V2 完整配置请求。
 *
 * 前端 saveProject() 时向后端发送的完整项目配置。
 */
export interface FullConfigV2Request {
  /** 项目清单 */
  manifest: ProjectManifestV2
  /** Schema 文件映射 */
  schemas: Record<string, TableSchemaFileV2>
  /** 约束文件映射 */
  constraints: Record<string, ConstraintFileV2>
  /** Regex 节点文件映射 */
  regex_nodes: Record<string, RegexNodeFileV2>
  /** Transform 文件映射 */
  transforms: Record<string, TransformFileV2>
  /** ManualData 文件映射 */
  manual_data: Record<string, ManualDataFileV2>
}

// ============================================================================
// V2 项目视图（前端画布布局）配置
// ============================================================================

/**
 * V2 项目视图文件（project.view.json）。
 *
 * 设计目标：
 * - 将"画布布局（节点坐标/视口）"与"校验语义配置（schema/constraint/regex）"解耦
 * - 避免把 UI 相关信息写入后端全量校验所需的配置文件
 */
export interface ProjectViewV2 {
  /** 视图版本号，用于未来扩展兼容 */
  version: number
  /** 节点坐标映射：nodeId -> { x, y } */
  nodes: Record<string, { x: number; y: number }>
  /** 节点 UI 状态：hidden / expanded 等 */
  nodeStates?: Record<string, { hidden?: boolean; expanded?: boolean }>
  /** 可选视口信息（不强依赖，缺省时前端使用默认缩放） */
  viewport?: { x: number; y: number; zoom: number }
}

// ============================================================================
// 项目设置类型（从前端设置面板持久化到 project.precis.yaml）
// ============================================================================

/**
 * 校验设置。
 *
 * 控制数据校验的全局行为。
 */
export interface ValidationSettings {
  /** 是否自动执行校验 */
  auto_validate: boolean
  /** 是否启用严格模式（严格模式下任何错误都视为失败） */
  strict_mode: boolean
  /**
   * 错误处理方式
   * @values
   * - 'stop': 遇到第一个错误即停止
   * - 'continue': 继续处理后续数据
   * - 'report': 仅报告错误不中断流程
   */
  error_handling: 'stop' | 'continue' | 'report'
  /** 校验超时时间（秒） */
  timeout_seconds: number
  /** 批量处理的最大文件数 */
  batch_max_files: number
}

/**
 * 校验运行时设置（ValidationSettings 的别名）。
 */
export type ValidationRunSettings = ValidationSettings

/**
 * 文件处理设置。
 *
 * 控制数据文件的读取和解析行为。
 */
export interface FileProcessingSettings {
  /**
   * 默认文件编码
   * @values
   * - 'utf-8': UTF-8 编码
   * - 'gbk': GBK 编码（中文 Windows 常用）
   * - 'auto': 自动检测编码
   */
  default_encoding: 'utf-8' | 'gbk' | 'auto'
  /** CSV 字段分隔符 */
  csv_delimiter: string
  /**
   * 空值处理策略
   * @values
   * - 'null': 转为 null
   * - 'empty': 转为空字符串
   * - 'default': 使用默认值
   */
  null_value_strategy: 'null' | 'empty' | 'default'
  /** 日期格式模板（如 'YYYY-MM-DD'） */
  date_format: string
}

/**
 * 脚本安全设置。
 *
 * 控制 Python 脚本执行的安全策略。
 */
export interface ScriptSecuritySettings {
  /** 是否允许 eval 执行 */
  allow_eval: boolean
  /** 是否允许 exec 执行 */
  allow_exec: boolean
  /** 是否启用沙箱模式 */
  sandbox_mode: boolean
  /** 脚本执行超时时间（秒） */
  timeout_seconds: number
}

/**
 * 项目设置。
 *
 * 包含校验、文件处理和脚本安全三大模块的设置。
 */
export interface ProjectSettings {
  /** 校验设置 */
  validation: ValidationSettings
  /** 文件处理设置 */
  file_processing: FileProcessingSettings
  /** 脚本安全设置 */
  script_security: ScriptSecuritySettings
}

/**
 * 校验任务目标类型。
 *
 * @values
 * - 'full_project': 校验整个项目
 * - 'single_table': 校验单个表
 * - 'single_file': 校验单个文件
 */
export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

/**
 * 校验任务目标。
 *
 * 描述一次校验任务的具体范围。
 */
export interface ValidationTaskTarget {
  /** 目标类型 */
  type: ValidationTaskTargetType
  /** 目标表 ID（当 type 为 'single_table' 时使用） */
  table_id?: string | null
  /** 目标文件路径（当 type 为 'single_file' 时使用） */
  file_path?: string | null
  /** 显示名称（用于 UI 展示） */
  display_name?: string | null
}

// ============================================================================
// 约束配置示例
// ============================================================================

// ============================================================================
// 工作区类型
// ============================================================================

/**
 * 工作区视口状态。
 *
 * 记录画布当前的平移和缩放状态。
 */
export interface WorkspaceV2Viewport {
  /** 视口 X 坐标 */
  x?: number
  /** 视口 Y 坐标 */
  y?: number
  /** 视口缩放比例 */
  zoom?: number
}

/**
 * 工作区项。
 *
 * 表示一个画布工作区的配置，包括可见节点、视口状态和完整画布快照。
 * nodes/edges 保存完整画布数据，实现跨会话恢复。
 */
export interface WorkspaceV2Item {
  /** 工作区唯一标识符 */
  id: string
  /** 工作区标题 */
  title: string
  /** 工作区排序索引（删除后不重新编号，新建时取 max+1） */
  index: number
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string
  /** 最后活跃时间戳（ISO 8601 格式） */
  lastActiveAt: string
  /** 当前工作区中可见的节点 ID 列表 */
  visibleNodeIds: string[]
  /** 工作区视口状态（可选） */
  viewport?: WorkspaceV2Viewport
  /** 画布节点完整数据 */
  nodes: Record<string, unknown>[]
  /** 画布边完整数据 */
  edges: Record<string, unknown>[]
}

/**
 * 工作区列表响应。
 *
 * 后端返回的所有工作区配置，每个工作区包含完整画布快照。
 */
export interface WorkspacesV2Response {
  /** 响应版本号 */
  version: number
  /** 当前活跃的工作区 ID，无则为 null */
  activeWorkspaceId: string | null
  /** 工作区列表（含完整画布快照） */
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
