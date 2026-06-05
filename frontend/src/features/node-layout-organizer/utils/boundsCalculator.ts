/**
 * @file boundsCalculator.ts
 * @description 节点边界计算器
 *
 * 功能概述：
 * - 单节点与多节点组合边界计算
 * - 重叠检测与重叠量计算
 * - 边界缩放、平移变换
 * - 迭代式重叠消解算法
 */
import type { NodePosition } from '../types'
import { NODE_DIMENSIONS } from '../constants'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export class BoundsCalculator {
  /**
   * 计算单个节点的边界
   */
  static calculateNodeBounds(x: number, y: number, width: number, height: number): Bounds {
    return {
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
    }
  }

  /**
   * 计算多个节点的组合边界
   */
  static calculateCombinedBounds(positions: NodePosition[]): Bounds {
    if (positions.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
        centerX: 0,
        centerY: 0,
      }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const pos of positions) {
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + pos.width)
      maxY = Math.max(maxY, pos.y + pos.height)
    }

    const width = maxX - minX
    const height = maxY - minY

    return {
      minX,
      minY,
      maxX,
      maxY,
      width,
      height,
      centerX: minX + width / 2,
      centerY: minY + height / 2,
    }
  }

  /**
   * 计算适合所有节点的矩形区域
   */
  static calculateFitBounds(
    positions: NodePosition[],
    padding: number,
    canvasWidth: number,
    canvasHeight: number
  ): Bounds {
    const combined = this.calculateCombinedBounds(positions)
    const aspectRatio = combined.width / combined.height

    let fitWidth = combined.width + padding * 2
    let fitHeight = combined.height + padding * 2

    if (fitWidth > canvasWidth) {
      fitWidth = canvasWidth
      fitHeight = fitWidth / aspectRatio
    }

    if (fitHeight > canvasHeight) {
      fitHeight = canvasHeight
      fitWidth = fitHeight * aspectRatio
    }

    const fitX = (canvasWidth - fitWidth) / 2
    const fitY = (canvasHeight - fitHeight) / 2

    return {
      minX: fitX,
      minY: fitY,
      maxX: fitX + fitWidth,
      maxY: fitY + fitHeight,
      width: fitWidth,
      height: fitHeight,
      centerX: fitX + fitWidth / 2,
      centerY: fitY + fitHeight / 2,
    }
  }

  /**
   * 检查边界是否重叠
   */
  static checkOverlap(boundsA: Bounds, boundsB: Bounds, padding: number = 0): boolean {
    return !(
      boundsA.maxX + padding < boundsB.minX ||
      boundsA.minX > boundsB.maxX + padding ||
      boundsA.maxY + padding < boundsB.minY ||
      boundsA.minY > boundsB.maxY + padding
    )
  }

  /**
   * 计算两个边界的中心距离
   */
  static getCenterDistance(boundsA: Bounds, boundsB: Bounds): number {
    const dx = boundsA.centerX - boundsB.centerX
    const dy = boundsA.centerY - boundsB.centerY
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * 计算边界重叠量
   */
  static getOverlapAmount(
    boundsA: Bounds,
    boundsB: Bounds
  ): {
    horizontal: number
    vertical: number
  } {
    const horizontalOverlap =
      Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX)
    const verticalOverlap =
      Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY)

    return {
      horizontal: Math.max(0, horizontalOverlap),
      vertical: Math.max(0, verticalOverlap),
    }
  }

  /**
   * 缩放边界
   */
  static scale(
    bounds: Bounds,
    scaleX: number,
    scaleY: number,
    anchor: 'center' | 'topLeft' = 'center'
  ): Bounds {
    const newWidth = bounds.width * scaleX
    const newHeight = bounds.height * scaleY

    let newMinX: number
    let newMinY: number

    if (anchor === 'center') {
      newMinX = bounds.centerX - newWidth / 2
      newMinY = bounds.centerY - newHeight / 2
    } else {
      newMinX = bounds.minX
      newMinY = bounds.minY
    }

    return {
      minX: newMinX,
      minY: newMinY,
      maxX: newMinX + newWidth,
      maxY: newMinY + newHeight,
      width: newWidth,
      height: newHeight,
      centerX: newMinX + newWidth / 2,
      centerY: newMinY + newHeight / 2,
    }
  }

  /**
   * 平移边界
   */
  static translate(bounds: Bounds, deltaX: number, deltaY: number): Bounds {
    return {
      minX: bounds.minX + deltaX,
      minY: bounds.minY + deltaY,
      maxX: bounds.maxX + deltaX,
      maxY: bounds.maxY + deltaY,
      width: bounds.width,
      height: bounds.height,
      centerX: bounds.centerX + deltaX,
      centerY: bounds.centerY + deltaY,
    }
  }

  /**
   * 解决多个边界之间的重叠问题
   * 使用迭代平移算法，从左到右、从上到下依次布局
   */
  static resolveOverlaps(
    boundsList: Bounds[],
    padding: number = 20,
    step: number = 50,
    maxAttempts: number = 20
  ): Map<number, { x: number; y: number }> {
    const offsetMap = new Map<number, { x: number; y: number }>()

    if (boundsList.length === 0) return offsetMap

    const sortedIndices = boundsList
      .map((b, i) => ({ bounds: b, index: i }))
      .sort((a, b) => {
        if (Math.abs(a.bounds.minY - b.bounds.minY) < 50) {
          return a.bounds.minX - b.bounds.minX
        }
        return a.bounds.minY - b.bounds.minY
      })
      .map((item) => item.index)

    for (const currentIdx of sortedIndices) {
      const currentBounds = boundsList[currentIdx]
      if (!currentBounds) continue
      let offsetX = 0
      let offsetY = 0
      let attempts = 0

      while (attempts < maxAttempts) {
        let hasOverlap = false

        for (const prevIdx of sortedIndices) {
          if (prevIdx >= currentIdx) break

          const prevOffset = offsetMap.get(prevIdx) || { x: 0, y: 0 }
          const prevBoundsRaw = boundsList[prevIdx]
          if (!prevBoundsRaw) continue
          const prevBounds = this.translate(prevBoundsRaw, prevOffset.x, prevOffset.y)
          const currentTranslated = this.translate(currentBounds, offsetX, offsetY)

          if (this.checkOverlap(prevBounds, currentTranslated, padding)) {
            hasOverlap = true

            const dx = currentTranslated.minX - prevBounds.maxX
            const dy = currentTranslated.minY - prevBounds.maxY

            if (Math.abs(dx) < Math.abs(dy)) {
              offsetX += step
            } else {
              offsetY += step
            }
            break
          }
        }

        if (!hasOverlap) break
        attempts++
      }

      offsetMap.set(currentIdx, { x: offsetX, y: offsetY })
    }

    return offsetMap
  }
}
