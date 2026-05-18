/**
 * @file nodeClassifier.ts
 * @description 节点分类器
 *
 * 功能概述：
 * - 按类别、类型、连接关系多维分类
 * - 按层级关系分类节点
 * - 提取根节点与叶子节点
 * - 统计节点分布数据
 */
import type { CustomNode } from '@/types/nodes'
import { NODE_TYPE_TO_CATEGORY, NodeCategory } from '../types'

export class NodeClassifier {
  private nodes: Map<string, CustomNode>

  constructor(nodes: CustomNode[]) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]))
  }

  /**
   * 按类别分类
   */
  classifyByCategory(): Map<NodeCategory, CustomNode[]> {
    const result = new Map<NodeCategory, CustomNode[]>()

    for (const node of this.nodes.values()) {
      const category = NODE_TYPE_TO_CATEGORY[node.type] || NodeCategory.CORE

      if (!result.has(category)) {
        result.set(category, [])
      }
      result.get(category)!.push(node)
    }

    return result
  }

  /**
   * 按类型分类
   */
  classifyByType(): Map<string, CustomNode[]> {
    const result = new Map<string, CustomNode[]>()

    for (const node of this.nodes.values()) {
      if (!result.has(node.type)) {
        result.set(node.type, [])
      }
      result.get(node.type)!.push(node)
    }

    return result
  }

  /**
   * 按连接关系分类
   */
  classifyByConnection(): {
    sources: Set<string>
    targets: Set<string>
    isolated: CustomNode[]
    hubs: CustomNode[]
  } {
    const sources = new Set<string>()
    const targets = new Set<string>()
    const connectionCount = new Map<string, number>()
    const isolated: CustomNode[] = []
    const hubs: CustomNode[] = []

    for (const node of this.nodes.values()) {
      connectionCount.set(node.id, 0)
    }

    for (const node of this.nodes.values()) {
      const data = node.data as unknown as Record<string, unknown>
      const schemaNodeIds = this.extractSchemaNodeIds(data)

      for (const schemaId of schemaNodeIds) {
        if (this.nodes.has(schemaId)) {
          connectionCount.set(node.id, (connectionCount.get(node.id) || 0) + 1)
          connectionCount.set(schemaId, (connectionCount.get(schemaId) || 0) + 1)
          sources.add(node.id)
          targets.add(schemaId)
        }
      }
    }

    for (const node of this.nodes.values()) {
      const count = connectionCount.get(node.id) || 0
      if (count === 0) {
        isolated.push(node)
      } else if (count >= 3) {
        hubs.push(node)
      }
    }

    return { sources, targets, isolated, hubs }
  }

  /**
   * 按层级分类
   */
  classifyByHierarchy(
    connections: { source: string; target: string }[]
  ): Map<number, CustomNode[]> {
    const levels = new Map<number, CustomNode[]>()
    const nodeLevels = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    const reverseAdjacency = new Map<string, string[]>()

    for (const node of this.nodes.values()) {
      nodeLevels.set(node.id, 0)
      adjacency.set(node.id, [])
      reverseAdjacency.set(node.id, [])
    }

    for (const conn of connections) {
      if (adjacency.has(conn.source)) {
        adjacency.get(conn.source)!.push(conn.target)
      }
      if (reverseAdjacency.has(conn.target)) {
        reverseAdjacency.get(conn.target)!.push(conn.source)
      }
    }

    const calculateLevel = (nodeId: string): number => {
      const parents = reverseAdjacency.get(nodeId) || []
      if (parents.length === 0) return 0

      const parentLevels = parents.map((p) => calculateLevel(p))
      return Math.max(...parentLevels) + 1
    }

    for (const nodeId of this.nodes.keys()) {
      const level = calculateLevel(nodeId)
      nodeLevels.set(nodeId, level)

      if (!levels.has(level)) {
        levels.set(level, [])
      }
      levels.get(level)!.push(this.nodes.get(nodeId)!)
    }

    return levels
  }

  /**
   * 获取根节点
   */
  getRootNodes(): CustomNode[] {
    const rootTypes = ['projectRoot']
    return Array.from(this.nodes.values()).filter((n) => rootTypes.includes(n.type))
  }

  /**
   * 获取叶子节点
   */
  getLeafNodes(): CustomNode[] {
    return Array.from(this.nodes.values()).filter((node) => {
      const data = node.data as unknown as Record<string, unknown>
      const schemaNodeIds = this.extractSchemaNodeIds(data)
      return schemaNodeIds.length === 0
    })
  }

  /**
   * 提取数据中的 Schema 节点 ID
   */
  private extractSchemaNodeIds(data: Record<string, unknown>): string[] {
    const ids: string[] = []

    const extractFromValue = (value: unknown): void => {
      if (typeof value === 'string' && value.startsWith('node-')) {
        ids.push(value)
      } else if (Array.isArray(value)) {
        value.forEach(extractFromValue)
      } else if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(extractFromValue)
      }
    }

    extractFromValue(data)
    return [...new Set(ids)]
  }

  /**
   * 统计各类节点数量
   */
  getStatistics(): {
    total: number
    byCategory: Record<string, number>
    byType: Record<string, number>
    connected: number
    isolated: number
  } {
    const byCategory: Record<string, number> = {}
    const byType: Record<string, number> = {}
    let connected = 0
    let isolated = 0

    const { sources, targets, isolated: isolatedNodes } = this.classifyByConnection()
    connected = new Set([...sources, ...targets]).size
    isolated = isolatedNodes.length

    const categoryMap = this.classifyByCategory()
    for (const [category, nodes] of categoryMap) {
      byCategory[category] = nodes.length
    }

    const typeMap = this.classifyByType()
    for (const [type, nodes] of typeMap) {
      byType[type] = nodes.length
    }

    return {
      total: this.nodes.size,
      byCategory,
      byType,
      connected,
      isolated,
    }
  }
}
