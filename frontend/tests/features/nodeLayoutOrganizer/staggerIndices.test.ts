import { describe, it, expect } from 'vitest'
import { computeStaggerIndices } from '@/features/node-layout-organizer/composables/useNodeOrganizer'

/** 轻量位置节点工厂，仅含 computeStaggerIndices 关心的字段 */
function makeNode(id: string, x: number, y: number) {
  return { id, position: { x, y } }
}

describe('computeStaggerIndices', () => {
  it('空输入返回空 map', () => {
    const result = computeStaggerIndices(new Map(), [])
    expect(result.size).toBe(0)
  })

  it('单个节点归一化索引为 0', () => {
    const targets = new Map([['n1', { x: 100, y: 100 }]])
    const nodes = [makeNode('n1', 100, 100)]
    const result = computeStaggerIndices(targets, nodes)
    expect(result.get('n1')).toBe(0)
  })

  it('距质心越近的节点索引越小（涟漪从中心向外）', () => {
    // 单中心 + 三个对称外围 + 一个远点。
    // 质心会被对称的外围节点拉到中心附近，center 最近，far 最远。
    const targets = new Map([
      ['center', { x: 0, y: 0 }],
      ['east', { x: 0, y: 0 }],
      ['west', { x: 0, y: 0 }],
      ['north', { x: 0, y: 0 }],
      ['far', { x: 0, y: 0 }],
    ])
    const nodes = [
      makeNode('center', 100, 100),
      makeNode('east', 200, 100),
      makeNode('west', 0, 100),
      makeNode('north', 100, 0),
      makeNode('far', 1000, 1000),
    ]
    const result = computeStaggerIndices(targets, nodes)

    // 所有索引落在 [0, 1]
    for (const v of result.values()) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    // 最远的 far 索引为 1（在末位）
    expect(result.get('far')).toBe(1)
    // center 比 far 更靠近质心 → 索引更小
    expect(result.get('center')!).toBeLessThan(result.get('far')!)
  })

  it('不依赖目标位置本身的数值，仅用节点当前位置排序', () => {
    // 目标位置全部相同，但节点当前散布；应按节点当前位置到质心排序
    // 节点 a(0,0)、b(100,0) → 质心 (50,0)，a 与 b 等距（稳定排序保持 a 在前）
    // 加入 c(50,0) 正好在质心 → c 索引最小，证明用的是当前位置而非目标位置
    const targets = new Map([
      ['a', { x: 999, y: 999 }],
      ['b', { x: 999, y: 999 }],
      ['c', { x: 999, y: 999 }],
    ])
    const nodes = [makeNode('a', 0, 0), makeNode('b', 100, 0), makeNode('c', 50, 0)]
    const result = computeStaggerIndices(targets, nodes)
    // c 在质心 → 索引 0；a、b 等距，稳定排序保持 a 在 b 前 → a=0.5、b=1
    expect(result.get('c')).toBe(0)
    expect(result.get('a')).toBe(0.5)
    expect(result.get('b')).toBe(1)
  })

  it('target 中存在但 nodes 中缺失位置时兜底为 0', () => {
    const targets = new Map([['ghost', { x: 0, y: 0 }]])
    const result = computeStaggerIndices(targets, [])
    expect(result.get('ghost')).toBe(0)
  })

  it('覆盖所有 target 节点', () => {
    const targets = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 1, y: 1 }],
      ['n3', { x: 2, y: 2 }],
    ])
    const nodes = [makeNode('n1', 0, 0), makeNode('n2', 1, 1), makeNode('n3', 2, 2)]
    const result = computeStaggerIndices(targets, nodes)
    expect(result.size).toBe(3)
  })
})
