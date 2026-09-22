/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
  fitViewAfter: true,
  constraintGrouping: 'column',
}

// 安全取景留白常量已上移至中立位置 services/canvas/fitViewPadding.ts
// （canvasStore 等 store/服务层也依赖它，store → feature 是反向依赖）。
// 此处 re-export 保持 feature 内外的既有导入路径不变。
export { SAFE_FITVIEW_PADDING_PX, SAFE_FITVIEW_PADDING } from '@/services/canvas/fitViewPadding'

/**
 * 节点尺寸常量（无实测尺寸时的兜底估算，高度宁可高估——
 * 高估只让布局更松散，低估会吃掉行间距造成相邻节点重叠）
 */
export const NODE_DIMENSIONS = {
  DEFAULT_WIDTH: 280,
  // 实测（GUI 测试 DEF-14）：manualData 约 164 高，取 170 留余量
  DEFAULT_HEIGHT: 170,
  MIN_WIDTH: 200,
  MAX_WIDTH: 400,
  CONSTRAINT_WIDTH: 260,
  // 实测约束节点约 120 高（DEF-14），取 130 留余量
  CONSTRAINT_HEIGHT: 130,
  ROOT_WIDTH: 300,
  // 实测 projectRoot 约 126 高（DEF-14），取 140 留余量
  ROOT_HEIGHT: 140,
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
  /**
   * 布局坐标网格对齐粒度（单一事实源，整理/加载适配共用）。
   *
   * 不重叠不变量：单坐标对齐误差 ≤ GRID_SIZE/2，相邻两节点独立取整的
   * 相对误差 ≤ GRID_SIZE，因此要求 GRID_SIZE < DEFAULT_GAP（20 < 30），
   * 保证对齐后最小间隙仍为 DEFAULT_GAP - GRID_SIZE = 10 > 0。
   *
   * 历史缺陷（DEF-14）：曾存在两道独立网格对齐（LayoutCalculator 30 网格
   * + useNodeOrganizer 20 网格），相对误差叠加可达 50px 吃掉全部间距，
   * 造成相邻节点边缘重叠。现在全链路只允许一次对齐，统一用本常量。
   */
  GRID_SIZE: 20,
  /**
   * 列亲和分节（constraintGrouping: 'column'）的行对齐下拉余量上限。
   *
   * 列节顶部向"该列在 Schema 节点中的估算行顶"对齐是尽力而为（best-effort）：
   * 列节高度（≥130px）远大于估算行高，对齐只在目标行顶超过当前落点游标的
   * 有限范围内生效；超出此余量不再下拉，避免节间出现大段空白、家族被拉高
   * 后超出 k 列选择阶段（measureSection 不感知对齐）的尺寸预估。
   */
  COLUMN_ALIGN_MAX_SLACK_PX: 120,
}

/**
 * 列亲和分节的节标题。
 *
 * 列节标题直接用列名（不再复用按类型命名的 NODE_TYPE_NAMES——列节内
 * 类型混合，类型名标题不再适用）；表级节用固定标题。
 */
export const COLUMN_GROUPING_LABELS = {
  /** 表级约束节标题（无列引用 / columnId 失效的约束沉底于此） */
  TABLE_LEVEL_NAME: '表级约束',
} as const

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

/**
 * 列亲和分节的节配色。
 *
 * 列节内约束类型混合，按类型着色不再适用：统一用约束类主色
 * （NODE_TYPE_COLORS.constraint）表达"约束分组"语义，表级节用中性灰区分。
 */
export const COLUMN_GROUPING_COLORS = {
  /** 列节 */
  COLUMN: NODE_TYPE_COLORS.constraint || '#FF9800',
  /** 表级节 */
  TABLE_LEVEL: '#9e9e9e',
} as const
