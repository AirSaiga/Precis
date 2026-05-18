/**
 * @file nodeDimensionHelper.ts
 * @description 节点尺寸辅助工具
 *
 * 功能概述：
 * - 从 DOM 获取节点实际渲染尺寸
 * - 按节点类型返回默认尺寸
 * - 优先 DOM 尺寸回退到默认值
 * - 计算多节点包围边界
 */
import { logger } from '@/core/utils/logger'
import { NODE_DIMENSIONS } from '../constants'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

export interface NodeDimension {
  width: number
  height: number
}

/**
 * 从DOM获取节点的实际尺寸
 */
export function getNodeDimensionFromDOM(nodeId: string): NodeDimension | null {
  try {
    const nodeElement =
      (document.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) as HTMLElement | null) ||
      (document.querySelector(`[data-id="${nodeId}"] .vue-flow__node`) as HTMLElement | null) ||
      (document.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null)
    if (nodeElement) {
      const rect = nodeElement.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return {
          width: rect.width,
          height: rect.height,
        }
      }
    }
  } catch (e) {
    logger.warn(`[NodeDimensionHelper] Failed to get dimension for node ${nodeId}:`, e)
  }
  return null
}

/**
 * 获取多个节点的实际尺寸
 */
export function getNodeDimensionsFromDOM(nodeIds: string[]): Map<string, NodeDimension> {
  const dimensions = new Map<string, NodeDimension>()

  for (const nodeId of nodeIds) {
    const dim = getNodeDimensionFromDOM(nodeId)
    if (dim) {
      dimensions.set(nodeId, dim)
    }
  }

  return dimensions
}

/**
 * 根据节点类型获取默认尺寸
 */
export function getDefaultDimension(nodeType: string): NodeDimension {
  if (nodeType === 'projectRoot') {
    return {
      width: NODE_DIMENSIONS.ROOT_WIDTH,
      height: NODE_DIMENSIONS.ROOT_HEIGHT,
    }
  }

  if (isConstraintNodeType(nodeType)) {
    return {
      width: NODE_DIMENSIONS.CONSTRAINT_WIDTH,
      height: NODE_DIMENSIONS.CONSTRAINT_HEIGHT,
    }
  }

  return {
    width: NODE_DIMENSIONS.DEFAULT_WIDTH,
    height: NODE_DIMENSIONS.DEFAULT_HEIGHT,
  }
}

/**
 * 获取节点尺寸（优先使用DOM实际尺寸，否则使用默认值）
 */
export function getNodeDimension(nodeId: string, nodeType: string): NodeDimension {
  const domDimension = getNodeDimensionFromDOM(nodeId)
  if (domDimension) {
    return domDimension
  }
  return getDefaultDimension(nodeType)
}

/**
 * 计算多个节点的边界
 */
export function calculateNodesBounds(
  nodePositions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>,
  padding: number = 20,
  nodeTypeById?: Map<string, string>
): { x: number; y: number; width: number; height: number } | null {
  if (nodePositions.size === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const [nodeId, pos] of nodePositions) {
    const nodeType = nodeTypeById?.get(nodeId) || ''
    const dim = nodeDimensions.get(nodeId) || getDefaultDimension(nodeType)

    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + dim.width)
    maxY = Math.max(maxY, pos.y + dim.height)
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}
