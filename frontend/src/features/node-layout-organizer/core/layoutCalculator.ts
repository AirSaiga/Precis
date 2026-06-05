/**
 * @file layoutCalculator.ts
 * @description 布局计算核心逻辑
 *
 * 功能概述：
 * - 根据策略计算所有节点的理想位置
 * - 节点分类
 */
import { logger } from '@/core/utils/logger'
import type {
  OrganizeOptions,
  NodeClassification,
  ConnectionInfo,
  LayoutContext,
  GroupedLayout,
  ZoneGroup,
} from '../types'
import type { CustomNode } from '@/types/nodes'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import { LAYOUT_CONSTANTS } from '../constants'
import { SchemaCentricStrategy } from '../strategies/schemaCentricStrategy'

export class LayoutCalculator {
  private context: LayoutContext
  private classification: NodeClassification
  private connections: ConnectionInfo[]
  private groups: ZoneGroup[]

  constructor(
    nodes: CustomNode[],
    connections: ConnectionInfo[],
    canvasSize: { width: number; height: number },
    options: OrganizeOptions,
    viewportZoom?: number
  ) {
    this.connections = connections
    this.context = {
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      viewportZoom,
      nodes: nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: 0,
        height: 0,
      })),
      nodeDataById: new Map(nodes.map((n) => [n.id, n])),
      connections,
      gap: options.gap,
    }
    this.classification = this.classifyNodes(nodes)
    this.groups = []
  }

  getGroups(): ZoneGroup[] {
    return this.groups
  }

  calculate(): Map<string, { x: number; y: number }> {
    const startTime = performance.now()

    const strategy = new SchemaCentricStrategy()
    const groupedLayout = strategy.calculate(this.classification, this.connections, this.context)

    this.groups = groupedLayout.groups

    const targetPositions = new Map<string, { x: number; y: number }>()
    for (const [nodeId, position] of groupedLayout.positions) {
      targetPositions.set(nodeId, {
        x: Math.round(position.x / LAYOUT_CONSTANTS.DEFAULT_GAP) * LAYOUT_CONSTANTS.DEFAULT_GAP,
        y: Math.round(position.y / LAYOUT_CONSTANTS.DEFAULT_GAP) * LAYOUT_CONSTANTS.DEFAULT_GAP,
      })
    }

    const endTime = performance.now()
    logger.debug(`[LayoutCalculator] 布局计算耗时: ${(endTime - startTime).toFixed(2)}ms`)
    logger.debug(
      `[LayoutCalculator] 整理节点数: ${targetPositions.size}, 分组数: ${this.groups.length}`
    )

    return targetPositions
  }

  private classifyNodes(nodes: CustomNode[]): NodeClassification {
    const byCategory = new Map<NodeCategory, string[]>()
    const byType = new Map<string, string[]>()
    const unclassified: string[] = []

    for (const node of nodes) {
      if (!node.type) {
        unclassified.push(node.id)
        continue
      }
      const category = NODE_TYPE_TO_CATEGORY[node.type]
      const nodeType = node.type

      if (!category) {
        unclassified.push(node.id)
        continue
      }

      const categoryList = byCategory.get(category)
      if (categoryList) {
        categoryList.push(node.id)
      }

      const typeList = byType.get(nodeType)
      if (typeList) {
        typeList.push(node.id)
      }
    }

    return { byCategory, byType, unclassified }
  }
}
