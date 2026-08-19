/**
 * @file batchPlacement.ts
 * @description 批次节点放置计算（纯函数，无 I/O 依赖）
 *
 * 用于两个场景：
 * 1. 项目加载/工作区恢复后，对"位置异常节点"重新布局时计算整体平移量，
 *    避开位置正常节点的包围盒（不压盖用户手动摆放的内容）。
 * 2. 批量导入（如约束连带导入）后，对新导入批次计算列式布局位置。
 *
 * 坐标系与 Vue Flow 画布坐标一致（x 向右、y 向下）。
 */

/** 轴对齐矩形（画布坐标） */
export interface RectBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 参与列式布局的批次条目（id + 预估尺寸） */
export interface ColumnLayoutItem {
  id: string
  width: number
  height: number
}

/** 已放置条目（位置 + 尺寸），用于计算包围盒 */
export interface PlacedItem {
  position: { x: number; y: number }
  width: number
  height: number
}

/**
 * 单列布局：从 origin 出发垂直堆叠（x 全部对齐 origin.x），
 * y 方向按各条目实际高度 + rowGap 递进。保持输入顺序（通常为导入顺序）。
 *
 * @returns id → 位置
 */
export function layoutBatchAsColumn(
  items: ReadonlyArray<ColumnLayoutItem>,
  origin: { x: number; y: number },
  rowGap: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  let cursorY = origin.y
  for (const item of items) {
    positions.set(item.id, { x: origin.x, y: cursorY })
    cursorY += item.height + rowGap
  }
  return positions
}

/** 计算一批已放置条目的联合包围盒；空批次返回 null */
export function computeItemsBounds(items: ReadonlyArray<PlacedItem>): RectBounds | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    minX = Math.min(minX, item.position.x)
    minY = Math.min(minY, item.position.y)
    maxX = Math.max(maxX, item.position.x + item.width)
    maxY = Math.max(maxY, item.position.y + item.height)
  }
  return { minX, minY, maxX, maxY }
}

/** 严格相交判定（边贴边不算相交） */
function rectsOverlap(a: RectBounds, b: RectBounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

/** 计算一组矩形的联合包围盒（调用方保证非空） */
function unionBounds(rects: ReadonlyArray<RectBounds>): RectBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.minX)
    minY = Math.min(minY, r.minY)
    maxX = Math.max(maxX, r.maxX)
    maxY = Math.max(maxY, r.maxY)
  }
  return { minX, minY, maxX, maxY }
}

/** 位移方向（首轮选定后保持不变，保证单调推进、必然收敛） */
type ShiftDirection = 'right' | 'down' | 'left' | 'up'

/**
 * 计算把 block 平移到不与任何 obstacle 相交所需的最小位移。
 *
 * 算法：迭代消解——每轮取当前与 block 相交的 obstacles 的联合包围盒，
 * 在 右/下/左/上 四个方向中选位移绝对值最小的方向，把 block 推到
 * 联合包围盒外（留 gap 间距）。首轮确定方向后后续轮次沿用该方向，
 * 保证位移单调递增、不会在两个障碍之间振荡。
 *
 * @param block 待放置矩形（原始位置）
 * @param obstacles 需要避开的矩形集合
 * @param gap 与障碍物保持的最小间距
 * @param maxIterations 迭代上限（防御性收敛保护）
 * @returns 平移量 {dx, dy}；无相交时为 {0, 0}
 */
export function computeClearanceShift(
  block: RectBounds,
  obstacles: ReadonlyArray<RectBounds>,
  gap: number,
  maxIterations = 16
): { dx: number; dy: number } {
  let dx = 0
  let dy = 0
  let direction: ShiftDirection | null = null

  for (let i = 0; i < maxIterations; i++) {
    const current: RectBounds = {
      minX: block.minX + dx,
      minY: block.minY + dy,
      maxX: block.maxX + dx,
      maxY: block.maxY + dy,
    }
    const overlapping = obstacles.filter((o) => rectsOverlap(current, o))
    if (overlapping.length === 0) break

    const union = unionBounds(overlapping)
    // 各方向把 current 推出 union（含 gap）所需的位移
    const candidates = (
      [
        { dir: 'right', delta: union.maxX + gap - current.minX, axis: 'x' },
        { dir: 'down', delta: union.maxY + gap - current.minY, axis: 'y' },
        { dir: 'left', delta: union.minX - gap - current.maxX, axis: 'x' },
        { dir: 'up', delta: union.minY - gap - current.maxY, axis: 'y' },
      ] as Array<{ dir: ShiftDirection; delta: number; axis: 'x' | 'y' }>
    ).filter((c) => Math.abs(c.delta) > Number.EPSILON)

    // 首轮：选位移绝对值最小的方向；后续轮次沿用，保证单调推进
    let chosen: { dir: ShiftDirection; delta: number; axis: 'x' | 'y' } | undefined
    if (direction === null) {
      chosen = candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]
    } else {
      chosen = candidates.find((c) => c.dir === direction)
    }

    if (!chosen) break
    direction = chosen.dir
    if (chosen.axis === 'x') {
      dx += chosen.delta
    } else {
      dy += chosen.delta
    }
  }

  return { dx, dy }
}
