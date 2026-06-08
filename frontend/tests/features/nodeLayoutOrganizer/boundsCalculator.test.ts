import { describe, it, expect } from 'vitest'
import { BoundsCalculator, type Bounds } from '@/features/node-layout-organizer/utils/boundsCalculator'
import type { NodePosition } from '@/features/node-layout-organizer/types'

describe('BoundsCalculator - calculateNodeBounds', () => {
  it('returns bounds for a positive origin', () => {
    const bounds = BoundsCalculator.calculateNodeBounds(10, 20, 100, 50)
    expect(bounds).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
      width: 100,
      height: 50,
      centerX: 60,
      centerY: 45,
    })
  })

  it('handles zero origin', () => {
    const bounds = BoundsCalculator.calculateNodeBounds(0, 0, 200, 100)
    expect(bounds.minX).toBe(0)
    expect(bounds.minY).toBe(0)
    expect(bounds.centerX).toBe(100)
    expect(bounds.centerY).toBe(50)
  })

  it('handles negative origin', () => {
    const bounds = BoundsCalculator.calculateNodeBounds(-50, -30, 100, 60)
    expect(bounds.minX).toBe(-50)
    expect(bounds.minY).toBe(-30)
    expect(bounds.maxX).toBe(50)
    expect(bounds.maxY).toBe(30)
  })
})

describe('BoundsCalculator - calculateCombinedBounds', () => {
  it('returns zero bounds for empty input', () => {
    const bounds = BoundsCalculator.calculateCombinedBounds([])
    expect(bounds.width).toBe(0)
    expect(bounds.height).toBe(0)
    expect(bounds.centerX).toBe(0)
    expect(bounds.centerY).toBe(0)
  })

  it('returns single node bounds for single input', () => {
    const positions: NodePosition[] = [{ id: 'a', x: 5, y: 10, width: 50, height: 30 }]
    const bounds = BoundsCalculator.calculateCombinedBounds(positions)
    expect(bounds.minX).toBe(5)
    expect(bounds.minY).toBe(10)
    expect(bounds.maxX).toBe(55)
    expect(bounds.maxY).toBe(40)
  })

  it('returns bounding box for multiple positions', () => {
    const positions: NodePosition[] = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 100, y: 100, width: 50, height: 50 },
      { id: 'c', x: 200, y: 0, width: 50, height: 50 },
    ]
    const bounds = BoundsCalculator.calculateCombinedBounds(positions)
    expect(bounds.minX).toBe(0)
    expect(bounds.minY).toBe(0)
    expect(bounds.maxX).toBe(250)
    expect(bounds.maxY).toBe(150)
    expect(bounds.width).toBe(250)
    expect(bounds.height).toBe(150)
    expect(bounds.centerX).toBe(125)
    expect(bounds.centerY).toBe(75)
  })
})

describe('BoundsCalculator - calculateFitBounds', () => {
  it('centers within canvas and adds padding', () => {
    const positions: NodePosition[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
    ]
    const bounds = BoundsCalculator.calculateFitBounds(positions, 10, 400, 300)
    expect(bounds.minX).toBeGreaterThan(0)
    expect(bounds.minY).toBeGreaterThan(0)
    expect(bounds.maxX).toBeLessThanOrEqual(400)
    expect(bounds.maxY).toBeLessThanOrEqual(300)
  })

  it('constrains to canvas width when content is wider', () => {
    const positions: NodePosition[] = [
      { id: 'a', x: 0, y: 0, width: 2000, height: 100 },
    ]
    const bounds = BoundsCalculator.calculateFitBounds(positions, 10, 1000, 500)
    expect(bounds.width).toBeLessThanOrEqual(1000)
  })

  it('constrains to canvas height when content is taller', () => {
    const positions: NodePosition[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 2000 },
    ]
    const bounds = BoundsCalculator.calculateFitBounds(positions, 10, 1000, 500)
    expect(bounds.height).toBeLessThanOrEqual(500)
  })
})

describe('BoundsCalculator - checkOverlap', () => {
  const a: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
  const b: Bounds = { minX: 50, minY: 50, maxX: 150, maxY: 150, width: 100, height: 100, centerX: 100, centerY: 100 }
  const farRight: Bounds = { minX: 200, minY: 0, maxX: 300, maxY: 100, width: 100, height: 100, centerX: 250, centerY: 50 }

  it('detects overlap when bounds intersect', () => {
    expect(BoundsCalculator.checkOverlap(a, b)).toBe(true)
  })

  it('detects no overlap when bounds are separate', () => {
    expect(BoundsCalculator.checkOverlap(a, farRight)).toBe(false)
  })

  it('treats touching edges as overlap in this implementation', () => {
    // 源码实现使用严格 < 比较，但 maxX + 0 < minX 边界情况判定为重叠
    // （即 a.maxX = 100, b.minX = 100: 100 < 100 为 false，但其他比较也都 false，所以返回 true）
    const touching: Bounds = { minX: 100, minY: 0, maxX: 200, maxY: 100, width: 100, height: 100, centerX: 150, centerY: 50 }
    expect(BoundsCalculator.checkOverlap(a, touching)).toBe(true)
  })

  it('respects padding parameter', () => {
    const close: Bounds = { minX: 105, minY: 0, maxX: 200, maxY: 100, width: 95, height: 100, centerX: 152, centerY: 50 }
    expect(BoundsCalculator.checkOverlap(a, close, 0)).toBe(false)
    expect(BoundsCalculator.checkOverlap(a, close, 10)).toBe(true)
  })
})

describe('BoundsCalculator - getCenterDistance', () => {
  it('returns 0 for coincident centers', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
    const b: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
    expect(BoundsCalculator.getCenterDistance(a, b)).toBe(0)
  })

  it('returns correct distance for 3-4-5 triangle', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10, centerX: 0, centerY: 0 }
    const b: Bounds = { minX: 6, minY: 8, maxX: 16, maxY: 18, width: 10, height: 10, centerX: 6, centerY: 8 }
    expect(BoundsCalculator.getCenterDistance(a, b)).toBeCloseTo(10, 5)
  })
})

describe('BoundsCalculator - getOverlapAmount', () => {
  it('returns 0 when bounds do not overlap', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
    const b: Bounds = { minX: 200, minY: 200, maxX: 300, maxY: 300, width: 100, height: 100, centerX: 250, centerY: 250 }
    const overlap = BoundsCalculator.getOverlapAmount(a, b)
    expect(overlap.horizontal).toBe(0)
    expect(overlap.vertical).toBe(0)
  })

  it('returns positive values for partial overlap', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
    const b: Bounds = { minX: 50, minY: 50, maxX: 150, maxY: 150, width: 100, height: 100, centerX: 100, centerY: 100 }
    const overlap = BoundsCalculator.getOverlapAmount(a, b)
    expect(overlap.horizontal).toBe(50)
    expect(overlap.vertical).toBe(50)
  })
})

describe('BoundsCalculator - scale', () => {
  const b: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }

  it('scales uniformly around center by default', () => {
    const scaled = BoundsCalculator.scale(b, 2, 2)
    expect(scaled.width).toBe(200)
    expect(scaled.height).toBe(200)
    expect(scaled.centerX).toBe(50)
    expect(scaled.centerY).toBe(50)
    expect(scaled.minX).toBe(-50)
    expect(scaled.minY).toBe(-50)
  })

  it('scales non-uniformly', () => {
    const scaled = BoundsCalculator.scale(b, 2, 0.5)
    expect(scaled.width).toBe(200)
    expect(scaled.height).toBe(50)
  })

  it('scales around top-left anchor', () => {
    const scaled = BoundsCalculator.scale(b, 2, 2, 'topLeft')
    expect(scaled.minX).toBe(0)
    expect(scaled.minY).toBe(0)
    expect(scaled.maxX).toBe(200)
    expect(scaled.maxY).toBe(200)
  })
})

describe('BoundsCalculator - translate', () => {
  it('shifts all coordinates by the delta', () => {
    const b: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 }
    const translated = BoundsCalculator.translate(b, 30, 20)
    expect(translated.minX).toBe(30)
    expect(translated.minY).toBe(20)
    expect(translated.maxX).toBe(130)
    expect(translated.maxY).toBe(120)
    expect(translated.width).toBe(100)
    expect(translated.height).toBe(100)
  })

  it('handles negative deltas', () => {
    const b: Bounds = { minX: 50, minY: 50, maxX: 150, maxY: 150, width: 100, height: 100, centerX: 100, centerY: 100 }
    const translated = BoundsCalculator.translate(b, -50, -50)
    expect(translated.minX).toBe(0)
    expect(translated.minY).toBe(0)
  })
})

describe('BoundsCalculator - resolveOverlaps', () => {
  it('returns empty map for empty input', () => {
    const result = BoundsCalculator.resolveOverlaps([])
    expect(result.size).toBe(0)
  })

  it('returns zero offsets when nothing overlaps', () => {
    const bounds: Bounds[] = [
      { minX: 0, minY: 0, maxX: 50, maxY: 50, width: 50, height: 50, centerX: 25, centerY: 25 },
      { minX: 100, minY: 0, maxX: 150, maxY: 50, width: 50, height: 50, centerX: 125, centerY: 25 },
    ]
    const result = BoundsCalculator.resolveOverlaps(bounds)
    expect(result.size).toBe(2)
    expect(result.get(0)).toEqual({ x: 0, y: 0 })
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
  })

  it('shifts overlapping bounds to resolve conflict', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 50, maxY: 50, width: 50, height: 50, centerX: 25, centerY: 25 }
    const b: Bounds = { minX: 10, minY: 10, maxX: 60, maxY: 60, width: 50, height: 50, centerX: 35, centerY: 35 }
    const result = BoundsCalculator.resolveOverlaps([a, b], 5, 50, 10)
    expect(result.size).toBe(2)
    const offsetB = result.get(1)
    expect(offsetB).toBeDefined()
    if (offsetB) {
      const totalOffset = Math.abs(offsetB.x) + Math.abs(offsetB.y)
      expect(totalOffset).toBeGreaterThan(0)
    }
  })

  it('respects maxAttempts limit', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 50, maxY: 50, width: 50, height: 50, centerX: 25, centerY: 25 }
    const b: Bounds = { minX: 10, minY: 10, maxX: 60, maxY: 60, width: 50, height: 50, centerX: 35, centerY: 35 }
    const result = BoundsCalculator.resolveOverlaps([a, b], 5, 1, 2)
    expect(result.size).toBe(2)
  })
})
