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
 * 实测尺寸参与布局计算的安全放大系数：
 * 吸收网格对齐残差、盒模型（边框/阴影）差异，宁可间隙略大也不重叠。
 */
export const MEASURED_DIMENSION_SAFETY_FACTOR = 1.05

/**
 * 从 unknown 结构中读取 { width, height } 尺寸记录（均为正数才有效）。
 * 供 Vue Flow dimensions / Schema 持久化尺寸等同构字段复用。
 */
function readDimensionRecord(value: unknown): NodeDimension | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const width = record['width']
  const height = record['height']
  if (typeof width !== 'number' || width <= 0) return null
  if (typeof height !== 'number' || height <= 0) return null
  return { width, height }
}

/**
 * 从节点对象上只读提取 Vue Flow 实测尺寸（node.dimensions）。
 *
 * Vue Flow 渲染后经 v-model 回写的节点对象带 `dimensions`
 * （offsetWidth/offsetHeight，未缩放），但 `Node` 输入类型未声明该字段；
 * 此处以 unknown 入参做结构收窄，避免类型断言逃生舱。
 * 渲染前 dimensions 为 {0,0}，返回 null（视为无效候选）。
 */
export function readMeasuredDimension(node: unknown): NodeDimension | null {
  if (!node || typeof node !== 'object') return null
  const record = node as Record<string, unknown>
  return readDimensionRecord(record['dimensions'])
}

/**
 * 从候选尺寸列表解析节点参与布局的尺寸（纯函数，只读不写回节点）。
 *
 * 候选按可靠性由调用方排序（如 Vue Flow dimensions → Schema 持久化尺寸 →
 * DOM rect/zoom 换算值），取第一个 width/height 均为正的候选；
 * 命中后与类型兜底值逐轴取 max 再乘安全系数（保守方向：低估会吃掉间距）。
 * 全部候选无效时返回类型兜底值。
 */
export function resolveMeasuredDimension(
  candidates: ReadonlyArray<NodeDimension | null | undefined>,
  fallback: NodeDimension
): NodeDimension {
  for (const candidate of candidates) {
    if (candidate && candidate.width > 0 && candidate.height > 0) {
      return {
        width: Math.max(candidate.width, fallback.width) * MEASURED_DIMENSION_SAFETY_FACTOR,
        height: Math.max(candidate.height, fallback.height) * MEASURED_DIMENSION_SAFETY_FACTOR,
      }
    }
  }
  return fallback
}

/**
 * 读取 Schema 节点持久化尺寸（data.width/data.height，可拖拽调整后保存）。
 *
 * width 由 useSchemaResizable 持久化（默认 360）；height 可能为空
 * （内容撑开 auto），任一轴无效则整体不作为候选（避免半截尺寸）。
 */
export function getSchemaPersistedDimension(data: unknown): NodeDimension | null {
  return readDimensionRecord(data)
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
