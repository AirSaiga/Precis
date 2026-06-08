import { describe, it, expect } from 'vitest'
import { TabularColumnGenerator } from '@/utils/nodes/columnGeneration/TabularColumnGenerator'
import { JsonColumnGenerator } from '@/utils/nodes/columnGeneration/JsonColumnGenerator'

describe('TabularColumnGenerator', () => {
  const generator = new TabularColumnGenerator()

  describe('generate', () => {
    it('空数据返回空数组', () => {
      expect(generator.generate([], [])).toEqual([])
      expect(generator.generate(null as any, [])).toEqual([])
      expect(generator.generate(undefined as any, [])).toEqual([])
    })

    it('从二维数组提取列定义', () => {
      const rawData = [
        ['Name', 'Age', 'Email'],
        ['Alice', '30', 'alice@example.com'],
      ]
      const cols = generator.generate(rawData, [])
      expect(cols).toHaveLength(3)
      expect((cols[0] as any).columnName).toBe('Name')
      expect((cols[0] as any).dataType).toBe('String')
      expect((cols[1] as any).columnName).toBe('Age')
      expect((cols[1] as any).dataType).toBe('Integer')
      expect((cols[2] as any).columnName).toBe('Email')
      expect((cols[2] as any).dataType).toBe('String')
    })

    it('从单行数组提取列定义', () => {
      const rawData = ['Col1', 'Col2']
      const cols = generator.generate(rawData, [])
      expect(cols).toHaveLength(2)
      expect((cols[0] as any).columnName).toBe('Col1')
    })

    it('保留现有列的约束和配置', () => {
      const rawData = [['Name', 'Age']]
      const existing = [
        { columnName: 'Name', dataType: 'String', constraints: { notNull: true }, validationErrors: [] },
      ]
      const cols = generator.generate(rawData, existing) as any[]
      expect(cols[0].constraints).toEqual({ notNull: true })
    })

    it('推断数据类型', () => {
      const rawData = [
        ['A', 'B', 'C', 'D', 'E'],
        ['1', '3.14', 'true', '2024-01-01', 'text'],
      ]
      const cols = generator.generate(rawData, []) as any[]
      expect(cols[0].dataType).toBe('Integer')
      expect(cols[1].dataType).toBe('Float')
      expect(cols[2].dataType).toBe('Boolean')
      expect(cols[3].dataType).toBe('Date')
      expect(cols[4].dataType).toBe('String')
    })

    it('保留衍生列', () => {
      const rawData = [['Name']]
      const existing = [
        { columnName: 'Derived', expressionType: 'implicit', dataType: 'String' },
        { columnName: 'BoundCol', isBound: true, dataType: 'String' },
        { columnName: 'Extracted', extractedConfig: {}, dataType: 'String' },
      ]
      const cols = generator.generate(rawData, existing) as any[]
      expect(cols).toHaveLength(4)
      const names = cols.map((c) => c.columnName)
      expect(names).toContain('Derived')
      expect(names).toContain('BoundCol')
      expect(names).toContain('Extracted')
    })

    it('空表头返回空数组', () => {
      const rawData = [[]]
      expect(generator.generate(rawData, [])).toEqual([])
    })
  })

  describe('compare', () => {
    it('空 schema 返回 needsAction', () => {
      const result = generator.compare(['A', 'B'], [])
      expect(result.schemaEmpty).toBe(true)
      expect(result.needsAction).toBe(true)
    })

    it('完全匹配', () => {
      const existing = [{ columnName: 'A' }, { columnName: 'B' }]
      const result = generator.compare(['A', 'B'], existing)
      expect(result.isMatch).toBe(true)
      expect(result.needsAction).toBe(false)
    })

    it('检测新增列', () => {
      const existing = [{ columnName: 'A' }]
      const result = generator.compare(['A', 'B'], existing)
      expect(result.newInSource).toEqual(['B'])
      expect(result.isMatch).toBe(false)
    })

    it('检测过期列（排除衍生列）', () => {
      const existing = [
        { columnName: 'A' },
        { columnName: 'Derived', expressionType: 'implicit' },
      ]
      const result = generator.compare(['A'], existing)
      expect(result.staleInSchema).toEqual([])
    })

    it('检测过期列', () => {
      const existing = [{ columnName: 'A' }, { columnName: 'B' }]
      const result = generator.compare(['A'], existing)
      expect(result.staleInSchema).toEqual(['B'])
    })
  })

  describe('extractSourceFields', () => {
    it('从预览数据提取表头', () => {
      const previewData = { data: [['A', 'B', 'C']] }
      const fields = generator.extractSourceFields(previewData)
      expect(fields).toEqual(['A', 'B', 'C'])
    })

    it('空数据返回 undefined', () => {
      expect(generator.extractSourceFields({})).toBeUndefined()
      expect(generator.extractSourceFields({ data: [] })).toBeUndefined()
    })
  })
})

describe('JsonColumnGenerator', () => {
  const generator = new JsonColumnGenerator()

  describe('generate', () => {
    it('空数据返回现有列或空数组', () => {
      expect(generator.generate([], [])).toEqual([])
      expect(generator.generate(null as any, [])).toEqual([])
      const existing = [{ columnName: 'A' }]
      expect(generator.generate([], existing)).toEqual(existing)
    })

    it('从对象数组生成列', () => {
      const rawData = [
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
      ]
      const cols = generator.generate(rawData, []) as any[]
      expect(cols).toHaveLength(3)
      expect(cols[0].columnName).toBe('name')
      expect(cols[0].dataType).toBe('string')
      expect(cols[1].columnName).toBe('age')
      expect(cols[1].dataType).toBe('number')
      expect(cols[2].columnName).toBe('active')
      expect(cols[2].dataType).toBe('boolean')
    })

    it('处理嵌套对象', () => {
      const rawData = [
        {
          user: { name: 'Alice', profile: { age: 30 } },
        },
      ]
      const cols = generator.generate(rawData, []) as any[]
      expect(cols).toHaveLength(1)
      expect(cols[0].columnName).toBe('user')
      expect(cols[0].dataType).toBe('object')
      expect(cols[0].children).toBeDefined()
      expect(cols[0].children!.length).toBeGreaterThan(0)
    })

    it('处理数组类型', () => {
      const rawData = [
        { tags: ['a', 'b', 'c'] },
        { tags: ['d'] },
      ]
      const cols = generator.generate(rawData, []) as any[]
      expect(cols[0].columnName).toBe('tags')
      expect(cols[0].dataType).toBe('array')
      expect(cols[0].arrayItemType).toBe('string')
    })

    it('处理对象数组', () => {
      const rawData = [
        { items: [{ name: 'a' }, { name: 'b' }] },
      ]
      const cols = generator.generate(rawData, []) as any[]
      const itemsCol = cols[0]
      expect(itemsCol.dataType).toBe('array')
      expect(itemsCol.arrayItemType).toBe('object')
      expect(itemsCol.children).toBeDefined()
      expect(itemsCol.children!.length).toBeGreaterThan(0)
    })

    it('合并现有列配置', () => {
      const rawData = [{ name: 'Alice' }]
      const existing = [
        {
          id: 'existing-id',
          columnName: 'name',
          jsonPath: '$.name',
          dataType: 'string' as const,
          nullable: false,
          primaryKey: true,
          description: 'User name',
          isExpanded: true,
          constraints: { notNull: true },
          validationErrors: [],
        },
      ]
      const cols = generator.generate(rawData, existing) as any[]
      expect(cols[0].id).toBe('existing-id')
      expect(cols[0].nullable).toBe(false)
      expect(cols[0].primaryKey).toBe(true)
      expect(cols[0].description).toBe('User name')
      expect(cols[0].constraints).toEqual({ notNull: true })
    })

    it('空对象返回现有列', () => {
      const existing = [{ columnName: 'A' }]
      expect(generator.generate([{}], existing)).toEqual(existing)
    })
  })

  describe('compare', () => {
    it('空 schema 返回 needsAction', () => {
      const result = generator.compare(['A'], [])
      expect(result.schemaEmpty).toBe(true)
    })

    it('完全匹配', () => {
      const existing = [{ columnName: 'A' }, { columnName: 'B' }]
      const result = generator.compare(['A', 'B'], existing)
      expect(result.isMatch).toBe(true)
    })

    it('检测差异', () => {
      const existing = [{ columnName: 'A' }]
      const result = generator.compare(['A', 'B'], existing)
      expect(result.newInSource).toEqual(['B'])
      expect(result.staleInSchema).toEqual([])
    })
  })

  describe('extractSourceFields', () => {
    it('从预览数据提取字段', () => {
      const previewData = { raw_data: [{ a: 1, b: 2 }] }
      const fields = generator.extractSourceFields(previewData)
      expect(fields).toEqual(['a', 'b'])
    })

    it('空数据返回 undefined', () => {
      expect(generator.extractSourceFields({})).toBeUndefined()
      expect(generator.extractSourceFields({ raw_data: [] })).toBeUndefined()
    })

    it('非对象返回 undefined', () => {
      expect(generator.extractSourceFields({ raw_data: [1, 2, 3] })).toBeUndefined()
    })
  })
})
