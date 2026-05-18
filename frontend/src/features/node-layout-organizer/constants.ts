/**
 * @file constants.ts
 * @description 节点布局组织器常量定义
 *
 * 功能概述：
 * - 定义默认整理选项与收纳策略配置
 * - 定义区域配置、节点尺寸与动画常量
 * - 定义节点类型优先级、颜色映射与显示名称
 * - 定义缓动函数与快捷键配置
 */
import type { OrganizeOptions, ZoneConfig, StrategyConfig } from './types'
import { NodeCategory } from './types'

/**
 * 默认整理选项
 */
export const DEFAULT_ORGANIZE_OPTIONS: OrganizeOptions = {
  strategy: 'schemaCentric',
  animate: true,
  animateDuration: 400,
  gap: 30,
  margin: 40,
  enableClustering: true,
  maxNodesPerRow: 4,
  sortBy: 'type',
  preserveConnections: true,
  compactMode: false,
  schemaFamilyLayout: 'horizontal',
  enableSubGroups: true,
  overlapResolution: 'shift',
}

/**
 * 区域配置
 */
export const ZONE_CONFIGS: ZoneConfig[] = [
  {
    id: 'root-zone',
    name: '根节点区域',
    category: NodeCategory.ROOT,
    widthRatio: 0.3,
    heightRatio: 0.12,
    position: 'top',
    order: 0,
  },
  {
    id: 'core-zone',
    name: '核心节点区域',
    category: NodeCategory.CORE,
    widthRatio: 0.45,
    heightRatio: 0.6,
    position: 'left',
    order: 1,
  },
  {
    id: 'library-zone',
    name: '库节点区域',
    category: NodeCategory.LIBRARY,
    widthRatio: 0.2,
    heightRatio: 0.25,
    position: 'right',
    order: 2,
  },
  {
    id: 'constraint-zone',
    name: '约束节点区域',
    category: NodeCategory.CONSTRAINT,
    widthRatio: 0.35,
    heightRatio: 0.35,
    position: 'bottom',
    order: 3,
  },
]

/**
 * 收纳策略配置
 */
export const STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    type: 'byType',
    name: '按类型分组',
    description: '将相同类型的节点分组显示',
    icon: 'category',
  },
  {
    type: 'byConnection',
    name: '按连接关系',
    description: '根据节点间的连接关系进行布局',
    icon: 'hub',
  },
  {
    type: 'byHierarchy',
    name: '按层级关系',
    description: '按数据流向的层级关系排列',
    icon: 'account_tree',
  },
  {
    type: 'mixed',
    name: '智能混合',
    description: '综合考虑多种因素进行智能布局',
    icon: 'auto_awesome',
  },
  {
    type: 'schemaCentric',
    name: '以Schema为核心',
    description: '以Schema表节点为核心，将关联的Regex/Constraint节点收纳到同一区域',
    icon: 'table_chart',
  },
]

/**
 * 节点尺寸常量
 */
export const NODE_DIMENSIONS = {
  DEFAULT_WIDTH: 280,
  DEFAULT_HEIGHT: 120,
  MIN_WIDTH: 200,
  MAX_WIDTH: 400,
  CONSTRAINT_WIDTH: 260,
  CONSTRAINT_HEIGHT: 100,
  ROOT_WIDTH: 320,
  ROOT_HEIGHT: 80,
}

/**
 * 动画常量
 */
export const ANIMATION_CONSTANTS = {
  DEFAULT_DURATION: 400,
  MAX_DURATION: 1000,
  MIN_DURATION: 100,
  STAGGER_DELAY: 30,
  MAX_STAGGER_DELAY: 100,
}

/**
 * 布局常量
 */
export const LAYOUT_CONSTANTS = {
  DEFAULT_GAP: 30,
  MIN_GAP: 10,
  MAX_GAP: 100,
  DEFAULT_MARGIN: 40,
  MAX_NODES_PER_ROW: 4,
  MIN_NODES_PER_ROW: 2,
  ZONE_PADDING: 20,
  CANVAS_PADDING: 60,
  SCHEMA_FAMILY_PADDING: 40,
  SUB_GROUP_PADDING: 20,
  SCHEMA_CENTER_GAP: 30,
  OVERLAP_RESOLUTION_STEP: 50,
  MAX_OVERLAP_RESOLUTION_ATTEMPTS: 20,
}

/**
 * 节点类型优先级（决定同区域内的排列顺序）
 */
export const NODE_TYPE_PRIORITY: Record<string, number> = {
  projectRoot: 0,
  schema: 10,
  sourcePreview: 11,
  jsonSourcePreview: 12,
  jsonSchema: 13,
  regex: 14,
  patternToolbox: 20,
  constraintDashboard: 21,
  pattern: 22,
  foreignKeyConstraint: 30,
  allowedValuesConstraint: 31,
  conditionalConstraint: 32,
  scriptedConstraint: 33,
  notNullConstraint: 34,
  uniqueConstraint: 35,
  rangeConstraint: 36,
  charsetConstraint: 37,
  dateLogicConstraint: 38,
  constraint: 39,
}

/**
 * 节点类型显示名称
 */
export const NODE_TYPE_NAMES: Record<string, string> = {
  projectRoot: '项目根节点',
  schema: 'Schema节点',
  sourcePreview: '数据源预览',
  jsonSourcePreview: 'JSON数据源',
  jsonSchema: 'JSON结构',
  regex: '正则校验',
  patternToolbox: '模式工具箱',
  constraintDashboard: '约束看板',
  pattern: '模式节点',
  constraint: '通用约束',
  notNullConstraint: '非空约束',
  uniqueConstraint: '唯一约束',
  foreignKeyConstraint: '外键约束',
  allowedValuesConstraint: '允许值约束',
  conditionalConstraint: '条件约束',
  scriptedConstraint: '脚本约束',
  rangeConstraint: '范围约束',
  charsetConstraint: '字符集约束',
  dateLogicConstraint: '日期逻辑约束',
}

/**
 * 分组颜色配置
 */
export const GROUP_COLORS: Record<string, { border: string; background: string; text: string }> = {
  [NodeCategory.ROOT]: {
    border: 'rgba(76, 175, 80, 0.6)',
    background: 'rgba(76, 175, 80, 0.1)',
    text: '#4CAF50',
  },
  [NodeCategory.CORE]: {
    border: 'rgba(33, 150, 243, 0.6)',
    background: 'rgba(33, 150, 243, 0.1)',
    text: '#2196F3',
  },
  [NodeCategory.LIBRARY]: {
    border: 'rgba(156, 39, 176, 0.6)',
    background: 'rgba(156, 39, 176, 0.1)',
    text: '#9C27B0',
  },
  [NodeCategory.CONSTRAINT]: {
    border: 'rgba(255, 152, 0, 0.6)',
    background: 'rgba(255, 152, 0, 0.1)',
    text: '#FF9800',
  },
}

/**
 * 节点类型颜色
 */
export const NODE_TYPE_COLORS: Record<string, string> = {
  projectRoot: '#4CAF50',
  schema: '#2196F3',
  sourcePreview: '#03A9F4',
  jsonSourcePreview: '#29B6F6',
  jsonSchema: '#42A5F5',
  regex: '#00BCD4',
  patternToolbox: '#9C27B0',
  constraintDashboard: '#7B1FA2',
  pattern: '#AB47BC',
  constraint: '#FF9800',
  notNullConstraint: '#F44336',
  uniqueConstraint: '#E91E63',
  foreignKeyConstraint: '#FF5722',
  allowedValuesConstraint: '#795548',
  conditionalConstraint: '#607D8B',
  scriptedConstraint: '#9E9E9E',
  rangeConstraint: '#8D6E63',
  charsetConstraint: '#66BB6A',
  dateLogicConstraint: '#FFA726',
}

/**
 * 类别显示名称
 */
export const CATEGORY_NAMES: Record<NodeCategory, string> = {
  [NodeCategory.ROOT]: '根节点',
  [NodeCategory.CORE]: '核心节点',
  [NodeCategory.LIBRARY]: '库节点',
  [NodeCategory.CONSTRAINT]: '约束节点',
}

/**
 * 缓动函数
 */
export const EASING_FUNCTIONS = {
  linear: (t: number): number => t,
  easeIn: (t: number): number => t * t,
  easeOut: (t: number): number => t * (2 - t),
  easeInOut: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
}

/**
 * 快捷键配置
 */
export const SHORTCUT_KEYS = {
  ORGANIZE: 'Ctrl+Shift+O',
  AUTO_ORGANIZE_TOGGLE: 'Ctrl+Shift+A',
}
