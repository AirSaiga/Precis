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
  configName: string
  tableName: string
  sheetName?: string
}

/**
 * 定义 'ColumnDefinitionNode' 节点内部 `data` 对象所拥有的属性。
 */
export interface ColumnNodeData {
  id?: string
  columnName: string
  dataType: DataType
  expressionType?: 'none' | 'implicit' | 'explicit'
  isBound?: boolean
  bindingSource?: BindingSource
  bindingConfig?: {
    sourceNodeName: string
    fieldName: string
    status: string
  }
}

/**
 * 定义工程根节点的数据结构
 */
export interface ProjectNodeData {
  projectName: string
  projectPath: string
  configPath?: string
  createdAt?: string
  updatedAt?: string
  projectSettings?: {
    validation?: {
      auto_validate?: boolean
      strict_mode?: boolean
      error_handling?: 'continue' | 'report' | 'stop'
      timeout_seconds?: number
      batch_max_files?: number
    }
    file_processing?: {
      default_encoding?: string
      csv_delimiter?: string
      null_value_strategy?: string
      date_format?: string
    }
    script_security?: {
      allow_eval?: boolean
      allow_exec?: boolean
      sandbox_mode?: boolean
      timeout_seconds?: number
    }
  }
  schemaCount?: number
  constraintCount?: number
  regexCount?: number
  totalAssets?: number
  passRate?: number
  errorCount?: number
}

/**
 * 定义 'TableSetNode' (表结构集) 节点内部 `data` 对象。
 */
export interface TableSetNodeData {
  setName: string
  description?: string
}

/**
 * 定义表结构集的初始节点 Data 对象。
 */
export interface TableSetRootNodeData {
  setName: string
}

// ========== Schema 节点类型定义 ==========

/**
 * Schema 列基础接口
 *
 * 提取 SchemaColumn 与 JsonSchemaColumn 的公共字段，消除类型层面的重复。
 */
export interface BaseSchemaColumn {
  id: string
  columnName: string
  expressionType?: 'none' | 'implicit' | 'explicit'
  isBound?: boolean
  boundPattern?: string
  boundRegistry?: string
  bindingConfig?: {
    sourcePattern?: string
    sourceNodeName?: string
    sourceFieldName?: string
    status: 'active' | 'inactive' | 'error'
  }
  constraints?: {
    notNull?: boolean
    unique?: boolean
    allowedValues?: string[]
  }
  extractedConfig?: {
    sourceColumn: string
    extractKey: string
    resultType?: string
  }
  validationErrors?: string[]
}

/**
 * Schema 列定义数据结构
 */
export interface SchemaColumn extends BaseSchemaColumn {
  dataType: DataType
}

/**
 * Schema 节点保存状态
 */
export type SchemaSaveState = 'draft' | 'saved' | 'error'

/**
 * Schema 节点数据基础接口
 *
 * 提取 SchemaNodeData 与 JsonSchemaNodeData 的公共字段。
 */
export interface BaseSchemaNodeData<TColumn extends BaseSchemaColumn = BaseSchemaColumn> {
  configName: string
  tableName: string
  sheetName?: string
  sourceFile?: string
  sourceFilePath?: string
  sourceNodeId?: string
  headerRow?: number
  width?: number
  height?: number
  columns: TColumn[]
  saveState: SchemaSaveState
  createdAt?: string
  updatedAt?: string
  lastSaved?: string
  isDragOver?: boolean
  isEditingTitle?: boolean
  sourcePathMode?: 'relative_file' | 'absolute_file'
  sourceMode?: SourceMode
  localPath?: string
}

/**
 * Schema 节点数据 - 数据表节点（容器）
 */
export interface SchemaNodeData extends BaseSchemaNodeData<SchemaColumn> {
  sourceType?: 'excel' | 'csv' | 'json'
  children?: string[]
}

/**
 * Transform 功能节点数据 - 数据转换/处理节点
 */
export interface TransformNodeData {
  configName: string
  transformType: TransformTypeV2
  description?: string
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

  saveState?: SchemaSaveState
  lastSaved?: string
}

/**
 * 手动数据节点数据 - 用户手动输入的测试数据
 */
export interface ManualDataNodeData {
  configName: string
  columnName: string
  rows: string[][]
  description?: string
  saveState?: SchemaSaveState
}

/**
 * 模板实例节点数据 - 可复用约束模板的实例
 *
 * 特点:
 * - 引用一个已定义的模板（templateId）
 * - 通过 parameters 字段绑定具体参数值
 * - 连接到上游 Schema/TransformOutput/manualData 获取数据
 * - 后端加载时自动展开为标准 Transform + Constraint 文件
 */
export interface TemplateInstanceNodeData {
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
  /** 参数摘要文本 */
  summaryText: string
  saveState?: SchemaSaveState
  lastSaved?: string
}

/**
 * Transform 输出节点数据 - 绑定在 transform 上的结果展示节点
 *
 * 特点:
 * - 由 transform 节点自动生成，不可独立创建
 * - 删除父 transform 时自动级联删除
 * - 展示转换后的单列数据
 */
export interface TransformOutputNodeData {
  configName: string
  columnName: string
  rows: string[][]
  /** 父 Transform 节点 ID */
  parentTransformId: string
  saveState?: SchemaSaveState
}

/**
 * Schema 集合节点数据 - Schema 容器
 */
export interface SchemaSetNodeData {
  setName: string
  description?: string
}

/**
 * Schema 集合根节点数据
 */
export interface SchemaSetRootNodeData {
  setName: string
}

// ========== JSON 数据源节点类型定义 ==========

/**
 * JSON 数据预览节点数据
 *
 * 用于展示 JSON 文件内容，支持配置 JSONPath、record_path 等解析参数。
 * 可以连接到 JsonSchemaNode 进行结构定义。
 */
export interface JsonSourcePreviewNodeData {
  id: string
  configName: string
  sourceName: string
  fileName: string
  fileType: 'json'
  sourceType: 'json'
  format?: 'json' | 'jsonl' | 'ndjson'
  jsonPath?: string
  recordPath?: string
  data?: string[][] // 表格数据（保留兼容性）
  rawData?: unknown[] // 原始 JSON 数据（用于树状显示）
  headerRow?: number
  actualRowCount?: number
  actualColCount?: number
  totalRows?: number
  totalCols?: number
  previewRowCount?: number
  previewColCount?: number
  fileSize?: number
  lastModified?: number
  isPreviewNode: boolean
  outputPortConnected: boolean
  sourceMode?: SourceMode
  localPath?: string
  /** 当前选中的 Sheet 名称（JSON 数据源也可能复用此字段） */
  currentSheet?: string
  children?: string[]
}

/**
 * JSON Schema 节点数据
 *
 * 用于定义 JSON 数据的表结构，参考 SchemaNodeData 结构。
 * 支持列定义、数据类型、约束、JSONPath 等配置。
 */
export interface JsonSchemaNodeData extends BaseSchemaNodeData<JsonSchemaColumn> {
  sourceType?: 'json'
  jsonPath?: string
  recordPath?: string
  format?: 'json' | 'jsonl' | 'ndjson'
}

/**
 * JSON Schema 列定义
 *
 * 用于定义 JSON Schema 节点中的列结构，
 * 支持 JSONPath 路径、数据类型、嵌套结构等 JSON 专属配置。
 */
export interface JsonSchemaColumn extends BaseSchemaColumn {
  dataType: JsonDataType
  jsonPath: string
  nullable?: boolean
  primaryKey?: boolean
  description?: string

  // 树形结构核心
  children?: JsonSchemaColumn[]
  isExpanded?: boolean

  // 数组元素类型（当 dataType === 'array' 时）
  arrayItemType?: JsonDataType
}

/**
 * JSON 数据类型
 */
export type JsonDataType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

// ========== 自定义节点数据联合类型 ==========

/**
 * 创建一个自定义节点数据类型的联合类型。
 * 这意味着一个节点的 `data` 属性，可以是以下任意一种类型。
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
 * 定义我们应用中自定义节点的最终类型。
 * 它继承自 Vue Flow 的基础 `Node` 类型，但将其泛型参数 `T`（代表 data 对象）
 * 限制为我们自己定义的 `CustomNodeData` 联合类型。
 */
export type CustomNode = Node<CustomNodeData>
