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
 * @file types.ts
 * @description 节点布局组织器类型定义
 */

import type { CustomNode } from '@/types/nodes'

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
 *
 * 注意：此表必须覆盖 CustomNodeData 联合的全部运行时 type 字符串。
 * 缺失的类型会被 layoutCalculator.classifyNodes 判为 unclassified，
 * 进而被 schemaCentricStrategy 排除出布局（buildExcludedNodeIds），
 * 整理时保持陈旧位置，与重排后的家族卡片重叠（2026-08-28 视觉测试 D5）。
 */
export const NODE_TYPE_TO_CATEGORY: Record<string, NodeCategory> = {
  projectRoot: NodeCategory.ROOT,
  schema: NodeCategory.CORE,
  sourcePreview: NodeCategory.CORE,
  jsonSourcePreview: NodeCategory.CORE,
  jsonSchema: NodeCategory.CORE,
  regex: NodeCategory.CORE,
  manualData: NodeCategory.CORE,
  transform: NodeCategory.CORE,
  transformOutput: NodeCategory.CORE,
  templateInstance: NodeCategory.CORE,
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
  /** 整理完成后是否自动取景。手动整理默认开；自动整理（编辑过程中后台触发）应关，避免视口频跳 */
  fitViewAfter?: boolean
  /**
   * 家族内约束区分节维度：
   * - 'column'（默认）列亲和——每节对应一个 Schema 列，节内混合各约束类型，
   *   按列序排列；无列引用/columnId 失效的约束沉底为"表级"节
   * - 'type' 按约束类型分节（历史行为）
   */
  constraintGrouping?: 'column' | 'type'
}

/**
 * 成员节点的目标 Schema 列信息（列亲和分节用）。
 *
 * 由策略层从 node.data.sourceRef.columnId（精确）与 column/sourceColumn
 * 列名回退解析得出；无法解析的成员不入表，布局层归入表级节。
 */
export interface MemberColumnTarget {
  /** 目标列 id（Schema 列表条目的 id） */
  columnId: string
  /** 目标列显示名（列节标题） */
  columnName: string
  /** 目标列在 Schema 列表中的序号（0-based） */
  columnIndex: number
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
  nodeDataById: Map<string, CustomNode>
  connections: ConnectionInfo[]
  gap: number
  /** 家族内约束区分节维度（缺省 'column' 列亲和） */
  constraintGrouping?: 'column' | 'type'
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
