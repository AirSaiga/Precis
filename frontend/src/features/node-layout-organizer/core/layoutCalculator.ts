/**
 * @file layoutCalculator.ts
 * @description 布局计算核心逻辑
 *
 * 功能概述：
 * - 根据策略计算所有节点的理想位置
 * - 节点分类与区域布局计算
 * - 区域内网格排列与节点排序
 * - 节点尺寸获取与区域重计算
 */
import { logger } from '@/core/utils/logger'
import type {
  NodePosition,
  ZonePosition,
  OrganizeOptions,
  NodeClassification,
  ConnectionInfo,
  LayoutContext,
  ZoneLayout,
  LayoutStrategy,
  ILayoutStrategy,
  GroupedLayout,
  ZoneGroup,
} from '../types'
import type { CustomNode } from '@/types/nodes'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import { ZONE_CONFIGS, NODE_DIMENSIONS, LAYOUT_CONSTANTS, NODE_TYPE_PRIORITY } from '../constants'
import { SchemaCentricStrategy } from '../strategies/schemaCentricStrategy'

export class LayoutCalculator {
  private context: LayoutContext
  private classification: NodeClassification
  private connections: ConnectionInfo[]
  private options: OrganizeOptions
  private zoneLayouts: Map<string, ZoneLayout>
  private groups: ZoneGroup[]
  private nodeTypeById: Map<string, string>

  constructor(
    nodes: CustomNode[],
    connections: ConnectionInfo[],
    canvasSize: { width: number; height: number },
    options: OrganizeOptions,
    viewportZoom?: number
  ) {
    this.options = options
    this.connections = connections
    this.nodeTypeById = new Map(nodes.map((n) => [n.id, n.type]))
    this.context = {
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      viewportZoom,
      nodes: nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: this.getNodeWidth(n.type),
        height: this.getNodeHeight(n.type),
      })),
      nodeDataById: new Map(nodes.map((n) => [n.id, n])),
      connections,
      options,
    }
    this.classification = this.classifyNodes(nodes)
    this.zoneLayouts = new Map()
    this.groups = []
  }

  /**
   * 获取分组信息
   */
  getGroups(): ZoneGroup[] {
    return this.groups
  }

  /**
   * 计算所有节点的理想位置
   */
  calculate(): Map<string, { x: number; y: number }> {
    const startTime = performance.now()

    const strategy = this.createStrategy(this.options.strategy)
    const groupedLayout = strategy.calculate(this.classification, this.connections, this.context)

    this.groups = groupedLayout.groups
    this.zoneLayouts = new Map()
    for (const [category, zone] of groupedLayout.categoryZones) {
      this.zoneLayouts.set(category, zone)
    }

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

  /**
   * 创建策略实例
   * 统一使用 SchemaCentricStrategy（以Schema为核心的布局策略）
   */
  private createStrategy(_strategyType: LayoutStrategy): ILayoutStrategy {
    return new SchemaCentricStrategy()
  }

  /**
   * 对节点进行分类
   */
  private classifyNodes(nodes: CustomNode[]): NodeClassification {
    const byCategory = new Map<NodeCategory, string[]>()
    const byType = new Map<string, string[]>()
    const unclassified: string[] = []

    for (const node of nodes) {
      const category = NODE_TYPE_TO_CATEGORY[node.type]
      const nodeType = node.type

      if (!category) {
        unclassified.push(node.id)
        continue
      }

      if (!byCategory.has(category)) {
        byCategory.set(category, [])
      }
      byCategory.get(category)!.push(node.id)

      if (!byType.has(nodeType)) {
        byType.set(nodeType, [])
      }
      byType.get(nodeType)!.push(node.id)
    }

    return { byCategory, byType, unclassified }
  }

  /**
   * 计算所有区域的位置和大小
   */
  calculateZoneLayouts(): Map<string, ZoneLayout> {
    const { canvasWidth, canvasHeight } = this.context
    const padding = LAYOUT_CONSTANTS.CANVAS_PADDING
    const availableWidth = canvasWidth - padding * 2
    const availableHeight = canvasHeight - padding * 2

    const sortedZones = [...ZONE_CONFIGS].sort((a, b) => a.order - b.order)
    const usedHeight = 0
    let currentY = padding

    for (const zoneConfig of sortedZones) {
      const zoneNodes = this.classification.byCategory.get(zoneConfig.category) || []
      if (zoneNodes.length === 0 && zoneConfig.category !== NodeCategory.ROOT) {
        continue
      }

      const zoneWidth = availableWidth * zoneConfig.widthRatio
      const zoneHeight = this.calculateZoneHeight(zoneConfig, zoneNodes.length, availableHeight)

      const zoneLayout: ZoneLayout = {
        zoneId: zoneConfig.id,
        x: this.calculateZoneX(zoneConfig, zoneWidth, availableWidth, padding),
        y: currentY,
        width: zoneWidth,
        height: zoneHeight,
        nodeCount: zoneNodes.length,
        category: zoneConfig.category,
      }

      this.zoneLayouts.set(zoneConfig.category, zoneLayout)
      currentY += zoneHeight + LAYOUT_CONSTANTS.ZONE_PADDING
    }

    return this.zoneLayouts
  }

  /**
   * 计算区域高度
   */
  private calculateZoneHeight(
    zoneConfig: { heightRatio: number },
    nodeCount: number,
    availableHeight: number
  ): number {
    const minHeight = 100
    const calculatedHeight = availableHeight * zoneConfig.heightRatio
    const requiredHeight =
      Math.ceil(nodeCount / 4) * (NODE_DIMENSIONS.DEFAULT_HEIGHT + LAYOUT_CONSTANTS.DEFAULT_GAP)
    return Math.max(
      calculatedHeight,
      Math.max(minHeight, requiredHeight + LAYOUT_CONSTANTS.ZONE_PADDING * 2)
    )
  }

  /**
   * 计算区域X坐标
   */
  private calculateZoneX(
    zoneConfig: { position: string },
    zoneWidth: number,
    availableWidth: number,
    padding: number
  ): number {
    switch (zoneConfig.position) {
      case 'left':
        return padding
      case 'right':
        return padding + availableWidth - zoneWidth
      case 'center':
        return padding + (availableWidth - zoneWidth) / 2
      case 'top':
      default:
        return padding + (availableWidth - zoneWidth) / 2
    }
  }

  /**
   * 计算节点在区域内的位置
   */
  calculateNodePositionsInZone(
    nodeIds: string[],
    zone: ZoneLayout,
    sortBy: 'type' | 'name' | 'creationTime'
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>()
    const sortedIds = this.sortNodeIds(nodeIds, sortBy)

    let currentX = zone.x + this.options.margin
    let currentY = zone.y + this.options.margin
    let rowIndex = 0

    for (const nodeId of sortedIds) {
      const nodeWidth = this.getNodeWidthById(nodeId)

      if (currentX + nodeWidth > zone.x + zone.width - this.options.margin) {
        rowIndex = 0
        currentX = zone.x + this.options.margin
        currentY += NODE_DIMENSIONS.DEFAULT_HEIGHT + this.options.gap
      }

      positions.set(nodeId, { x: currentX, y: currentY })
      currentX += nodeWidth + this.options.gap
      rowIndex++
    }

    return positions
  }

  /**
   * 排序节点ID
   */
  private sortNodeIds(nodeIds: string[], sortBy: 'type' | 'name' | 'creationTime'): string[] {
    return [...nodeIds].sort((a, b) => {
      switch (sortBy) {
        case 'type':
          const typeA = this.nodeTypeById.get(a) || ''
          const typeB = this.nodeTypeById.get(b) || ''
          const priorityA = NODE_TYPE_PRIORITY[typeA] ?? 999
          const priorityB = NODE_TYPE_PRIORITY[typeB] ?? 999
          return priorityA - priorityB
        case 'name':
          return a.localeCompare(b)
        case 'creationTime':
          return 0
        default:
          return 0
      }
    })
  }

  /**
   * 获取节点宽度
   */
  private getNodeWidth(nodeType: string): number {
    const category = NODE_TYPE_TO_CATEGORY[nodeType]
    if (category === NodeCategory.ROOT) {
      return NODE_DIMENSIONS.ROOT_WIDTH
    }
    if (category === NodeCategory.CONSTRAINT) {
      return NODE_DIMENSIONS.CONSTRAINT_WIDTH
    }
    return NODE_DIMENSIONS.DEFAULT_WIDTH
  }

  /**
   * 根据节点ID获取宽度
   */
  private getNodeWidthById(nodeId: string): number {
    return this.context.nodes.find((n) => n.id === nodeId)?.width || NODE_DIMENSIONS.DEFAULT_WIDTH
  }

  /**
   * 获取节点高度
   */
  private getNodeHeight(nodeType: string): number {
    const category = NODE_TYPE_TO_CATEGORY[nodeType]
    if (category === NodeCategory.ROOT) {
      return NODE_DIMENSIONS.ROOT_HEIGHT
    }
    if (category === NodeCategory.CONSTRAINT) {
      return NODE_DIMENSIONS.CONSTRAINT_HEIGHT
    }
    return NODE_DIMENSIONS.DEFAULT_HEIGHT
  }

  /**
   * 重新计算区域布局
   */
  recalculateZoneLayouts(): void {
    this.zoneLayouts = this.calculateZoneLayouts()
  }
}
