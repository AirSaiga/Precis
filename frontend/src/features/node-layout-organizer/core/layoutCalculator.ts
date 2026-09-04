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
    // 唯一一道网格对齐（DEF-14：历史上 useNodeOrganizer 还会再做一次 20 网格
    // 对齐，两道独立取整的相对误差叠加可吃掉全部 gap，导致相邻节点重叠）。
    // 网格粒度必须满足 GRID_SIZE < gap（见 constants.ts GRID_SIZE 注释）。
    for (const [nodeId, position] of groupedLayout.positions) {
      targetPositions.set(nodeId, {
        x: Math.round(position.x / LAYOUT_CONSTANTS.GRID_SIZE) * LAYOUT_CONSTANTS.GRID_SIZE,
        y: Math.round(position.y / LAYOUT_CONSTANTS.GRID_SIZE) * LAYOUT_CONSTANTS.GRID_SIZE,
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

      // 注意：必须先初始化 Map 条目再 push。若写成 `if (get(k)) push`，
      // 首次遇到新分类时 get 恒为 undefined，byCategory/byType 将永远为空，
      // Schema 中心化策略整体退化为"未分组节点"流式缠绕布局。
      const categoryList = byCategory.get(category) ?? []
      categoryList.push(node.id)
      byCategory.set(category, categoryList)

      const typeList = byType.get(nodeType) ?? []
      typeList.push(node.id)
      byType.set(nodeType, typeList)
    }

    return { byCategory, byType, unclassified }
  }
}
