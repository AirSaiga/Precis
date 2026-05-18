/**
 * @file types.ts
 * @description 节点布局组织器类型定义
 *
 * 功能概述：
 * - 定义节点类别枚举与类型映射
 * - 定义布局策略接口与配置类型
 * - 定义区域、位置、选项与结果接口
 * - 定义动画、网格与层级相关类型
 */

/**
 * 节点大类枚举
 */
export enum NodeCategory {
  ROOT = 'root',
  CORE = 'core',
  LIBRARY = 'library',
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
  patternToolbox: NodeCategory.LIBRARY,
  constraintDashboard: NodeCategory.LIBRARY,
  pattern: NodeCategory.LIBRARY,
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
 * 收纳策略类型
 */
export type LayoutStrategy = 'byType' | 'byConnection' | 'byHierarchy' | 'mixed' | 'schemaCentric'

/**
 * Schema家族布局方式
 */
export type SchemaFamilyLayout = 'horizontal' | 'vertical' | 'radial'

/**
 * 防重叠处理方式
 */
export type OverlapResolution = 'shift' | 'scale' | 'none'

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
 * 收纳策略配置
 */
export interface StrategyConfig {
  type: LayoutStrategy
  name: string
  description: string
  icon: string
}

/**
 * 区域配置
 */
export interface ZoneConfig {
  id: string
  name: string
  category: NodeCategory
  widthRatio: number
  heightRatio: number
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  order: number
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
 * 区域位置信息
 */
export interface ZonePosition {
  zoneId: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * 整理选项
 */
export interface OrganizeOptions {
  strategy: LayoutStrategy
  animate: boolean
  animateDuration: number
  gap: number
  margin: number
  enableClustering: boolean
  maxNodesPerRow: number
  sortBy: 'type' | 'name' | 'creationTime'
  preserveConnections: boolean
  compactMode: boolean
  schemaFamilyLayout?: SchemaFamilyLayout
  enableSubGroups?: boolean
  overlapResolution?: OverlapResolution
}

/**
 * 整理结果
 */
export interface OrganizeResult {
  success: boolean
  nodeCount: number
  zoneCount: number
  duration: number
  positions: Map<string, { x: number; y: number }>
  groups: ZoneGroup[]
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
}

/**
 * 层级关系信息
 */
export interface HierarchyLevel {
  level: number
  nodeIds: string[]
  parentIds: string[]
}

/**
 * 动画配置
 */
export interface AnimationConfig {
  duration: number
  stagger: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'cubic'
}

/**
 * 网格配置
 */
export interface GridConfig {
  enabled: boolean
  size: number
  snapStrength: number
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
  options: OrganizeOptions
}

/**
 * 区域布局
 */
export interface ZoneLayout {
  zoneId: string
  x: number
  y: number
  width: number
  height: number
  nodeCount: number
  category: NodeCategory
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
  categoryZones: Map<NodeCategory, ZoneLayout>
}
