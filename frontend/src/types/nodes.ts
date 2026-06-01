/**
 * @file nodes.ts
 * @description 节点相关类型定义
 *
 * 该模块定义了数据流图中所有节点的数据结构类型，是前端节点系统的核心类型定义。
 * 包含各类节点的 data 对象结构，以及与节点相关的通用类型定义。
 *
 * 节点类型分类：
 * 1. 基础节点类型 - TableNodeData, ColumnNodeData, ProjectNodeData 等
 * 2. Schema 节点类型 - SchemaNodeData, SchemaColumn 等
 * 3. 约束节点类型 - 各类约束节点的数据结构
 * 4. 正则节点类型 - RegexNodeData, RegexSetNodeData 等
 * 5. 集合节点类型 - TableSetNodeData, TableSetRootNodeData 等
 *
 * 架构说明：
 * - 每个节点类型都包含 configName 用于显示名称
 * - 节点 data 对象与 VueFlow 的 Node.data 属性绑定
 * - 使用 TypeScript 接口提供类型安全
 * - 从 constraints.ts, regex.ts, datasource.ts 等模块导入子类型
 *
 * 依赖说明：
 * - @vue-flow/core: 提供 Node 类型基础
 * - types/common: 提供 DataType, BindingSource 等通用类型
 * - types/constraints: 提供约束节点相关类型
 * - types/regex: 提供正则节点相关类型
 * - types/datasource: 提供数据源节点相关类型
 */

import type { Node } from '@vue-flow/core'
import type { DataType, BindingSource } from './common'
import type {
  ForeignKeyConstraintNodeData,
  UniqueConstraintNodeData,
  NotNullConstraintNodeData,
  AllowedValuesConstraintNodeData,
  ConditionalConstraintNodeData,
  ScriptedConstraintNodeData,
  CharsetConstraintNodeData,
  DateLogicConstraintNodeData,
  RangeConstraintNodeData,
  CompositeConstraintNodeData,
  ConstraintRuleSetNodeData,
  ConstraintRuleSetRootNodeData,
} from './constraints'
import type { RegexNodeData, RegexSetNodeData, RegexSetRootNodeData } from '@/features/regex/types'
import type { SourceMode, SourcePreviewNodeData } from './datasource'
import type { TransformTypeV2 } from './projectV2'

// ========== 基础节点数据类型 ==========

/**
 * 定义 'TableDefinitionNode' 节点内部 `data` 对象所拥有的属性。
 */
export interface TableNodeData {
  /** 配置名称，用于在 UI 和资产库中展示该表格的业务含义 */
  configName: string
  /** 表名，对应实际数据源的表/Sheet 名称 */
  tableName: string
  /** Sheet 名称（仅 Excel 数据源有效，可选） */
  sheetName?: string
}

/**
 * 定义 'ColumnDefinitionNode' 节点内部 `data` 对象所拥有的属性。
 */
export interface ColumnNodeData {
  /** 列的唯一标识符（可选，用于追踪列身份） */
  id?: string
  /** 列名称，用于在 UI 和配置中标识该列 */
  columnName: string
  /** 列的数据类型，决定该列存储的数据种类和校验方式 */
  dataType: DataType
  /**
   * 表达式类型
   * @values
   * - 'none': 无表达式，普通列
   * - 'implicit': 隐式表达式，由系统推断生成
   * - 'explicit': 显式表达式，用户手动配置
   */
  expressionType?: 'none' | 'implicit' | 'explicit'
  /** 是否已绑定到数据源 */
  isBound?: boolean
  /** 绑定来源信息，记录该列的数据来源 */
  bindingSource?: BindingSource
  /** 绑定配置的详细信息 */
  bindingConfig?: {
    /** 来源节点名称，用于 UI 展示 */
    sourceNodeName: string
    /** 来源字段名称 */
    fieldName: string
    /** 绑定状态 */
    status: string
  }
}

/**
 * 定义工程根节点的数据结构。
 *
 * projectRoot 节点是项目的入口节点，保存项目的基本标识信息。
 * 统计数据（schema/constraint/regex 数量等）由组件直接从 resourceTreeStore / graphStore computed 读取，
 * 不在节点 data 中缓存。
 */
export interface ProjectNodeData {
  /** 项目名称，用于在 UI 中展示 */
  projectName: string
  /** 项目文件所在的目录路径 */
  projectPath: string
  /** 项目配置文件路径（如 project.precis.yaml） */
  configPath?: string
  /** 项目创建时间戳（ISO 8601 格式） */
  createdAt?: string
  /** 项目最后更新时间戳（ISO 8601 格式） */
  updatedAt?: string
}

/**
 * 定义 'TableSetNode' (表结构集) 节点内部 `data` 对象。
 */
export interface TableSetNodeData {
  /** 集合名称，用于在 UI 中标识该表结构集 */
  setName: string
  /** 集合描述（可选） */
  description?: string
}

/**
 * 定义表结构集的初始节点 Data 对象。
 */
export interface TableSetRootNodeData {
  /** 集合名称，用于在 UI 中标识该表结构集 */
  setName: string
}

// ========== Schema 节点类型定义 ==========

/**
 * Schema 列基础接口。
 *
 * 提取 SchemaColumn 与 JsonSchemaColumn 的公共字段，消除类型层面的重复。
 */
export interface BaseSchemaColumn {
  /** 列的唯一标识符 */
  id: string
  /** 列名称，用于在 UI 和配置中标识该列 */
  columnName: string
  /**
   * 表达式类型
   * @values
   * - 'none': 无表达式
   * - 'implicit': 隐式表达式
   * - 'explicit': 显式表达式
   */
  expressionType?: 'none' | 'implicit' | 'explicit'
  /** 是否已绑定到数据源 */
  isBound?: boolean
  /** 绑定的模式名称（用于正则等提取模式） */
  boundPattern?: string
  /** 绑定的注册表名称 */
  boundRegistry?: string
  /** 绑定配置的详细信息 */
  bindingConfig?: {
    /** 来源模式 */
    sourcePattern?: string
    /** 来源节点名称 */
    sourceNodeName?: string
    /** 来源字段名称 */
    sourceFieldName?: string
    /** 绑定状态 */
    status: 'active' | 'inactive' | 'error'
  }
  /** 内嵌约束配置 */
  constraints?: {
    /** 是否启用非空约束 */
    notNull?: boolean
    /** 是否启用唯一约束 */
    unique?: boolean
    /** 允许的值列表（用于 AllowedValues 约束） */
    allowedValues?: string[]
  }
  /** 列提取配置（用于从其他列提取内容生成该列） */
  extractedConfig?: {
    /** 来源列名称 */
    sourceColumn: string
    /** 提取键（如正则捕获组名） */
    extractKey: string
    /** 结果数据类型 */
    resultType?: string
  }
  /** 校验错误信息列表 */
  validationErrors?: string[]
}

/**
 * Schema 列定义数据结构。
 *
 * 用于标准 Schema 节点（Excel/CSV 数据源）的列定义。
 */
export interface SchemaColumn extends BaseSchemaColumn {
  /** 列的数据类型 */
  dataType: DataType
}

/**
 * Schema 节点保存状态。
 *
 * @values
 * - 'draft': 草稿状态，尚未保存到文件
 * - 'saved': 已保存状态，与文件同步
 * - 'error': 保存出错状态
 */
export type SchemaSaveState = 'draft' | 'saved' | 'error'

/**
 * Schema 节点数据基础接口。
 *
 * 提取 SchemaNodeData 与 JsonSchemaNodeData 的公共字段。
 */
export interface BaseSchemaNodeData<TColumn extends BaseSchemaColumn = BaseSchemaColumn> {
  /** 配置名称，用于在 UI 和资产库中展示 */
  configName: string
  /** 表名，对应实际数据源的表/Sheet 名称 */
  tableName: string
  /** Sheet 名称（仅 Excel 数据源有效） */
  sheetName?: string
  /** 源文件名称（显示用） */
  sourceFile?: string
  /** 源文件的完整路径 */
  sourceFilePath?: string
  /** 关联的数据源预览节点 ID */
  sourceNodeId?: string
  /** 表头所在行索引（0-based） */
  headerRow?: number
  /** 节点宽度（UI 布局用） */
  width?: number
  /** 节点高度（UI 布局用） */
  height?: number
  /** 列定义列表 */
  columns: TColumn[]
  /** 保存状态 */
  saveState: SchemaSaveState
  /** 创建时间戳（ISO 8601 格式） */
  createdAt?: string
  /** 最后更新时间戳（ISO 8601 格式） */
  updatedAt?: string
  /** 最近一次保存时间戳（ISO 8601 格式） */
  lastSaved?: string
  /** 是否处于拖拽悬停状态（UI 状态） */
  isDragOver?: boolean
  /** 是否正在编辑标题（UI 状态） */
  isEditingTitle?: boolean
  /** 源文件路径模式 */
  sourcePathMode?: 'relative_file' | 'absolute_file'
  /** 数据来源模式 */
  sourceMode?: SourceMode
  /** 本地文件绝对路径 */
  localPath?: string
}

/**
 * Schema 节点数据 - 数据表节点（容器）。
 *
 * 用于 Excel/CSV 数据源的表结构定义节点。
 */
export interface SchemaNodeData extends BaseSchemaNodeData<SchemaColumn> {
  /** 数据源类型 */
  sourceType?: 'excel' | 'csv' | 'json'
  /** 下游子节点 ID 列表（regex、constraint 等） */
  children?: string[]
}

/**
 * Transform 功能节点数据 - 数据转换/处理节点。
 *
 * 用于定义数据转换规则，如字符串分割、正则提取、数学表达式计算等。
 */
export interface TransformNodeData {
  /** 配置名称，用于在 UI 中展示该转换的业务含义 */
  configName: string
  /** 转换类型，决定具体的转换逻辑 */
  transformType: TransformTypeV2
  /** 转换描述（可选） */
  description?: string
  /** 是否启用该转换 */
  enabled: boolean

  /** 上游数据流节点 ID */
  inputFromNode?: string
  /** 上游节点中的目标列名 */
  inputColumn?: string

  /** 转换参数（因类型而异） */
  params: Record<string, unknown>

  /** 转换后产生的列名列表 */
  outputColumns: string[]

  /** 自动生成的输出节点 ID 列表 */
  outputNodeIds?: string[]

  /** 保存状态 */
  saveState?: SchemaSaveState
  /** 最近一次保存时间戳（ISO 8601 格式） */
  lastSaved?: string
}

/**
 * 手动数据节点数据 - 用户手动输入的测试数据。
 *
 * 用于在画布上创建内联测试数据，可直接连接到约束节点进行校验。
 */
export interface ManualDataNodeData {
  /** 配置名称，用于在 UI 中展示 */
  configName: string
  /** 列名称 */
  columnName: string
  /** 数据行（二维数组，每行为一个记录） */
  rows: string[][]
  /** 节点描述（可选） */
  description?: string
  /** 保存状态 */
  saveState?: SchemaSaveState
  /** 下游子节点 ID 列表（regex 等） */
  children?: string[]
}

/**
 * 模板实例节点数据 - 可复用约束模板的实例。
 *
 * 特点:
 * - 引用一个已定义的模板（templateId）
 * - 通过 parameters 字段绑定具体参数值
 * - 连接到上游 Schema/TransformOutput/manualData 获取数据
 * - 后端加载时自动展开为标准 Transform + Constraint 文件
 */
export interface TemplateInstanceNodeData {
  /** 配置名称，用于在 UI 中展示该模板实例 */
  configName: string
  /** 引用的模板定义 ID */
  templateId: string
  /** 模板显示名称（缓存） */
  templateName: string
  /** 参数绑定值 */
  parameters: Record<string, unknown>
  /** 上游数据流节点 ID */
  inputFromNode?: string
  /** 是否启用 */
  enabled: boolean
  /** 内部节点数量（缓存） */
  nodeCount: number
  /** 参数摘要文本，用于在节点上展示参数概览 */
  summaryText: string
  /** 是否处于展开（容器）模式 */
  expanded: boolean
  /** 保存状态 */
  saveState?: SchemaSaveState
  /** 最近一次保存时间戳（ISO 8601 格式） */
  lastSaved?: string
}

/**
 * Transform 输出节点数据 - 绑定在 transform 上的结果展示节点。
 *
 * 特点:
 * - 由 transform 节点自动生成，不可独立创建
 * - 删除父 transform 时自动级联删除
 * - 展示转换后的单列数据
 */
export interface TransformOutputNodeData {
  /** 配置名称，用于在 UI 中展示 */
  configName: string
  /** 输出列名称 */
  columnName: string
  /** 输出数据行（二维数组） */
  rows: string[][]
  /** 父 Transform 节点 ID */
  parentTransformId: string
  /** 保存状态 */
  saveState?: SchemaSaveState
  /** 下游子节点 ID 列表（regex、constraint 等） */
  children?: string[]
}

/**
 * Schema 集合节点数据 - Schema 容器。
 *
 * 用于将多个 Schema 节点组织到一个集合中。
 */
export interface SchemaSetNodeData {
  /** 集合名称，用于在 UI 中标识 */
  setName: string
  /** 集合描述（可选） */
  description?: string
}

/**
 * Schema 集合根节点数据。
 */
export interface SchemaSetRootNodeData {
  /** 集合名称，用于在 UI 中标识 */
  setName: string
}

// ========== JSON 数据源节点类型定义 ==========

/**
 * JSON 数据预览节点数据。
 *
 * 用于展示 JSON 文件内容，支持配置 JSONPath、record_path 等解析参数。
 * 可以连接到 JsonSchemaNode 进行结构定义。
 */
export interface JsonSourcePreviewNodeData {
  /** 节点唯一标识符（Vue Flow 节点 ID） */
  id: string
  /** 节点显示名称 */
  configName: string
  /** 数据源名称 */
  sourceName: string
  /** 文件名称（含扩展名） */
  fileName: string
  /** 文件类型，固定为 'json' */
  fileType: 'json'
  /** 数据源类型，固定为 'json' */
  sourceType: 'json'
  /** JSON 格式变体（与后端 JSONSourceSpec 对齐）
   * - auto: 自动检测格式
   * - array: 对象数组 [{...}, {...}]
   * - lines: JSON Lines / NDJSON（每行一个 JSON 对象）
   * - object: 嵌套对象（需配合 JSONPath 提取数据数组）
   */
  format?: 'auto' | 'array' | 'lines' | 'object'
  /** JSONPath 表达式，用于从 JSON 中提取数据 */
  jsonPath?: string
  /** record_path，用于 pandas read_json 的 record_path 参数 */
  recordPath?: string
  /** 表格数据（保留兼容性，二维数组格式） */
  data?: string[][]
  /** 原始 JSON 数据（用于树状显示） */
  rawData?: unknown[]
  /** 表头所在行索引（0-based） */
  headerRow?: number
  /** 实际数据行数 */
  actualRowCount?: number
  /** 实际数据列数 */
  actualColCount?: number
  /** 总行数 */
  totalRows?: number
  /** 总列数 */
  totalCols?: number
  /** 预览显示的行数限制 */
  previewRowCount?: number
  /** 预览显示的列数限制 */
  previewColCount?: number
  /** 文件大小（字节） */
  fileSize?: number
  /** 文件最后修改时间戳（Unix 时间戳，毫秒） */
  lastModified?: number
  /** 标记是否为预览节点 */
  isPreviewNode: boolean
  /** 输出端口是否已连接 */
  outputPortConnected: boolean
  /** 数据来源模式 */
  sourceMode?: SourceMode
  /** 本地文件绝对路径 */
  localPath?: string
  /** 当前选中的 Sheet 名称（JSON 数据源也可能复用此字段） */
  currentSheet?: string
  /** 下游子节点 ID 列表 */
  children?: string[]
  /** 后端推断的字段类型映射（字段名 → 类型） */
  typeInference?: Record<string, string>
  /** 字段数量（结构统计） */
  fieldCount?: number
  /** 最大嵌套深度（结构统计） */
  nestDepth?: number
  /** 与 Schema 定义的类型不匹配列表（自动校验结果） */
  validationMismatches?: Array<{ field: string; expected: string; actual: string }>
}

/**
 * JSON Schema 节点数据。
 *
 * 用于定义 JSON 数据的表结构，参考 SchemaNodeData 结构。
 * 支持列定义、数据类型、约束、JSONPath 等配置。
 */
export interface JsonSchemaNodeData extends BaseSchemaNodeData<JsonSchemaColumn> {
  /** 数据源类型，固定为 'json' */
  sourceType?: 'json'
  /** JSONPath 表达式，用于从 JSON 中提取数据 */
  jsonPath?: string
  /** record_path，用于 pandas read_json 的 record_path 参数 */
  recordPath?: string
  /** JSON 格式变体（与 JsonSourcePreviewNodeData.format 对齐） */
  format?: 'auto' | 'array' | 'lines' | 'object'
  /** 下游子节点 ID 列表（regex、constraint 等） */
  children?: string[]
}

/**
 * JSON Schema 列定义。
 *
 * 用于定义 JSON Schema 节点中的列结构，
 * 支持 JSONPath 路径、数据类型、嵌套结构等 JSON 专属配置。
 */
export interface JsonSchemaColumn extends BaseSchemaColumn {
  /** 列的数据类型（JSON 专属类型系统） */
  dataType: JsonDataType
  /** JSONPath 路径，指向该列在 JSON 中的位置 */
  jsonPath: string
  /** 是否允许为空 */
  nullable?: boolean
  /** 是否为主键 */
  primaryKey?: boolean
  /** 列描述（可选） */
  description?: string

  // 树形结构核心
  /** 子列列表（用于嵌套 JSON 对象） */
  children?: JsonSchemaColumn[]
  /** 是否展开子列（UI 状态） */
  isExpanded?: boolean

  // 数组元素类型（当 dataType === 'array' 时）
  /** 数组元素的数据类型 */
  arrayItemType?: JsonDataType
}

/**
 * JSON 数据类型。
 *
 * JSON 标准数据类型的联合类型，用于 JsonSchemaColumn 的 dataType 字段。
 *
 * @values
 * - 'string': 字符串
 * - 'number': 数值（整数或浮点数）
 * - 'boolean': 布尔值
 * - 'object': JSON 对象
 * - 'array': JSON 数组
 * - 'null': 空值
 */
export type JsonDataType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

// ========== 自定义节点数据联合类型 ==========

/**
 * 自定义节点数据联合类型（Discriminated Union）。
 *
 * 该联合类型包含画布上所有可能的节点 data 类型。
 * Vue Flow 节点的 `data` 属性必须是该联合类型中的某一种。
 *
 * 节点类型分类：
 * 1. 基础节点：TableNodeData, ColumnNodeData, ProjectNodeData
 * 2. 集合节点：TableSetNodeData, TableSetRootNodeData, SchemaSetNodeData, SchemaSetRootNodeData, ConstraintRuleSetNodeData, ConstraintRuleSetRootNodeData, RegexSetNodeData, RegexSetRootNodeData
 * 3. Schema 节点：SchemaNodeData, JsonSchemaNodeData
 * 4. 数据源节点：SourcePreviewNodeData, JsonSourcePreviewNodeData
 * 5. 转换节点：TransformNodeData, TransformOutputNodeData, ManualDataNodeData
 * 6. 约束节点：ForeignKeyConstraintNodeData, UniqueConstraintNodeData, NotNullConstraintNodeData, AllowedValuesConstraintNodeData, ConditionalConstraintNodeData, ScriptedConstraintNodeData, RangeConstraintNodeData, CharsetConstraintNodeData, DateLogicConstraintNodeData, CompositeConstraintNodeData
 * 7. 正则节点：RegexNodeData
 * 8. 模板节点：TemplateInstanceNodeData
 */
export type CustomNodeData =
  | TableNodeData
  | ColumnNodeData
  | ProjectNodeData
  | TableSetNodeData
  | TableSetRootNodeData
  | ConstraintRuleSetNodeData
  | ConstraintRuleSetRootNodeData
  | RegexSetNodeData
  | RegexSetRootNodeData
  | RegexNodeData
  | TransformNodeData
  | ManualDataNodeData
  | TransformOutputNodeData
  | ForeignKeyConstraintNodeData
  | UniqueConstraintNodeData
  | NotNullConstraintNodeData
  | AllowedValuesConstraintNodeData
  | ConditionalConstraintNodeData
  | ScriptedConstraintNodeData
  | RangeConstraintNodeData
  | CharsetConstraintNodeData
  | DateLogicConstraintNodeData
  | CompositeConstraintNodeData
  | SchemaNodeData
  | SchemaSetNodeData
  | SchemaSetRootNodeData
  | SourcePreviewNodeData
  | JsonSourcePreviewNodeData
  | JsonSchemaNodeData
  | TemplateInstanceNodeData

/**
 * 定义应用中自定义节点的最终类型。
 *
 * 继承自 Vue Flow 的基础 `Node` 类型，但将其泛型参数 `T`（代表 data 对象）
 * 限制为我们自己定义的 `CustomNodeData` 联合类型。
 *
 * 这是 Vue Flow 画布中所有节点的统一类型，graphStore 中的 nodes 数组即为此类型。
 */
export type CustomNode = Node<CustomNodeData>
