/**
 * @file transformCategory.test.ts
 * @description transformCategory 模块单元测试 —— 验证分类映射完整性与查找函数正确性
 */
import { describe, it, expect } from 'vitest'
import type { TransformTypeV2 } from '@/types/projectV2'
import {
  TRANSFORM_CATEGORIES,
  TRANSFORM_SEMANTICS,
  getCategoryForType,
  getCategoryIcon,
  getCategoryId,
  getSemanticForType,
  getTransformTypeIcon,
} from '@/composables/nodes/transform/transformCategory'

/** 全部 22 种 transformType，作为测试的基准集合 */
const ALL_TRANSFORM_TYPES: TransformTypeV2[] = [
  'StringSplit',
  'RegexExtract',
  'MathExpr',
  'DateFormat',
  'Lookup',
  'Strip',
  'UpperCase',
  'LowerCase',
  'Replace',
  'FilterRows',
  'FillNA',
  'DropDuplicates',
  'CastType',
  'Concat',
  'Substring',
  'Aggregate',
  'ConditionalAssign',
  'SortRows',
  'Digits',
  'WeightedSum',
  'Modulo',
  'MapValue',
]

/** 收集所有分类下的类型（去重前） */
function collectAllListedTypes(): TransformTypeV2[] {
  return TRANSFORM_CATEGORIES.flatMap((c) => c.types)
}

describe('transformCategory — 分类完整性', () => {
  it('5 个分类且 id/icon/labelKey 齐全', () => {
    expect(TRANSFORM_CATEGORIES).toHaveLength(5)
    for (const cat of TRANSFORM_CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.icon).toBeTruthy()
      expect(cat.labelKey).toBeTruthy()
      expect(cat.types.length).toBeGreaterThan(0)
    }
  })

  it('分类 id 唯一', () => {
    const ids = TRANSFORM_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个分类的 types 无重复', () => {
    for (const cat of TRANSFORM_CATEGORIES) {
      expect(new Set(cat.types).size).toBe(cat.types.length)
    }
  })

  it('覆盖全部 22 种 transformType，无遗漏', () => {
    const listed = collectAllListedTypes()
    for (const type of ALL_TRANSFORM_TYPES) {
      expect(listed).toContain(type)
    }
  })

  it('分类间无类型重叠', () => {
    const listed = collectAllListedTypes()
    expect(new Set(listed).size).toBe(listed.length)
  })
})

describe('transformCategory — 查找函数', () => {
  it('getCategoryForType 返回正确的分类', () => {
    expect(getCategoryForType('StringSplit')?.id).toBe('text')
    expect(getCategoryForType('MathExpr')?.id).toBe('numeric')
    expect(getCategoryForType('FilterRows')?.id).toBe('cleaning')
    expect(getCategoryForType('Aggregate')?.id).toBe('structure')
    expect(getCategoryForType('DateFormat')?.id).toBe('date')
  })

  it('getCategoryIcon 返回分类图标', () => {
    expect(getCategoryIcon('StringSplit')).toBe('transform-text')
    expect(getCategoryIcon('MathExpr')).toBe('transform-numeric')
    expect(getCategoryIcon('DateFormat')).toBe('transform-date')
  })

  it('getCategoryId 返回分类 id', () => {
    expect(getCategoryId('DropDuplicates')).toBe('cleaning')
    expect(getCategoryId('MapValue')).toBe('structure')
  })

  it('对全部 22 种类型，查找函数均返回有效值', () => {
    for (const type of ALL_TRANSFORM_TYPES) {
      expect(getCategoryForType(type)).toBeDefined()
      expect(getCategoryIcon(type)).toBeTruthy()
      expect(getCategoryId(type)).toBeTruthy()
    }
  })
})

describe('transformCategory — 语义映射完整性', () => {
  it('TRANSFORM_SEMANTICS 覆盖全部 22 种类型', () => {
    for (const type of ALL_TRANSFORM_TYPES) {
      expect(TRANSFORM_SEMANTICS[type]).toBeDefined()
    }
  })

  it('getSemanticForType 返回有效语义值', () => {
    const validSemantics = ['singleColumn', 'multiColumn', 'rowChanging', 'rowAtomic']
    for (const type of ALL_TRANSFORM_TYPES) {
      expect(validSemantics).toContain(getSemanticForType(type))
    }
  })

  it('已知的多列变换类型标记正确', () => {
    expect(getSemanticForType('StringSplit')).toBe('multiColumn')
    expect(getSemanticForType('RegexExtract')).toBe('multiColumn')
    // Concat 实际只输出单个拼接列，非多列（useTransformSave 走单列分支）
    expect(getSemanticForType('Concat')).toBe('singleColumn')
  })

  it('已知的行变化类型标记正确', () => {
    expect(getSemanticForType('FilterRows')).toBe('rowChanging')
    expect(getSemanticForType('DropDuplicates')).toBe('rowChanging')
    expect(getSemanticForType('SortRows')).toBe('rowChanging')
    expect(getSemanticForType('Aggregate')).toBe('rowChanging')
  })
})

describe('transformCategory — 类型图标', () => {
  it('getTransformTypeIcon 对全部 22 种类型返回 transform- 前缀图标名', () => {
    for (const type of ALL_TRANSFORM_TYPES) {
      const icon = getTransformTypeIcon(type)
      expect(icon).toBeTruthy()
      expect(icon.startsWith('transform-')).toBe(true)
    }
  })

  it('getTransformTypeIcon 返回类型专属图标（非分类图标）', () => {
    // StringSplit 属于 text 分类（transform-text），但应有专属图标
    expect(getTransformTypeIcon('StringSplit')).toBe('transform-stringSplit')
    expect(getTransformTypeIcon('StringSplit')).not.toBe('transform-text')
  })

  it('getTransformTypeIcon 对未知类型回退分类图标，再回退 gear', () => {
    // 未知类型走 getCategoryIcon 的回退链（最终 gear）
    expect(getTransformTypeIcon('NonExistent' as TransformTypeV2)).toBe('gear')
  })
})
