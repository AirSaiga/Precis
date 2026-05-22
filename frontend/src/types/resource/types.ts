/**
 * @file types.ts
 * @description 资源树核心类型定义
 *
 * 资源类型分类：
 * - schema: 表结构定义资源
 * - pattern: 正则表达式模式资源
 * - constraint: 约束规则资源
 * - projectConfig: 项目配置文件
 * - patternFolder: 模式文件夹
 * - constraintFolder: 约束文件夹
 */

/**
 * 资源类型枚举
 */
export type ResourceType =
  | 'schema'
  | 'pattern'
  | 'constraint'
  | 'regex_registry'
  | 'regex_node'
  | 'projectConfig'
  | 'patternFolder'
  | 'constraintFolder'
  | 'template'

/**
 * 模式注册表类型
 */
export type PatternRegistryType = 'patterns'

/**
 * 约束来源类型
 */
export type ConstraintSourceType = 'embedded' | 'independent'

/**
 * 内嵌约束资源（作为Schema的子节点展示）
 */
export interface EmbeddedConstraintResource {
  /** 约束唯一标识 */
  id: string
  /** 约束展示名称 */
  name: string
  /** 约束类型 */
  constraintType: string
  /** 约束描述 */
  description?: string
  /** 关联的列ID */
  columnId?: string
  /** 父Schema ID */
  parentSchemaId?: string
}

/**
 * 列字段隐式正则匹配信息
 */
export interface ColumnImplicitRegexInfo {
  /** 列ID */
  columnId: string
  /** 列名 */
  columnName: string
  /** 是否为隐式匹配 */
  isImplicit: boolean
  /** 隐式匹配时推断出的正则节点ID */
  inferredPatternId?: string
}

/**
 * 资源基础接口
 */
export interface BaseResource {
  /** 资源唯一标识 */
  id: string
  /** 资源展示名称 */
  name: string
  /** 资源类型 */
  kind: ResourceType
  /** 资源文件路径 */
  path?: string
  /** 资源元数据 */
  meta?: Record<string, unknown>
  /** 创建时间 */
  createdAt?: string
  /** 更新时间 */
  updatedAt?: string
  /** 是否已拖拽到画布 */
  isOnCanvas?: boolean
}

/**
 * Schema资源
 */
export interface SchemaResource extends BaseResource {
  kind: 'schema'
  /** 表名称 */
  tableName?: string
  /** 列数量 */
  columnCount?: number
  /** 关联的 Regex 节点 ID 列表 */
  associatedRegexIds?: string[]
  /** 关联的 Constraint ID 列表（独立约束） */
  associatedConstraintIds?: string[]
  /** 内嵌约束列表（作为子节点展示） */
  embeddedConstraints?: EmbeddedConstraintResource[]
  /** 隐式正则匹配字段信息 */
  implicitRegexFields?: ColumnImplicitRegexInfo[]
}

/**
 * Pattern资源
 */
export interface PatternResource extends BaseResource {
  kind: 'pattern'
  /** 模式注册表 */
  registry: PatternRegistryType
  /** 是否启用 */
  enabled?: boolean
}

/**
 * Constraint资源
 */
export interface ConstraintResource extends BaseResource {
  kind: 'constraint'
  /** 约束类型 */
  constraintType: string
  /** 约束描述 */
  description?: string
  /** 约束来源：embedded（内嵌）或 independent（独立） */
  constraintSource?: 'embedded' | 'independent'
}

/**
 * 正则表达式注册表资源
 */
export interface RegexRegistryResource extends BaseResource {
  kind: 'regex_registry'
  /** 注册表类型 */
  registry: PatternRegistryType
}

/**
 * 正则表达式节点资源
 */
export interface RegexNodeResource extends BaseResource {
  kind: 'regex_node'
}

/**
 * 项目配置资源
 */
export interface ProjectConfigResource extends BaseResource {
  kind: 'projectConfig'
}

/**
 * 模式文件夹资源
 */
export interface PatternFolderResource extends BaseResource {
  kind: 'patternFolder'
  /** 文件夹作用域 */
  scope: PatternRegistryType
}

/**
 * 约束文件夹资源
 */
export interface ConstraintFolderResource extends BaseResource {
  kind: 'constraintFolder'
  /** 固定为 'constraints' */
  scope: 'constraints'
}

/**
 * 模板资源
 */
export interface TemplateResource extends BaseResource {
  kind: 'template'
  /** 模板文件路径 */
  path: string
  /** 模板描述 */
  description?: string
  /** 参数定义 */
  params?: Record<string, unknown>
}

/**
 * 资源联合类型
 */
export type ResourceItem =
  | SchemaResource
  | PatternResource
  | ConstraintResource
  | RegexRegistryResource
  | RegexNodeResource
  | ProjectConfigResource
  | PatternFolderResource
  | ConstraintFolderResource
  | TemplateResource

/**
 * 资源文件夹类型
 */
export type FolderType =
  | 'schemas'
  | 'patterns'
  | 'regex_nodes'
  | 'constraints'
  | 'projectConfig'
  | 'dataModels'
  | 'validationAssets'
  | 'independentConstraints'
  | 'regexCenter'
  | 'templates'

/**
 * 资源文件夹
 */
export interface ResourceFolder {
  /** 文件夹唯一标识 */
  id: string
  /** 文件夹展示名称（国际化key或显示名称） */
  name: string
  /** 文件夹类型 */
  type: FolderType
  /** 是否展开 */
  expanded: boolean
  /** 子文件夹 */
  children?: ResourceFolder[]
  /** 资源列表（冗余字段，便于模板使用） */
  resources: ResourceItem[]
  /** 资源数量 */
  count: number
}

/**
 * 资源文件夹映射（包含已知顶级文件夹的强类型索引）
 */
export interface ResourceFolderMap extends Record<string, ResourceFolder> {
  /** 项目配置文件夹 */
  projectConfig: ResourceFolder
  /** 数据模型文件夹 */
  dataModels: ResourceFolder
  /** 校验资源文件夹 */
  validationAssets: ResourceFolder
}

/**
 * 资源树状态
 */
export interface ResourceTreeState {
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null
  /** 搜索关键词 */
  searchQuery: string
  /** 资源映射表 */
  resources: Record<string, ResourceItem>
  /** 文件夹状态 */
  folders: ResourceFolderMap
  /** 项目配置路径 */
  configPath: string | null
}

/**
 * 资源操作结果
 */
export interface ResourceOperationResult<T = void> {
  /** 是否成功 */
  success: boolean
  /** 返回数据 */
  data?: T
  /** 错误信息 */
  error?: string
}

/**
 * 资源过滤选项
 */
export interface ResourceFilterOptions {
  /** 搜索关键词 */
  searchQuery?: string
  /** 资源类型过滤 */
  kind?: ResourceType | ResourceType[]
  /** 文件夹过滤 */
  folder?: FolderType
}
