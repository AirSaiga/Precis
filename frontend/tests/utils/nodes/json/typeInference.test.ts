import { describe, it, expect } from 'vitest'
import {
  inferDataType,
  inferColumnType,
  inferObjectStructure,
  inferArrayItemType,
  isValueOfType,
  getTypeDisplayName,
  getTypeColor,
} from '@/utils/nodes/json/typeInference'

describe('inferDataType', () => {
  it('null 和 undefined 推断为 null', () => {
    expect(inferDataType(null)).toBe('null')
    expect(inferDataType(undefined)).toBe('null')
  })

  it('数组推断为 array', () => {
    expect(inferDataType([])).toBe('array')
    expect(inferDataType([1, 2])).toBe('array')
  })

  it('基本类型推断正确', () => {
    expect(inferDataType('text')).toBe('string')
    expect(inferDataType(42)).toBe('number')
    expect(inferDataType(true)).toBe('boolean')
    expect(inferDataType({})).toBe('object')
  })

  it('未知类型回退为 string', () => {
    expect(inferDataType(BigInt(1))).toBe('string')
    expect(inferDataType(Symbol('x'))).toBe('string')
  })
})

describe('inferColumnType', () => {
  it('空数组默认 string', () => {
    expect(inferColumnType([])).toBe('string')
  })

  it('选择出现次数最多的类型', () => {
    expect(inferColumnType(['a', 'b', 1])).toBe('string')
    expect(inferColumnType([1, 2, 'a'])).toBe('number')
    expect(inferColumnType([true, false, 'x'])).toBe('boolean')
  })

  it('并列时按遍历顺序取第一个最大值', () => {
    expect(inferColumnType(['a', 1])).toBe('string')
  })
})

describe('inferObjectStructure', () => {
  it('非对象返回空结构', () => {
    expect(inferObjectStructure(null)).toEqual({})
    expect(inferObjectStructure(undefined)).toEqual({})
    expect(inferObjectStructure('text')).toEqual({})
    expect(inferObjectStructure([])).toEqual({})
  })

  it('提取对象字段类型', () => {
    const structure = inferObjectStructure({
      name: 'Alice',
      age: 30,
      active: true,
      tags: [],
      meta: {},
    })
    expect(structure).toEqual({
      name: 'string',
      age: 'number',
      active: 'boolean',
      tags: 'array',
      meta: 'object',
    })
  })
})

describe('inferArrayItemType', () => {
  it('空数组返回 null', () => {
    expect(inferArrayItemType([])).toBe('null')
  })

  it('单一类型', () => {
    expect(inferArrayItemType([1, 2, 3])).toBe('number')
    expect(inferArrayItemType(['a', 'b'])).toBe('string')
  })

  it('过滤 null 后推断', () => {
    expect(inferArrayItemType([null, 1, null])).toBe('number')
  })

  it('混合类型优先级 object > array > 首个', () => {
    expect(inferArrayItemType([{}, 'a'])).toBe('object')
    expect(inferArrayItemType([[], 'a'])).toBe('array')
    expect(inferArrayItemType(['a', 1])).toBe('string')
  })
})

describe('isValueOfType', () => {
  it('判断值是否符合预期类型', () => {
    expect(isValueOfType('text', 'string')).toBe(true)
    expect(isValueOfType(42, 'number')).toBe(true)
    expect(isValueOfType('text', 'number')).toBe(false)
  })
})

describe('getTypeDisplayName', () => {
  it('返回类型的显示名称', () => {
    expect(getTypeDisplayName('string')).toBe('String')
    expect(getTypeDisplayName('number')).toBe('Number')
    expect(getTypeDisplayName('unknown' as any)).toBe('unknown')
  })
})

describe('getTypeColor', () => {
  it('返回类型的颜色代码', () => {
    expect(getTypeColor('string')).toBe('#4caf50')
    expect(getTypeColor('number')).toBe('#2196f3')
    expect(getTypeColor('unknown' as any)).toBe('#9e9e9e')
  })
})
