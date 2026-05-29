/**
 * @file types.ts
 * @description 节点布局组织器类型定义
 */

/**
 * 节点大类枚举
 */
export enum NodeCategory {
  ROOT = 'root',
  CORE = 'core',
  CONSTRAINT = 'constraint',
}

/**
 * 节点类型到类别的映射配置
 */
export const NODE_TYPE_TO_CATEGORY: Record<string, NodeCategory> = {
  projectRoot: NodeCategory.ROOT,
  schema: NodeCategory.CORE,
  sourcePreview: NodeCategory.CORE,
  jsonSourcePreview: NodeCategory.CORE,
  jsonSchema: NodeCategory.CORE,
  regex: NodeCategory.CORE,
  constraint: NodeCategory.CONSTRAINT,
  notNullConstraint: NodeCategory.CONSTRAINT,
  uniqueConstraint: NodeCategory.CONSTRAINT,
  foreignKeyConstraint: NodeCategory.CONSTRAINT,
  allowedValuesConstraint: NodeCategory.CONSTRAINT,
  conditionalConstraint: NodeCategory.CONSTRAINT,
  scriptedConstraint: NodeCategory.CONSTRAINT,
  rangeConstraint: NodeCategory.CONSTRAINT,
  charsetConstraint: NodeCategory.CONSTRAINT,
  dateLogicConstraint: NodeCategory.CONSTRAINT,
  compositeConstraint: NodeCategory.CONSTRAINT,
}

/**
 * 布局策略接口
 */
export interface ILayoutStrategy {
  calculate(
    classification: NodeClassification,
    connections: ConnectionInfo[],
    context: LayoutContext
  ): GroupedLayout
}

/**
 * 二级子框结构
 */
export interface SubGroup {
  id: string
  name: string
  nodeType: string
  nodeIds: string[]
  x: number
  y: number
  width: number
  height: number
  color: string
  collapsed: boolean
}

/**
 * Schema家族结构（以Schema节点为核心的关联节点组）
 */
export interface SchemaFamily {
  id: string
  schemaId: string
  schemaNodeId: string
  subGroups: SubGroup[]
  x: number
  y: number
  width: number
  height: number
  color: string
}

/**
 * 节点位置信息
 */
export interface NodePosition {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * 整理选项
 */
export interface OrganizeOptions {
  animate: boolean
  animateDuration: number
  gap: number
  margin: number
}

/**
 * 节点分类结果
 */
export interface NodeClassification {
  byCategory: Map<NodeCategory, string[]>
  byType: Map<string, string[]>
  unclassified: string[]
}

/**
 * 连接关系信息
 */
export interface ConnectionInfo {
  source: string
  target: string
  sourceType: string
  targetType: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * 布局计算上下文
 */
export interface LayoutContext {
  canvasWidth: number
  canvasHeight: number
  viewportZoom?: number
  nodes: NodePosition[]
  nodeDataById: Map<string, any>
  connections: ConnectionInfo[]
  gap: number
}

/**
 * 分组（用于可视化外框）
 */
export interface ZoneGroup {
  id: string
  name: string
  category: NodeCategory
  nodeType: string
  nodeIds: string[]
  x: number
  y: number
  width: number
  height: number
  color: string
  collapsed: boolean
  visibleNodeIds: string[]
  parentId?: string
  depth?: number
}

/**
 * 分组布局结果
 */
export interface GroupedLayout {
  positions: Map<string, { x: number; y: number }>
  groups: ZoneGroup[]
}
