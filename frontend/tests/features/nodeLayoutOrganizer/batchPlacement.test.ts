import { describe, it, expect } from 'vitest'
import {
  layoutBatchAsColumn,
  computeItemsBounds,
  computeClearanceShift,
  type ColumnLayoutItem,
  type RectBounds,
} from '@/features/node-layout-organizer/utils/batchPlacement'

/** 批次条目工厂 */
function makeItem(id: string, width = 260, height = 100): ColumnLayoutItem {
  return { id, width, height }
}

/** 障碍矩形工厂（minX/minY + 尺寸） */
function makeRect(minX: number, minY: number, width: number, height: number): RectBounds {
  return { minX, minY, maxX: minX + width, maxY: minY + height }
}

/** 断言两个矩形是否相交（与实现语义一致的独立复算） */
function overlaps(a: RectBounds, b: RectBounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

describe('layoutBatchAsColumn', () => {
  it('空批次返回空 map', () => {
    const positions = layoutBatchAsColumn([], { x: 0, y: 0 }, 60)
    expect(positions.size).toBe(0)
  })

  it('单条目位于锚点', () => {
    const positions = layoutBatchAsColumn([makeItem('a')], { x: 420, y: 100 }, 60)
    expect(positions.get('a')).toEqual({ x: 420, y: 100 })
  })

  it('多条目垂直堆叠：x 对齐锚点，y 按实际高度 + 行距递进', () => {
    const positions = layoutBatchAsColumn(
      [makeItem('a', 260, 100), makeItem('b', 260, 120), makeItem('c', 260, 100)],
      { x: 420, y: 100 },
      60
    )
    expect(positions.get('a')).toEqual({ x: 420, y: 100 })
    // 第二条从第一条底部 + 行距开始
    expect(positions.get('b')).toEqual({ x: 420, y: 260 })
    // 第三条按第二条的实际高度（120）递进
    expect(positions.get('c')).toEqual({ x: 420, y: 440 })
  })

  it('保持输入顺序（导入顺序）', () => {
    const positions = layoutBatchAsColumn([makeItem('late'), makeItem('early')], { x: 0, y: 0 }, 10)
    expect(positions.get('late')!.y).toBeLessThan(positions.get('early')!.y)
  })
})

describe('computeItemsBounds', () => {
  it('空集合返回 null', () => {
    expect(computeItemsBounds([])).toBeNull()
  })

  it('计算联合包围盒', () => {
    const bounds = computeItemsBounds([
      { position: { x: 100, y: 200 }, width: 260, height: 100 },
      { position: { x: 500, y: 50 }, width: 300, height: 440 },
    ])
    expect(bounds).toEqual({ minX: 100, minY: 50, maxX: 800, maxY: 490 })
  })
})

describe('computeClearanceShift', () => {
  it('无障碍时位移为零', () => {
    const block = makeRect(420, 100, 260, 100)
    expect(computeClearanceShift(block, [], 40)).toEqual({ dx: 0, dy: 0 })
  })

  it('不与障碍相交时位移为零（边贴边不算相交）', () => {
    const block = makeRect(400, 0, 200, 100)
    const obstacle = makeRect(600, 0, 200, 100) // block.maxX === obstacle.minX
    expect(computeClearanceShift(block, [obstacle], 40)).toEqual({ dx: 0, dy: 0 })
  })

  it('右侧比其他方向更近时向右平移至障碍外并留出 gap', () => {
    // 障碍只浅浅压住 block 左缘，右侧空间大
    const block = makeRect(400, 0, 200, 100)
    const obstacle = makeRect(300, 0, 150, 100) // maxX=450
    const { dx, dy } = computeClearanceShift(block, [obstacle], 40)
    expect(dy).toBe(0)
    // 向右位移 = obstacle.maxX + gap - block.minX = 450 + 40 - 400 = 90
    expect(dx).toBe(90)
    const shifted = { ...block, minX: block.minX + dx, maxX: block.maxX + dx }
    expect(overlaps(shifted, obstacle)).toBe(false)
  })

  it('下方比右侧更近时选择向下平移', () => {
    const block = makeRect(0, 0, 200, 100)
    const obstacle = makeRect(150, 0, 100, 20) // 只在右下角浅浅重叠
    const { dx, dy } = computeClearanceShift(block, [obstacle], 10)
    // 向下位移 = obstacle.maxY + gap - block.minY = 20 + 10 - 0 = 30，远小于向右 260
    expect(dy).toBe(30)
    expect(dx).toBe(0)
    const shifted = { ...block, minY: block.minY + dy, maxY: block.maxY + dy }
    expect(overlaps(shifted, obstacle)).toBe(false)
  })

  it('左侧比右侧更近时选择向左平移（负位移）', () => {
    const block = makeRect(500, 0, 200, 100)
    const obstacle = makeRect(650, 0, 20, 100) // 细窄障碍在 block 中间偏右
    const { dx, dy } = computeClearanceShift(block, [obstacle], 10)
    // 向左位移 = obstacle.minX - gap - block.maxX = 650 - 10 - 700 = -60
    expect(dx).toBe(-60)
    expect(dy).toBe(0)
  })

  it('block 完全包含障碍时从位移最小的边推出', () => {
    const block = makeRect(0, 0, 1000, 1000)
    const obstacle = makeRect(900, 100, 50, 50) // 障碍贴近 block 右缘
    const { dx, dy } = computeClearanceShift(block, [obstacle], 10)
    // 四个方向中"向左推出"位移最小：900 - 10 - 1000 = -110
    expect(dx).toBe(-110)
    expect(dy).toBe(0)
  })

  it('链式障碍：方向选定后单调推进，最终与全部障碍无相交', () => {
    const block = makeRect(0, 0, 200, 100)
    const obstacles = [
      makeRect(100, 0, 100, 100), // 第一轮相交
      makeRect(100, 120, 100, 100), // 下移后第二轮相交
      makeRect(100, 240, 100, 100), // 下移后第三轮相交
    ]
    const { dx, dy } = computeClearanceShift(block, obstacles, 20)
    expect(dx).toBe(0)
    expect(dy).toBeGreaterThan(0)
    const shifted = {
      ...block,
      minY: block.minY + dy,
      maxY: block.maxY + dy,
      minX: block.minX + dx,
      maxX: block.maxX + dx,
    }
    for (const obstacle of obstacles) {
      expect(overlaps(shifted, obstacle)).toBe(false)
    }
  })
})
