/**
 * @file drag.ts
 * @description 拖拽相关类型定义
 */

// ========== 拖拽和文件相关类型定义 ==========

/**
 * 拖拽源类型。
 *
 * 标识拖拽操作的发起位置，用于区分不同的拖拽场景。
 *
 * @values
 * - 'toolbox': 从工具箱面板拖拽
 * - 'explorer': 从资源浏览器/资源树拖拽
 * - 'input_staging': 从输入暂存区拖拽（如数据源导入面板）
 */
export type DragSource = 'toolbox' | 'explorer' | 'input_staging'

/**
 * 拖拽操作类型。
 *
 * 定义拖拽行为的具体目的，决定释放时的处理逻辑。
 *
 * @values
 * - 'create_node': 在画布上创建新节点
 * - 'load_resource': 加载已有资源到画布
 * - 'bind_column': 绑定列（用于列与数据源的关联）
 */
export type DragOperation = 'create_node' | 'load_resource' | 'bind_column'

/**
 * 文件资源类型。
 *
 * 标识被拖拽的资源种类，用于路由到对应的导入/创建逻辑。
 *
 * @values
 * - 'schema': 表结构定义资源
 * - 'pattern': 正则模式资源
 * - 'source': 数据源文件资源
 * - 'constraint': 约束规则资源
 * - 'external_data_source': 外部数据源资源
 */
export type FileResourceType =
  | 'schema'
  | 'pattern'
  | 'source'
  | 'constraint'
  | 'external_data_source'

/**
 * 拖拽载荷数据结构。
 *
 * 描述一次拖拽操作所携带的完整信息，用于在拖拽源和释放目标之间传递数据。
 */
export interface DragPayload {
  /** 拖拽操作类型，决定释放时的处理逻辑 */
  op: DragOperation
  /** 拖拽来源，标识拖拽操作的发起位置 */
  source: DragSource
  /** 资源类型，标识被拖拽的资源种类 */
  type: FileResourceType
  /** 元数据，包含资源的具体信息 */
  meta: {
    /** 文件路径（可选） */
    filePath?: string
    /** 文件名称（可选） */
    fileName?: string
    /** 文件类型（可选） */
    fileType?: 'yaml' | 'xlsx' | 'csv' | 'json'
    /** 默认标签，用于新节点的显示名称（可选） */
    defaultLabel?: string
    /** 是否为引用模式（可选） */
    isRef?: boolean
    /** 初始配置对象，用于预填充节点数据（可选） */
    initialConfig?: Record<string, unknown>
  }
}

/**
 * Pattern 拖拽载荷数据结构。
 *
 * 专门用于拖拽正则模式资源时的载荷，包含模式名称、类型和内容。
 */
export interface PatternDragPayload extends Omit<DragPayload, 'meta'> {
  /** 固定为 'pattern' */
  type: 'pattern'
  /** 模式元数据 */
  meta: {
    /** 模式名称 */
    patternName: string
    /** 模式类型 */
    patternType: string
    /** 模式内容（可选） */
    patternContent?: string
  }
}

/**
 * Schema 拖拽载荷数据结构。
 *
 * 专门用于拖拽 Schema 资源时的载荷，包含 Schema 名称和配置。
 */
export interface SchemaDragPayload extends Omit<DragPayload, 'meta'> {
  /** 固定为 'schema' */
  type: 'schema'
  /** Schema 元数据 */
  meta: {
    /** Schema 名称 */
    schemaName: string
    /** Schema 配置对象（SchemaNodeData 类型将在 nodes.ts 中定义） */
    schemaConfig: Record<string, unknown>
  }
}

/**
 * 外部数据源拖拽载荷数据结构。
 *
 * 专门用于从输入暂存区拖拽外部数据源时的载荷，包含数据源的完整信息。
 */
export interface ExternalDataSourceDragPayload extends DragPayload {
  /** 固定为 'external_data_source' */
  type: 'external_data_source'
  /** 数据源唯一标识符 */
  sourceId: string
  /** 数据源显示名称 */
  name: string
  /** 文件类型：excel、csv 或 json */
  fileType: 'excel' | 'csv' | 'json'
  /** 文件名称（含扩展名） */
  fileName: string
  /** 拖拽来源，固定为 'input_staging' */
  dragSource: 'input_staging'
  /** 节点标签，用于在画布上展示 */
  label: string
}

/**
 * 拖拽状态信息。
 *
 * 用于全局追踪当前的拖拽状态，包括是否正在拖拽、当前载荷、悬停目标等。
 */
export interface DragState {
  /** 是否正在拖拽中 */
  isDragging: boolean
  /** 当前拖拽的载荷数据，未拖拽时为 null */
  payload: DragPayload | null
  /** 当前拖拽的来源（可选，用于状态追踪） */
  dragSource?: DragSource
  /** 当前悬停的目标节点 ID（可选） */
  hoverTarget?: string
}
