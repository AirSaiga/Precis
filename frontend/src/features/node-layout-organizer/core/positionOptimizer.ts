/**
 * @file positionOptimizer.ts
 * @description 位置优化器
 *
 * 功能概述：
 * - 检测并解决节点重叠碰撞
 * - 优化节点间距与网格对齐
 * - 边界约束限制节点位置
 * - 迭代式位置优化算法
 */
import type { NodePosition } from '../types'
import { LAYOUT_CONSTANTS, NODE_DIMENSIONS } from '../constants'

export class PositionOptimizer {
  private nodePositions: Map<string, NodePosition>
  private nodeDimensions: Map<string, { width: number; height: number }>
  private collisionThreshold: number

  constructor(
    positions: Map<string, { x: number; y: number }>,
    dimensions?: Map<string, { width: number; height: number }>
  ) {
    this.nodePositions = new Map()
    this.nodeDimensions = dimensions || new Map()
    this.collisionThreshold = LAYOUT_CONSTANTS.DEFAULT_GAP

    for (const [nodeId, pos] of positions) {
      const dim = this.nodeDimensions.get(nodeId) || {
        width: NODE_DIMENSIONS.DEFAULT_WIDTH,
        height: NODE_DIMENSIONS.DEFAULT_HEIGHT,
      }
      this.nodePositions.set(nodeId, { id: nodeId, ...pos, ...dim })
    }
  }

  /**
   * 优化节点位置，解决重叠问题
   */
  optimize(): Map<string, { x: number; y: number }> {
    const iterations = 3
    for (let i = 0; i < iterations; i++) {
      this.resolveCollisions()
      this.optimizeSpacing()
    }

    const result = new Map<string, { x: number; y: number }>()
    for (const [nodeId, node] of this.nodePositions) {
      result.set(nodeId, { x: node.x, y: node.y })
    }

    return result
  }

  /**
   * 解决碰撞
   */
  private resolveCollisions(): void {
    const nodes = Array.from(this.nodePositions.values())

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i]
        const nodeB = nodes[j]

        if (this.checkCollision(nodeA, nodeB)) {
          this.resolveNodeCollision(nodeA, nodeB)
          nodes[i] = nodeA
          nodes[j] = nodeB
        }
      }
    }
  }

  /**
   * 检查两个节点是否重叠
   */
  private checkCollision(nodeA: NodePosition, nodeB: NodePosition): boolean {
    const padding = this.collisionThreshold
    const boundsA = {
      left: nodeA.x - padding,
      right: nodeA.x + nodeA.width + padding,
      top: nodeA.y - padding,
      bottom: nodeA.y + nodeA.height + padding,
    }

    const boundsB = {
      left: nodeB.x - padding,
      right: nodeB.x + nodeB.width + padding,
      top: nodeB.y - padding,
      bottom: nodeB.y + nodeB.height + padding,
    }

    return !(
      boundsA.right < boundsB.left ||
      boundsA.left > boundsB.right ||
      boundsA.bottom < boundsB.top ||
      boundsA.top > boundsB.bottom
    )
  }

  /**
   * 解决两个节点的碰撞
   * 计算实际重叠量，将两个节点沿最小阻力方向反向推开
   */
  private resolveNodeCollision(nodeA: NodePosition, nodeB: NodePosition): void {
    const centerAX = nodeA.x + nodeA.width / 2
    const centerAY = nodeA.y + nodeA.height / 2
    const centerBX = nodeB.x + nodeB.width / 2
    const centerBY = nodeB.y + nodeB.height / 2

    const dx = centerAX - centerBX
    const dy = centerAY - centerBY

    const overlapX = (nodeA.width + nodeB.width) / 2 + this.collisionThreshold - Math.abs(dx)
    const overlapY = (nodeA.height + nodeB.height) / 2 + this.collisionThreshold - Math.abs(dy)

    // 如果已经不重叠（数值精度问题），直接返回
    if (overlapX <= 0 && overlapY <= 0) return

    if (overlapX < overlapY) {
      // 水平方向推开更容易：各移动 overlapX / 2 + 1
      const directionX = dx > 0 ? 1 : -1
      const shiftX = Math.max(overlapX / 2 + 1, 2)
      this.moveNode(nodeA, shiftX * directionX, 0)
      this.moveNode(nodeB, -shiftX * directionX, 0)
    } else {
      // 垂直方向推开更容易
      const directionY = dy > 0 ? 1 : -1
      const shiftY = Math.max(overlapY / 2 + 1, 2)
      this.moveNode(nodeA, 0, shiftY * directionY)
      this.moveNode(nodeB, 0, -shiftY * directionY)
    }
  }

  /**
   * 移动节点
   */
  private moveNode(node: NodePosition, deltaX: number, deltaY: number): void {
    node.x += deltaX
    node.y += deltaY
    this.nodePositions.set(node.id, node)
  }

  /**
   * 优化间距
   */
  private optimizeSpacing(): void {
    const nodes = Array.from(this.nodePositions.values())

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i]
        const nodeB = nodes[j]

        const distance = this.calculateDistance(nodeA, nodeB)
        const minDistance = LAYOUT_CONSTANTS.DEFAULT_GAP * 2

        if (distance < minDistance) {
          this.pushNodeAway(nodeA, nodeB, minDistance - distance)
          nodes[i] = nodeA
          nodes[j] = nodeB
        }
      }
    }
  }

  /**
   * 计算两个节点中心的距离
   */
  private calculateDistance(nodeA: NodePosition, nodeB: NodePosition): number {
    const centerA = { x: nodeA.x + nodeA.width / 2, y: nodeA.y + nodeA.height / 2 }
    const centerB = { x: nodeB.x + nodeB.width / 2, y: nodeB.y + nodeB.height / 2 }

    return Math.sqrt(Math.pow(centerB.x - centerA.x, 2) + Math.pow(centerB.y - centerA.y, 2))
  }

  /**
   * 将节点推开
   */
  private pushNodeAway(nodeA: NodePosition, nodeB: NodePosition, gap: number): void {
    const dx = nodeB.x + nodeB.width / 2 - (nodeA.x + nodeA.width / 2)
    const dy = nodeB.y + nodeB.height / 2 - (nodeA.y + nodeA.height / 2)
    const distance = Math.sqrt(dx * dx + dy * dy) || 1

    const moveX = (dx / distance) * gap
    const moveY = (dy / distance) * gap

    nodeB.x += moveX
    nodeB.y += moveY
    this.nodePositions.set(nodeB.id, nodeB)
  }

  /**
   * 网格对齐优化
   */
  gridAlign(gridSize: number = 20): void {
    for (const [nodeId, node] of this.nodePositions) {
      node.x = Math.round(node.x / gridSize) * gridSize
      node.y = Math.round(node.y / gridSize) * gridSize
      this.nodePositions.set(nodeId, node)
    }
  }

  /**
   * 边界约束
   */
  constrainToBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    for (const [nodeId, node] of this.nodePositions) {
      if (node.x < minX) node.x = minX
      if (node.y < minY) node.y = minY
      if (node.x + node.width > maxX) node.x = maxX - node.width
      if (node.y + node.height > maxY) node.y = maxY - node.height
      this.nodePositions.set(nodeId, node)
    }
  }
}
