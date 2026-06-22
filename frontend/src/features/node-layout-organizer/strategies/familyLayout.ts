/**
 * @file familyLayout.ts
 * @description 家族内部布局辅助函数
 *
 * 功能概述：
 * - 单个 Schema 家族内部的流式布局计算
 * - 节点分类、边界计算、维度回退
 * - 按列对齐约束节点
 */
import type { SubGroup, ConnectionInfo } from '../types'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import {
  GROUP_COLORS,
  LAYOUT_CONSTANTS,
  NODE_DIMENSIONS,
  NODE_TYPE_COLORS,
  NODE_TYPE_NAMES,
} from '../constants'
import { getDefaultDimension, type NodeDimension } from '../utils/nodeDimensionHelper'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
/**
 * 获取节点类型的回退尺寸
 */
export function getFallbackDimension(nodeType: string): NodeDimension {
  if (nodeType === 'schema') return { width: 320, height: 400 }
  if (nodeType === 'regex')
    return { width: NODE_DIMENSIONS.DEFAULT_WIDTH, height: NODE_DIMENSIONS.DEFAULT_HEIGHT }
  if (isConstraintNodeType(nodeType))
    return { width: NODE_DIMENSIONS.CONSTRAINT_WIDTH, height: NODE_DIMENSIONS.CONSTRAINT_HEIGHT }
  const dim = getDefaultDimension(nodeType)
  return { width: dim.width, height: dim.height }
}

/**
 * 按节点类型对节点 ID 进行分组
 */
export function groupByType(
  nodeIds: string[],
  nodeTypeById: Map<string, string>
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const id of nodeIds) {
    const type = nodeTypeById.get(id) || 'unknown'
    if (!result.has(type)) result.set(type, [])
    result.get(type)!.push(id)
  }
  for (const [type, ids] of result) {
    result.set(
      type,
      ids.slice().sort((a, b) => a.localeCompare(b))
    )
  }
  return result
}

/**
 * 流式布局：将节点按顺序从左到右、从上到下排列
 * 当行宽度超过 maxWidth 时自动换行
 */
export function flowLayout(
  nodeIds: string[],
  outPositions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>,
  startX: number,
  startY: number,
  maxWidth: number,
  gap: number
): { bounds: { x: number; y: number; width: number; height: number }; nextY: number } {
  let x = startX
  let y = startY
  let rowHeight = 0
  let maxX = startX
  let maxY = startY

  for (const id of nodeIds) {
    const dim = nodeDimensions.get(id) || getFallbackDimension('')
    if (x > startX && x + dim.width > startX + maxWidth) {
      x = startX
      y += rowHeight + gap
      rowHeight = 0
    }

    outPositions.set(id, { x, y })
    maxX = Math.max(maxX, x + dim.width)
    maxY = Math.max(maxY, y + dim.height)
    rowHeight = Math.max(rowHeight, dim.height)
    x += dim.width + gap
  }

  return {
    bounds: {
      x: startX,
      y: startY,
      width: Math.max(0, maxX - startX),
      height: Math.max(0, maxY - startY),
    },
    nextY: maxY,
  }
}

/**
 * 从局部坐标计算节点包围边界（无 padding）
 */
export function calculateBoundsFromLocal(
  nodeIds: string[],
  positions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>
): { x: number; y: number; width: number; height: number } | null {
  if (nodeIds.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of nodeIds) {
    const pos = positions.get(id)
    const dim = nodeDimensions.get(id)
    if (!pos || !dim) continue
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + dim.width)
    maxY = Math.max(maxY, pos.y + dim.height)
  }

  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 从位置计算带 padding 的节点包围边界
 */
export function calculateBoundsFromPositions(
  nodeIds: string[],
  positions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>,
  nodeTypeById: Map<string, string>,
  padding: number
): { x: number; y: number; width: number; height: number } | null {
  if (nodeIds.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of nodeIds) {
    const pos = positions.get(id)
    if (!pos) continue
    const dim = nodeDimensions.get(id) || getFallbackDimension(nodeTypeById.get(id) || '')
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + dim.width)
    maxY = Math.max(maxY, pos.y + dim.height)
  }

  if (minX === Infinity) return null
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/**
 * 计算单个 Schema 家族的内部布局
 */
export function layoutFamily(params: {
  familyId: string
  familyName: string
  schemaNodeId: string | null
  memberNodeIds: string[]
  nodeTypeById: Map<string, string>
  nodeDimensions: Map<string, NodeDimension>
  canvasWidth: number
  layoutMode: 'horizontal' | 'vertical'
  gap: number
  edges: ConnectionInfo[]
}): {
  localPositions: Map<string, { x: number; y: number }>
  subGroups: SubGroup[]
  width: number
  height: number
  color: string
} {
  const {
    schemaNodeId,
    memberNodeIds,
    nodeTypeById,
    nodeDimensions,
    canvasWidth,
    layoutMode,
    gap,
  } = params
  const localPositions = new Map<string, { x: number; y: number }>()

  const familyPadding = 40
  const sectionGap = 40

  const allIds = (schemaNodeId ? [schemaNodeId, ...memberNodeIds] : memberNodeIds.slice()).filter(
    Boolean
  ) as string[]

  const sources: string[] = []
  const regexNodes: string[] = []
  const constraints: string[] = []
  const others: string[] = []

  for (const id of memberNodeIds) {
    const type = nodeTypeById.get(id) || ''
    if (type === 'sourcePreview' || type === 'jsonSourcePreview') sources.push(id)
    else if (type === 'regex') regexNodes.push(id)
    else if (NODE_TYPE_TO_CATEGORY[type] === NodeCategory.CONSTRAINT || isConstraintNodeType(type))
      constraints.push(id)
    else others.push(id)
  }

  sources.sort((a, b) => a.localeCompare(b))
  regexNodes.sort((a, b) => a.localeCompare(b))
  constraints.sort((a, b) => a.localeCompare(b))
  others.sort((a, b) => a.localeCompare(b))

  const subGroups: SubGroup[] = []
  const familyColor = GROUP_COLORS[NodeCategory.CORE]?.border || '#2196f3'

  const maxFamilyWidth = Math.max(
    700,
    Math.min(1200, canvasWidth - LAYOUT_CONSTANTS.CANVAS_PADDING * 2)
  )

  if (layoutMode === 'vertical') {
    let y = familyPadding
    if (schemaNodeId) {
      localPositions.set(schemaNodeId, { x: familyPadding, y })
      const dim = nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      y += dim.height + sectionGap
    }

    const placeSection = (nodeIds: string[], label: string, color: string, nodeType: string) => {
      if (nodeIds.length === 0) return
      const { bounds, nextY } = flowLayout(
        nodeIds,
        localPositions,
        nodeDimensions,
        familyPadding,
        y,
        maxFamilyWidth - familyPadding * 2,
        gap
      )
      y = nextY + sectionGap
      subGroups.push({
        id: `sub-${params.familyId}-${nodeType}`,
        name: label,
        nodeType,
        nodeIds,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        color,
        collapsed: false,
      })
    }

    placeSection(
      sources,
      NODE_TYPE_NAMES.sourcePreview || 'sourcePreview',
      NODE_TYPE_COLORS.sourcePreview || '#ccc',
      'sourcePreview'
    )
    placeSection(
      regexNodes,
      NODE_TYPE_NAMES.regex || 'regex',
      NODE_TYPE_COLORS.regex || '#ccc',
      'regex'
    )

    const constraintGroups = groupByType(constraints, nodeTypeById)
    for (const [type, ids] of constraintGroups) {
      placeSection(ids, NODE_TYPE_NAMES[type] || type, NODE_TYPE_COLORS[type] || '#ccc', type)
    }

    placeSection(others, 'Others', '#9e9e9e', 'others')
  } else {
    // === 水平模式 ===

    // 1. Sources — 垂直堆叠在 Schema 左侧
    let maxSourceWidth = 0
    let sourceY = familyPadding
    for (const id of sources) {
      localPositions.set(id, { x: familyPadding, y: sourceY })
      const dim = nodeDimensions.get(id) || getFallbackDimension(nodeTypeById.get(id) || '')
      sourceY += dim.height + gap
      maxSourceWidth = Math.max(maxSourceWidth, dim.width)
    }

    // 2. Schema — 放在 Sources 右侧
    let schemaX = familyPadding
    const schemaY = familyPadding
    if (sources.length > 0) schemaX += maxSourceWidth + gap
    if (schemaNodeId) {
      localPositions.set(schemaNodeId, { x: schemaX, y: schemaY })
    }

    const schemaDim = schemaNodeId
      ? nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      : { width: 0, height: 0 }
    const rightStartX = schemaX + schemaDim.width + gap
    const rightMaxWidth = Math.max(420, maxFamilyWidth - rightStartX - familyPadding)

    let rightY = familyPadding

    // 3. 约束 — 按类型分组，流式布局
    if (constraints.length > 0) {
      const constraintGroups = groupByType(constraints, nodeTypeById)
      for (const [type, ids] of constraintGroups) {
        const { bounds, nextY } = flowLayout(
          ids,
          localPositions,
          nodeDimensions,
          rightStartX,
          rightY,
          rightMaxWidth,
          gap
        )
        subGroups.push({
          id: `sub-${params.familyId}-${type}`,
          name: NODE_TYPE_NAMES[type] || type,
          nodeType: type,
          nodeIds: ids,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          color: NODE_TYPE_COLORS[type] || '#ccc',
          collapsed: false,
        })
        rightY = nextY + sectionGap
      }
    }

    // 4. Regex — 放在约束下方
    if (regexNodes.length > 0) {
      const { bounds, nextY } = flowLayout(
        regexNodes,
        localPositions,
        nodeDimensions,
        rightStartX,
        rightY,
        rightMaxWidth,
        gap
      )
      subGroups.push({
        id: `sub-${params.familyId}-regex`,
        name: NODE_TYPE_NAMES.regex || 'regex',
        nodeType: 'regex',
        nodeIds: regexNodes,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        color: NODE_TYPE_COLORS.regex || '#ccc',
        collapsed: false,
      })
      rightY = nextY
    }

    // 5. Others — 放在最下方
    if (others.length > 0) {
      const { bounds, nextY } = flowLayout(
        others,
        localPositions,
        nodeDimensions,
        rightStartX,
        rightY,
        rightMaxWidth,
        gap
      )
      subGroups.push({
        id: `sub-${params.familyId}-others`,
        name: 'Others',
        nodeType: 'others',
        nodeIds: others,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        color: '#9e9e9e',
        collapsed: false,
      })
      rightY = nextY
    }
  }

  const bounds = calculateBoundsFromLocal(allIds, localPositions, nodeDimensions)
  const width = bounds ? bounds.width + familyPadding * 2 : maxFamilyWidth
  const height = bounds ? bounds.height + familyPadding * 2 : 500

  return {
    localPositions,
    subGroups,
    width: Math.max(width, 500),
    height: Math.max(height, 300),
    color: familyColor,
  }
}
