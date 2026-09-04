import { describe, it, expect } from 'vitest'
import {
  MEASURED_DIMENSION_SAFETY_FACTOR,
  getDefaultDimension,
  getSchemaPersistedDimension,
  readMeasuredDimension,
  resolveMeasuredDimension,
} from '@/features/node-layout-organizer/utils/nodeDimensionHelper'
import { getFallbackDimension } from '@/features/node-layout-organizer/strategies/familyLayout'
import { LAYOUT_CONSTANTS } from '@/features/node-layout-organizer/constants'

describe('readMeasuredDimension（Vue Flow dimensions 只读提取）', () => {
  it('读取节点上的 dimensions 字段', () => {
    expect(readMeasuredDimension({ dimensions: { width: 690, height: 383 } })).toEqual({
      width: 690,
      height: 383,
    })
  })

  it('渲染前的 {0,0} 与缺失字段均返回 null', () => {
    expect(readMeasuredDimension({ dimensions: { width: 0, height: 0 } })).toBeNull()
    expect(readMeasuredDimension({})).toBeNull()
    expect(readMeasuredDimension(null)).toBeNull()
  })
})

describe('resolveMeasuredDimension', () => {
  const fallback = { width: 260, height: 130 }

  it('跳过无效候选，取第一个宽高均为正的候选', () => {
    const result = resolveMeasuredDimension(
      [null, undefined, { width: 0, height: 120 }, { width: 180, height: 120 }],
      fallback
    )
    expect(result.width).toBeCloseTo(Math.max(180, 260) * MEASURED_DIMENSION_SAFETY_FACTOR)
    expect(result.height).toBeCloseTo(Math.max(120, 130) * MEASURED_DIMENSION_SAFETY_FACTOR)
  })

  it('实测大于兜底时用实测值并放大安全系数', () => {
    const result = resolveMeasuredDimension([{ width: 690, height: 383 }], fallback)
    expect(result.width).toBeCloseTo(690 * MEASURED_DIMENSION_SAFETY_FACTOR)
    expect(result.height).toBeCloseTo(Math.max(383, 130) * MEASURED_DIMENSION_SAFETY_FACTOR)
  })

  it('实测小于兜底时逐轴取 max（保守方向）', () => {
    const result = resolveMeasuredDimension([{ width: 180, height: 120 }], fallback)
    expect(result.width).toBeCloseTo(260 * MEASURED_DIMENSION_SAFETY_FACTOR)
    expect(result.height).toBeCloseTo(130 * MEASURED_DIMENSION_SAFETY_FACTOR)
  })

  it('全部候选无效时原样返回兜底值（不再放大）', () => {
    const result = resolveMeasuredDimension([null, { width: 0, height: 0 }], fallback)
    expect(result).toEqual(fallback)
  })

  it('候选按顺序优先：第一个有效候选获胜', () => {
    const result = resolveMeasuredDimension(
      [
        { width: 500, height: 300 },
        { width: 900, height: 900 },
      ],
      fallback
    )
    expect(result.width).toBeCloseTo(500 * MEASURED_DIMENSION_SAFETY_FACTOR)
  })
})

describe('getSchemaPersistedDimension', () => {
  it('读取有效的持久化宽高', () => {
    expect(getSchemaPersistedDimension({ width: 690, height: 383 })).toEqual({
      width: 690,
      height: 383,
    })
  })

  it('height 为 auto（缺失）时整体不作为候选', () => {
    expect(getSchemaPersistedDimension({ width: 690 })).toBeNull()
  })

  it('非对象或非法数值返回 null', () => {
    expect(getSchemaPersistedDimension(null)).toBeNull()
    expect(getSchemaPersistedDimension('schema')).toBeNull()
    expect(getSchemaPersistedDimension({ width: -10, height: 300 })).toBeNull()
    expect(getSchemaPersistedDimension({ width: 300, height: 'auto' })).toBeNull()
  })
})

describe('兜底尺寸校准（DEF-14）', () => {
  it('约束节点兜底高度不低于实测（约 120）', () => {
    expect(getDefaultDimension('notNullConstraint').height).toBeGreaterThanOrEqual(120)
  })

  it('projectRoot 兜底高度不低于实测（约 126）', () => {
    expect(getDefaultDimension('projectRoot').height).toBeGreaterThanOrEqual(126)
  })

  it('schema 兜底宽度与组件默认宽一致', () => {
    expect(getFallbackDimension('schema').width).toBe(360)
  })

  it('网格对齐粒度必须小于默认间距（不重叠不变量）', () => {
    expect(LAYOUT_CONSTANTS.GRID_SIZE).toBeLessThan(LAYOUT_CONSTANTS.DEFAULT_GAP)
  })
})
