import { describe, it, expect } from 'vitest'
import {
  resolveSpawnPosition,
  DEFAULT_NEW_NODE_SIZE,
  type SpawnOccupant,
} from '@/services/canvas/spawnPosition'

function makeOccupant(x: number, y: number, width?: number, height?: number): SpawnOccupant {
  return { position: { x, y }, width, height }
}

describe('resolveSpawnPosition', () => {
  it('画布为空时直接返回视口中心', () => {
    const pos = resolveSpawnPosition({ viewportCenter: { x: 500, y: 400 }, occupants: [] })
    expect(pos).toEqual({ x: 500, y: 400 })
  })

  it('视口中心未知时回退到画布原点附近的默认坐标', () => {
    const pos = resolveSpawnPosition({ viewportCenter: null, occupants: [] })
    expect(pos).toEqual({ x: 160, y: 120 })
  })

  it('中心被占用时沿对角线级联到第一个空闲位置', () => {
    // 步长 40px 小于节点高 160px，对角级联需越过后代节点的投影：
    // i=5 时 top(=400+5*40-16=584) ≥ 400+160 → 首个不重叠候选为 (700,600)
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants: [makeOccupant(500, 400)],
    })
    expect(pos).toEqual({ x: 700, y: 600 })
  })

  it('连续级联可跳过多个相邻占位节点', () => {
    const step = 40
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants: [
        makeOccupant(500, 400),
        makeOccupant(500 + step, 400 + step),
        makeOccupant(500 + 2 * step, 400 + 2 * step),
      ],
    })
    // 前 3 个候选被显式占用；第 3 个占位 (580,480) 的投影延伸到 y=640，
    // 候选需 top ≥ 640 → i=7 才完全脱离 → (780,680)
    expect(pos).toEqual({ x: 500 + 7 * step, y: 400 + 7 * step })
  })

  it('间隙内的贴邻节点被视为占用（gap 生效）', () => {
    // 候选 (500,400)，新节点高 160；既有节点顶部在 400+160+8（< gap 16）→ 视为重叠
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants: [makeOccupant(500, 400 + DEFAULT_NEW_NODE_SIZE.height + 8)],
    })
    expect(pos).not.toEqual({ x: 500, y: 400 })
  })

  it('既有节点缺实测尺寸时使用保守回退尺寸', () => {
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants: [makeOccupant(500, 400)],
      newNodeSize: { width: 100, height: 50 },
    })
    // 占位节点无尺寸 → 按 280x160 回退；对角级联 i=5 时才脱离其投影 → (700,600)
    expect(pos).toEqual({ x: 700, y: 600 })
  })

  it('右下级联全部被占用时反方向（左上）级联避让', () => {
    const occupants: SpawnOccupant[] = []
    const step = 40
    const max = 24
    for (let i = 0; i <= max; i++) {
      occupants.push(makeOccupant(500 + i * step, 400 + i * step))
    }
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants,
      maxCascade: max,
    })
    // 右下全被占 → 左上级联至脱离占据投影的第一个空闲候选（i=5，因回退尺寸 280x160 投影较宽）
    expect(pos).toEqual({ x: 500 - 5 * step, y: 400 - 5 * step })
  })

  it('正反方向级联全部被占用时返回视口中心附近而非远离视口', () => {
    const occupants: SpawnOccupant[] = []
    const step = 40
    const max = 24
    // 右下与左上两个方向的全部候选都被占
    for (let i = 0; i <= max; i++) {
      occupants.push(makeOccupant(500 + i * step, 400 + i * step))
      occupants.push(makeOccupant(500 - i * step, 400 - i * step))
    }
    const pos = resolveSpawnPosition({
      viewportCenter: { x: 500, y: 400 },
      occupants,
      maxCascade: max,
    })
    // 兜底：宁可轻微重叠也要落在视口中心附近（可见优先）
    expect(pos).toEqual({ x: 540, y: 440 })
  })
})
