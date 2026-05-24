/**
 * @fileoverview NodeDataBuilder 类型定义
 *
 * 定义约束/正则节点数据构建所需的输入/输出类型。
 * 所有 builder 函数共享 BuildInput → BuildResult 的纯函数签名。
 */

/** 构建模式 */
export type BuildMode = 'import' | 'embedded' | 'connect'

/** 通用列引用（从 V2 配置解析） */
export interface ColumnRef {
  nodeId: string
  columnId: string
  columnName: string
}

/** FK 双引用 */
export interface FKRefs {
  source: ColumnRef
  target: ColumnRef
}

/** Conditional IF 条件项 */
export interface ConditionalIfItem {
  operator: string
  value: unknown
  values?: unknown[]
  columnId: string
  columnName: string
}

/** 构建输入 — 各字段的含义由 builder 自行解释 */
export interface BuildInput {
  mode: BuildMode
  /** 约束 V2 配置的 description 字段 */
  configName: string
  /** saveState：import/embedded 固定 'saved'，connect 固定 'draft' */
  saveState?: 'saved' | 'draft'
  /** 约束所属 Schema 节点 ID */
  schemaNodeId: string
  /** Schema 表名 */
  tableName: string
  /** 列引用 — 单列约束使用 */
  columnRef?: ColumnRef
  /** FK 双引用 */
  fkRefs?: FKRefs
  /** Conditional IF 条件 */
  ifConditions?: ConditionalIfItem[]
  /** Conditional IF 逻辑 */
  ifLogic?: string
  /** Conditional THEN 列引用 */
  thenRef?: ColumnRef
  /** Conditional THEN 参数 */
  thenConditionConfig?: unknown
  /** V2 原始 params（类型特有参数透传） */
  params?: Record<string, unknown>
  /** V2 原始 refs（类型特有引用透传） */
  refs?: Record<string, unknown>
  /** 是否标记为内嵌约束 */
  embedded?: boolean
  /** 约束节点 ID */
  nodeId: string
  /** 约束节点类型（如 'notNullConstraint'） */
  nodeType: string
}

/** 边描述符 — 声明需要创建的边 */
export interface EdgeDescriptor {
  /** 边类型：'constraint' 普通约束边 | 'fkDisplay' FK展示边 | 'if' Conditional IF边 */
  kind: 'constraint' | 'fkDisplay' | 'if'
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string
  targetHandle?: string
  columnId: string
  /** 额外边属性（style, label, data 等） */
  extra?: Record<string, unknown>
}

/** 构建结果 */
export interface BuildResult {
  nodeData: Record<string, unknown>
  edgeDescriptors: EdgeDescriptor[]
}
