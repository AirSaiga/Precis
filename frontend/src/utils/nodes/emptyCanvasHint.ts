/**
 * @file emptyCanvasHint.ts
 * @description 空画布引导的判定逻辑（纯函数）
 *
 * 画布视口中下部显示"从左侧拖入节点开始建模"引导的条件：
 * 画布上没有任何业务节点（仅项目根节点或全空）。
 * 出现第一个业务节点后引导自动消失。
 *
 * 判定与 UI 解耦：输入只需带 type 字段的节点形状数组，便于单测。
 */

import type { CustomNode } from '@/types/graph'

/** 项目根节点不算业务节点（每个项目打开后必然存在，不构成"开始建模"） */
const NON_BUSINESS_NODE_TYPES = new Set<string>(['projectRoot'])

/**
 * 判断节点列表中是否含有业务节点（即画布是否"非空"）。
 * @param nodes - 画布节点列表
 * @returns true 表示存在至少一个业务节点（隐藏空画布引导）
 */
export function hasBusinessNodes(nodes: ReadonlyArray<CustomNode>): boolean {
  return nodes.some((node) => node.type !== undefined && !NON_BUSINESS_NODE_TYPES.has(node.type))
}

/**
 * 是否显示空画布引导：无业务节点时显示。
 * @param nodes - 画布节点列表
 */
export function shouldShowEmptyCanvasHint(nodes: ReadonlyArray<CustomNode>): boolean {
  return !hasBusinessNodes(nodes)
}
