/**
 * @file payload.ts
 * @description 资源拖拽负载类型定义
 *
 * 设计说明：
 * - 统一资源拖拽和数据源拖拽的负载格式
 * - 支持多种资源类型的拖拽操作
 * - 提供类型安全的拖拽数据访问
 */

/**
 * 资源拖拽类型
 */
export type ResourceDragType =
  | 'schema'
  | 'pattern'
  | 'regex'
  | 'regex_node'
  | 'constraint'
  | 'transform'
  | 'manualData'
  | 'projectConfig'
  | 'projectRoot'
  | 'patternFolder'
  | 'constraintFolder'
  | 'external_data_source'

/**
 * 资源拖拽来源
 */
export type ResourceDragSource = 'toolbox' | 'projectResources' | 'dataLibrary'

/**
 * 资源拖拽负载基础接口
 */
export interface BaseDragPayload {
  /** 拖拽类型 */
  type: ResourceDragType
  /** 拖拽来源 */
  source: ResourceDragSource
  /** 展示标签 */
  label?: string
  /** 元数据 */
  meta?: Record<string, unknown>
  /** 关联的 Regex 节点 ID 列表 */
  associatedRegexIds?: string[]
  /** 关联的 Constraint ID 列表 */
  associatedConstraintIds?: string[]
}

/**
 * 工具箱拖拽负载
 */
export interface ToolboxDragPayload extends BaseDragPayload {
  source: 'toolbox'
  /** 工具类型 */
  toolType: 'schema' | 'pattern' | 'constraint'
}

/**
 * 资源树条目拖拽负载
 */
export interface ResourceItemDragPayload extends BaseDragPayload {
  source: 'projectResources'
  /** 资源ID */
  resourceId: string
  /** 资源类型 */
  resourceKind: 'schema' | 'pattern' | 'constraint'
}

/**
 * 文件夹拖拽负载
 */
export interface FolderDragPayload extends BaseDragPayload {
  source: 'projectResources'
  /** 文件夹作用域 */
  scope: string
}

/**
 * 项目配置拖拽负载
 */
export interface ProjectConfigDragPayload extends BaseDragPayload {
  source: 'projectResources'
  kind: 'projectConfig'
}

/**
 * 数据源拖拽负载
 */
export interface DataSourceDragPayload extends BaseDragPayload {
  source: 'dataLibrary'
  /** 数据源ID */
  sourceId: string
  /** 文件ID */
  fileId: string
  /** 文件名称 */
  fileName: string
  /** 文件类型 */
  fileType: 'excel' | 'csv' | 'json'
  /** 来源模式 */
  sourceMode: 'localfile'
  /** 本地路径 */
  localPath?: string
}

/**
 * 拖拽负载联合类型
 */
export type ResourceDragPayload =
  | ToolboxDragPayload
  | ResourceItemDragPayload
  | FolderDragPayload
  | ProjectConfigDragPayload
  | DataSourceDragPayload

/**
 * 拖拽状态接口
 */
export interface ResourceDragState {
  /** 是否正在拖拽 */
  isDragging: boolean
  /** 当前拖拽负载 */
  payload: ResourceDragPayload | null
}

/**
 * 拖拽幽灵元素配置
 */
export interface DragGhostConfig {
  /** 元素类型 */
  variant: 'schema' | 'pattern' | 'constraint' | 'folder' | 'project'
  /** 展示标签 */
  label: string
  /** 自定义样式类 */
  customClass?: string
}

/**
 * 拖拽事件处理器类型
 */
export type DragEventHandler = (event: DragEvent, ...args: unknown[]) => void

/**
 * 拖拽放置处理选项
 */
export interface DropHandlerOptions {
  /** 放置位置 */
  position: { x: number; y: number }
  /** 是否包含依赖 */
  includeDeps?: boolean
  /** 是否移动已存在的节点 */
  moveIfExists?: boolean
}

/**
 * 拖拽操作配置
 */
export interface DragOperationConfig {
  /** 数据传输格式 */
  dataFormat: string
  /** 允许的拖拽效果 */
  effectAllowed: DragEffectAllowed
  /** 是否创建幽灵元素 */
  createGhost?: boolean
}

/**
 * 拖拽效果类型
 */
export type DragEffectAllowed =
  | 'copy'
  | 'move'
  | 'link'
  | 'copyMove'
  | 'copyLink'
  | 'linkMove'
  | 'none'
  | 'uninitialized'
