import { describe, it, expect } from 'vitest'
import { detectPositionAnomalies } from '@/features/node-layout-organizer/utils/overlapDetection'

/** 轻量探针节点工厂：仅含检测所需的 id 与 position 字段 */
function makeNode(id: string, x?: number | null, y?: number | null) {
  if (x === null || x === undefined || y === null || y === undefined) {
    return { id, position: undefined }
  }
  return { id, position: { x, y } }
}

describe('detectPositionAnomalies', () => {
  it('空节点列表无异常', () => {
    const report = detectPositionAnomalies([])
    expect(report.affectedIds).toHaveLength(0)
    expect(report.invalidPositionIds).toHaveLength(0)
    expect(report.stackedPositionIds).toHaveLength(0)
  })

  it('位置互不相同的正常布局无异常', () => {
    const report = detectPositionAnomalies([
      makeNode('root', 80, 80),
      makeNode('schema', 300, 100),
      makeNode('constraint', 720, 100),
      makeNode('zero-x-only', 0, 200),
    ])
    expect(report.affectedIds).toHaveLength(0)
  })

  it('缺失位置的节点被标记为非法位置', () => {
    const report = detectPositionAnomalies([makeNode('ok', 100, 100), makeNode('missing')])
    expect(report.invalidPositionIds).toEqual(['missing'])
    expect(report.affectedIds).toEqual(['missing'])
  })

  it('恰好位于 (0,0) 的节点被视为零位置异常', () => {
    const report = detectPositionAnomalies([makeNode('ok', 10, 10), makeNode('zero', 0, 0)])
    expect(report.affectedIds).toEqual(['zero'])
  })

  it('非有限坐标被视为非法位置', () => {
    const report = detectPositionAnomalies([
      { id: 'nan', position: { x: Number.NaN, y: 100 } },
      makeNode('ok', 50, 50),
    ])
    expect(report.affectedIds).toEqual(['nan'])
  })

  it('完全同坐标的多个节点整组标记为堆叠异常', () => {
    const report = detectPositionAnomalies([
      makeNode('root', 80, 80),
      makeNode('tpl-1', 300, 100),
      makeNode('tpl-2', 300, 100),
      makeNode('tpl-3', 300, 100),
    ])
    // 堆叠组内无法区分谁是原始位置，全部计入
    expect(new Set(report.stackedPositionIds)).toEqual(new Set(['tpl-1', 'tpl-2', 'tpl-3']))
    expect(report.affectedIds).toHaveLength(3)
    // 位置正常节点不受影响
    expect(report.affectedIds).not.toContain('root')
  })

  it('不同坐标的节点不构成堆叠（近邻但不同坐标）', () => {
    const report = detectPositionAnomalies([makeNode('a', 300, 100), makeNode('b', 300, 101)])
    expect(report.affectedIds).toHaveLength(0)
  })

  it('affectedIds 是非法位置与堆叠的并集且去重', () => {
    const report = detectPositionAnomalies([
      makeNode('missing'),
      makeNode('zero', 0, 0),
      makeNode('dup-a', 500, 500),
      makeNode('dup-b', 500, 500),
    ])
    expect(report.affectedIds).toHaveLength(4)
    expect(new Set(report.affectedIds).size).toBe(4)
  })
})
