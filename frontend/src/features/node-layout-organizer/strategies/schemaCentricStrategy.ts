/**
 * @file schemaCentricStrategy.ts
 * @description Schema 中心化布局策略
 *
 * 功能概述：
 * - 以 Schema 为核心划分家族分组
 * - 支持 parent 属性与 BFS 回退分配节点
 * - 最佳网格放置算法
 * - 家族内流式布局与边界计算
 */
import type {
  NodeClassification,
  ConnectionInfo,
  LayoutContext,
  ILayoutStrategy,
  GroupedLayout,
  ZoneGroup,
  SubGroup,
} from '../types'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import {
  GROUP_COLORS,
  LAYOUT_CONSTANTS,
  NODE_TYPE_COLORS,
  NODE_TYPE_NAMES,
} from '../constants'
import {
  getDefaultDimension,
  getNodeDimensionsFromDOM,
  type NodeDimension,
} from '../utils/nodeDimensionHelper'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { layoutFamily, calculateBoundsFromPositions, getFallbackDimension } from './familyLayout'

export class SchemaCentricStrategy implements ILayoutStrategy {
  calculate(
    classification: NodeClassification,
    connections: ConnectionInfo[],
    context: LayoutContext
  ): GroupedLayout {
    const nodeTypeById = this.buildNodeTypeById(classification)
    const excludedNodeIds = this.buildExcludedNodeIds(classification, nodeTypeById)
    const nodeIds = context.nodes.map((n) => n.id).filter((id) => !excludedNodeIds.has(id))
    const nodeDimensions = this.buildNodeDimensions(nodeIds, nodeTypeById, context.viewportZoom)

    const nodeDataById = context.nodeDataById

    const schemaIds = (classification.byType.get('schema') || [])
      .filter((id) => nodeIds.includes(id))
      .slice()
      .sort((a, b) => a.localeCompare(b))

    const adjacency = this.buildAdjacency(nodeIds, connections)

    const { assignedSchemaByNode, sharedNodeIds, orphanNodeIds } = this.assignNodesByParentChildren(
      nodeIds,
      schemaIds,
      nodeDataById,
      adjacency,
      excludedNodeIds
    )

    const positions = new Map<string, { x: number; y: number }>()
    const groups: ZoneGroup[] = []

    const rootNodeIds = (classification.byCategory.get(NodeCategory.ROOT) || [])
      .slice()
      .sort((a, b) => a.localeCompare(b))

    const { topReservedHeight } = this.layoutRoot(rootNodeIds, positions, nodeDimensions, context.canvasWidth)

    const familiesStartX = LAYOUT_CONSTANTS.CANVAS_PADDING
    const familiesStartY = LAYOUT_CONSTANTS.CANVAS_PADDING + topReservedHeight + 80

    const familyOrder = schemaIds.slice()
    const familyMembersBySchema = new Map<string, string[]>()
    for (const schemaId of schemaIds) familyMembersBySchema.set(schemaId, [])
    for (const nodeId of nodeIds) {
      const schemaId = assignedSchemaByNode.get(nodeId)
      if (schemaId && schemaId !== nodeId) {
        familyMembersBySchema.get(schemaId)!.push(nodeId)
      }
    }

    const pseudoFamilies: Array<{ id: string; name: string; nodeIds: string[]; color: string }> = []
    if (sharedNodeIds.length > 0) {
      pseudoFamilies.push({
        id: 'shared',
        name: '共享节点',
        nodeIds: sharedNodeIds,
        color: GROUP_COLORS[NodeCategory.CORE]?.border || '#2196f3',
      })
    }
    if (orphanNodeIds.length > 0) {
      pseudoFamilies.push({
        id: 'orphan',
        name: '未分组节点',
        nodeIds: orphanNodeIds,
        color: GROUP_COLORS[NodeCategory.CONSTRAINT]?.border || '#ff9800',
      })
    }

    const familyLayouts: Array<{
      familyId: string
      familyName: string
      schemaNodeId: string | null
      memberNodeIds: string[]
      layout: {
        localPositions: Map<string, { x: number; y: number }>
        subGroups: SubGroup[]
        width: number
        height: number
        color: string
      }
      packedWidth: number
      packedHeight: number
    }> = []

    for (const schemaId of familyOrder) {
      const members = familyMembersBySchema.get(schemaId) || []
      const layout = layoutFamily({
        familyId: schemaId,
        familyName: `Schema: ${schemaId}`,
        schemaNodeId: schemaId,
        memberNodeIds: members,
        nodeTypeById,
        nodeDimensions,
        canvasWidth: context.canvasWidth,
        layoutMode: 'horizontal',
        gap: context.gap,
        edges: context.connections,
      })
      familyLayouts.push({
        familyId: schemaId,
        familyName: `Schema: ${schemaId}`,
        schemaNodeId: schemaId,
        memberNodeIds: members,
        layout,
        packedWidth: layout.width + 160,
        packedHeight: layout.height + 220,
      })
    }

    for (const fam of pseudoFamilies) {
      const layout = layoutFamily({
        familyId: fam.id,
        familyName: fam.name,
        schemaNodeId: null,
        memberNodeIds: fam.nodeIds,
        nodeTypeById,
        nodeDimensions,
        canvasWidth: context.canvasWidth,
        layoutMode: 'horizontal',
        gap: context.gap,
        edges: context.connections,
      })
      familyLayouts.push({
        familyId: fam.id,
        familyName: fam.name,
        schemaNodeId: null,
        memberNodeIds: fam.nodeIds,
        layout,
        packedWidth: layout.width + 160,
        packedHeight: layout.height + 220,
      })
    }

    const familyAnchors = this.placeFamiliesInBestGrid(
      familyLayouts.map((f) => ({
        id: f.familyId,
        width: f.packedWidth,
        height: f.packedHeight,
      })),
      {
        startX: familiesStartX,
        startY: familiesStartY,
        canvasWidth: context.canvasWidth,
        canvasHeight: context.canvasHeight,
        gapX: 80,
        gapY: 100,
        padding: LAYOUT_CONSTANTS.CANVAS_PADDING,
      }
    )

    for (const family of familyLayouts) {
      const anchor = familyAnchors.get(family.familyId)
      if (!anchor) continue

      for (const [nodeId, pos] of family.layout.localPositions) {
        positions.set(nodeId, { x: anchor.x + pos.x, y: anchor.y + pos.y })
      }

      const familyGroupId = `fam-${family.familyId}`
      const familyNodeIds = family.schemaNodeId
        ? [family.schemaNodeId, ...family.memberNodeIds]
        : family.memberNodeIds.slice()
      const familyBounds = calculateBoundsFromPositions(
        familyNodeIds,
        positions,
        nodeDimensions,
        nodeTypeById,
        0
      )

      if (familyBounds) {
        groups.push({
          id: familyGroupId,
          name: family.familyName,
          category: NodeCategory.CORE,
          nodeType: 'schema',
          nodeIds: familyNodeIds,
          x: familyBounds.x - 10,
          y: familyBounds.y - 30,
          width: familyBounds.width + 20,
          height: familyBounds.height + 40,
          color: family.layout.color,
          collapsed: false,
          visibleNodeIds: familyNodeIds,
          depth: 0,
        })
      }

      for (const subGroup of family.layout.subGroups) {
        if (subGroup.nodeIds.length === 0) continue
        const subBounds = calculateBoundsFromPositions(
          subGroup.nodeIds,
          positions,
          nodeDimensions,
          nodeTypeById,
          0
        )
        if (!subBounds) continue
        groups.push({
          id: subGroup.id,
          name: subGroup.name,
          category: NodeCategory.CONSTRAINT,
          nodeType: subGroup.nodeType,
          nodeIds: subGroup.nodeIds,
          x: subBounds.x - 10,
          y: subBounds.y - 30,
          width: subBounds.width + 20,
          height: subBounds.height + 40,
          color: subGroup.color,
          collapsed: false,
          visibleNodeIds: subGroup.nodeIds,
          parentId: familyGroupId,
          depth: 1,
        })
      }
    }

    return { positions, groups }
  }

  private placeFamiliesInBestGrid(
    items: Array<{ id: string; width: number; height: number }>,
    params: {
      startX: number
      startY: number
      canvasWidth: number
      canvasHeight: number
      gapX: number
      gapY: number
      padding: number
    }
  ): Map<string, { x: number; y: number }> {
    const { canvasWidth, canvasHeight, padding } = params
    const availableWidth = Math.max(1, canvasWidth - padding * 2)

    const maxCols = Math.min(items.length, 6)

    let best: {
      score: number
      anchors: Map<string, { x: number; y: number }>
      width: number
      height: number
    } | null = null
    for (let cols = 1; cols <= maxCols; cols++) {
      const placement = this.placeFamiliesRowMajor(items, { ...params, maxPerRow: cols })
      const aspect = placement.totalWidth / Math.max(1, placement.totalHeight)
      const targetAspect = canvasWidth / Math.max(1, canvasHeight)
      const aspectPenalty = Math.abs(aspect - targetAspect) * 400
      const singleColumnPenalty = cols === 1 && items.length >= 2 ? 800 : 0
      const overflowPenalty =
        placement.totalWidth > availableWidth ? (placement.totalWidth - availableWidth) * 2 : 0
      const score = placement.totalHeight + aspectPenalty + singleColumnPenalty + overflowPenalty

      if (!best || score < best.score) {
        best = {
          score,
          anchors: placement.anchors,
          width: placement.totalWidth,
          height: placement.totalHeight,
        }
      }
    }

    if (best) return best.anchors
    return this.placeFamiliesRowMajor(items, { ...params, maxPerRow: 1 }).anchors
  }

  private placeFamiliesRowMajor(
    items: Array<{ id: string; width: number; height: number }>,
    params: {
      startX: number
      startY: number
      gapX: number
      gapY: number
      maxPerRow: number
    }
  ): { anchors: Map<string, { x: number; y: number }>; totalWidth: number; totalHeight: number } {
    const maxPerRow = Math.max(1, params.maxPerRow)
    const stableItems = items.slice().sort((a, b) => a.id.localeCompare(b.id))
    const anchors = new Map<string, { x: number; y: number }>()
    let cursorY = params.startY
    let totalWidth = 0
    let totalHeight = 0

    for (let i = 0; i < stableItems.length; i += maxPerRow) {
      const rowItems = stableItems.slice(i, i + maxPerRow)
      const rowHeight = Math.max(...rowItems.map((it) => it.height))
      let currentX = params.startX
      let rowMaxX = params.startX

      for (const item of rowItems) {
        anchors.set(item.id, { x: currentX, y: cursorY })
        currentX += item.width + params.gapX
        rowMaxX = Math.max(rowMaxX, currentX - params.gapX)
      }

      totalWidth = Math.max(totalWidth, rowMaxX - params.startX)
      cursorY += rowHeight + params.gapY
      totalHeight += rowHeight
    }

    totalHeight += Math.max(0, Math.ceil(stableItems.length / maxPerRow) - 1) * params.gapY
    return { anchors, totalWidth, totalHeight }
  }

  private buildNodeTypeById(classification: NodeClassification): Map<string, string> {
    const nodeTypeById = new Map<string, string>()
    for (const [nodeType, nodeIds] of classification.byType) {
      for (const nodeId of nodeIds) {
        nodeTypeById.set(nodeId, nodeType)
      }
    }
    return nodeTypeById
  }

  private buildExcludedNodeIds(
    classification: NodeClassification,
    nodeTypeById: Map<string, string>
  ): Set<string> {
    const excluded = new Set<string>()
    const root = classification.byCategory.get(NodeCategory.ROOT) || []
    for (const id of [...root]) excluded.add(id)
    for (const id of classification.unclassified || []) {
      const nodeType = nodeTypeById.get(id)
      if (!nodeType) excluded.add(id)
    }
    return excluded
  }

  private buildNodeDimensions(
    nodeIds: string[],
    nodeTypeById: Map<string, string>,
    viewportZoom?: number
  ): Map<string, NodeDimension> {
    const domDimensions = getNodeDimensionsFromDOM(nodeIds)
    const dimensions = new Map<string, NodeDimension>()
    const zoom = viewportZoom || 1

    for (const nodeId of nodeIds) {
      const nodeType = nodeTypeById.get(nodeId) || ''
      const domDim = domDimensions.get(nodeId)
      const defaultDim = getFallbackDimension(nodeType)

      if (domDim) {
        const scaledDom = {
          width: domDim.width / zoom,
          height: domDim.height / zoom,
        }
        dimensions.set(nodeId, {
          width: Math.max(scaledDom.width, defaultDim.width) * 1.05,
          height: Math.max(scaledDom.height, defaultDim.height) * 1.05,
        })
      } else {
        dimensions.set(nodeId, defaultDim)
      }
    }

    return dimensions
  }

  private buildAdjacency(nodeIds: string[], connections: ConnectionInfo[]): Map<string, string[]> {
    const adjacency = new Map<string, string[]>()
    for (const id of nodeIds) adjacency.set(id, [])
    for (const conn of connections) {
      if (!adjacency.has(conn.source) || !adjacency.has(conn.target)) continue
      adjacency.get(conn.source)!.push(conn.target)
      adjacency.get(conn.target)!.push(conn.source)
    }
    for (const [id, neighbors] of adjacency) {
      adjacency.set(
        id,
        neighbors.slice().sort((a, b) => a.localeCompare(b))
      )
    }
    return adjacency
  }

  private assignNodesToSchemaFamilies(
    nodeIds: string[],
    schemaIds: string[],
    adjacency: Map<string, string[]>,
    excludedNodeIds: Set<string>
  ): {
    assignedSchemaByNode: Map<string, string>
    sharedNodeIds: string[]
    orphanNodeIds: string[]
  } {
    const distByNode = new Map<string, number>()
    const bestSchemasByNode = new Map<string, Set<string>>()
    const queue: Array<{ nodeId: string; schemaId: string }> = []

    for (const schemaId of schemaIds) {
      distByNode.set(schemaId, 0)
      bestSchemasByNode.set(schemaId, new Set([schemaId]))
      queue.push({ nodeId: schemaId, schemaId })
    }

    let qi = 0
    while (qi < queue.length) {
      const item = queue[qi++]
      if (!item) continue
      const { nodeId, schemaId } = item
      const nodeDist = distByNode.get(nodeId)
      if (nodeDist === undefined) continue

      for (const neighbor of adjacency.get(nodeId) || []) {
        if (excludedNodeIds.has(neighbor)) continue
        const newDist = nodeDist + 1
        const prevDist = distByNode.get(neighbor)

        if (prevDist === undefined || newDist < prevDist) {
          distByNode.set(neighbor, newDist)
          bestSchemasByNode.set(neighbor, new Set([schemaId]))
          queue.push({ nodeId: neighbor, schemaId })
          continue
        }

        if (newDist === prevDist) {
          const best = bestSchemasByNode.get(neighbor) || new Set<string>()
          if (!best.has(schemaId)) {
            best.add(schemaId)
            bestSchemasByNode.set(neighbor, best)
            queue.push({ nodeId: neighbor, schemaId })
          }
        }
      }
    }

    const assignedSchemaByNode = new Map<string, string>()
    const sharedNodeIds: string[] = []
    const orphanNodeIds: string[] = []

    const schemaSet = new Set(schemaIds)
    for (const nodeId of nodeIds) {
      if (schemaSet.has(nodeId)) {
        assignedSchemaByNode.set(nodeId, nodeId)
        continue
      }

      const best = bestSchemasByNode.get(nodeId)
      if (!best || best.size === 0) {
        orphanNodeIds.push(nodeId)
        continue
      }

      const schemaList = Array.from(best).sort((a, b) => a.localeCompare(b))
      if (schemaList.length === 1) {
        const firstSchema = schemaList[0]
        if (firstSchema !== undefined) {
          assignedSchemaByNode.set(nodeId, firstSchema)
        }
      } else {
        sharedNodeIds.push(nodeId)
      }
    }

    sharedNodeIds.sort((a, b) => a.localeCompare(b))
    orphanNodeIds.sort((a, b) => a.localeCompare(b))

    return { assignedSchemaByNode, sharedNodeIds, orphanNodeIds }
  }

  private assignNodesByParentChildren(
    nodeIds: string[],
    schemaIds: string[],
    nodeDataById: Map<string, any>,
    adjacency: Map<string, string[]>,
    excludedNodeIds: Set<string>
  ): {
    assignedSchemaByNode: Map<string, string>
    sharedNodeIds: string[]
    orphanNodeIds: string[]
  } {
    const assignedSchemaByNode = new Map<string, string>()
    const orphanCandidates: string[] = []

    const schemaSet = new Set(schemaIds)

    for (const schemaId of schemaIds) {
      assignedSchemaByNode.set(schemaId, schemaId)
    }

    for (const nodeId of nodeIds) {
      if (schemaSet.has(nodeId)) continue

      const nodeData = nodeDataById.get(nodeId)
      const parentId = nodeData?.data?.parent

      if (parentId && schemaSet.has(parentId)) {
        assignedSchemaByNode.set(nodeId, parentId)
      } else {
        orphanCandidates.push(nodeId)
      }
    }

    const {
      assignedSchemaByNode: bfsAssigned,
      sharedNodeIds,
      orphanNodeIds,
    } = this.assignNodesToSchemaFamilies(orphanCandidates, schemaIds, adjacency, excludedNodeIds)

    for (const [nodeId, schemaId] of bfsAssigned) {
      assignedSchemaByNode.set(nodeId, schemaId)
    }

    return { assignedSchemaByNode, sharedNodeIds, orphanNodeIds }
  }

  private layoutRoot(
    rootNodeIds: string[],
    positions: Map<string, { x: number; y: number }>,
    nodeDimensions: Map<string, NodeDimension>,
    canvasWidth: number
  ): { topReservedHeight: number } {
    const padding = LAYOUT_CONSTANTS.CANVAS_PADDING
    const gap = 40
    const maxRootX = Math.max(padding + 200, canvasWidth - padding - 320)

    let x = padding
    let currentRowY = padding
    let rowHeight = 0
    for (const nodeId of rootNodeIds) {
      const dim = nodeDimensions.get(nodeId) || {
        width: 300,
        height: 120,
      }
      if (x + dim.width > maxRootX && x > padding) {
        x = padding
        currentRowY += rowHeight + gap
        rowHeight = 0
      }
      positions.set(nodeId, { x, y: currentRowY })
      x += dim.width + gap
      rowHeight = Math.max(rowHeight, dim.height)
    }

    const topHeight = currentRowY + rowHeight - padding
    return { topReservedHeight: Math.max(topHeight, 0) }
  }
}
