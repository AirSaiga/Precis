/**
 * @file constants.ts
 * @description 节点布局组织器常量定义
 */

import type { OrganizeOptions } from './types'
import { NodeCategory } from './types'

/**
 * 默认整理选项
 */
export const DEFAULT_ORGANIZE_OPTIONS: OrganizeOptions = {
  animate: true,
  animateDuration: 400,
  gap: 30,
  margin: 40,
}

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
  ROOT_WIDTH: 300,
  ROOT_HEIGHT: 120,
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
  COLUMN_ROW_HEIGHT: 130,
  CONSTRAINT_COLUMNS_GAP: 60,
}

/**
 * 节点类型显示名称
 *
 * 约束类型条目统一与 i18n 的 `constraintTypes.<kind>` 命名空间术语对齐
 * （range→区间约束、composite→复合约束），消除历史上「范围/区间」「组合/复合」的漂移。
 * 需要在运行时按 locale 渲染时，改用 getConstraintKindByNodeType + i18n 解析；
 * 此静态表作为布局计算阶段的非响应式回退名（familyLayout 用作分组标题）。
 */
export const NODE_TYPE_NAMES: Record<string, string> = {
  projectRoot: '项目根节点',
  schema: 'Schema节点',
  sourcePreview: '数据源预览',
  jsonSourcePreview: 'JSON数据源',
  jsonSchema: 'JSON结构',
  regex: '正则校验',
  regexExtract: '正则提取',
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
  rangeConstraint: '区间约束',
  charsetConstraint: '字符集约束',
  dateLogicConstraint: '日期逻辑约束',
  compositeConstraint: '复合约束',
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
  regexExtract: '#00BCD4',
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
  compositeConstraint: '#78909C',
}
