import { describe, it, expect } from 'vitest'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'
import type { JsonSchemaColumn } from '@/types/nodes'

function makeJsonColumn(overrides: Partial<JsonSchemaColumn> = {}): JsonSchemaColumn {
  return {
    id: 'col-1',
    columnName: 'field',
    jsonPath: '$.field',
    dataType: 'string',
    nullable: true,
    isExpanded: false,
    constraints: {},
    validationErrors: [],
    ...overrides,
  } as JsonSchemaColumn
}

describe('generateJsonColumnsFromSource', () => {
  it('空数据返回现有列', () => {
    const existing = [makeJsonColumn()]
    expect(generateJsonColumnsFromSource([], existing)).toBe(existing)
    expect(generateJsonColumnsFromSource(null as unknown as unknown[], existing)).toBe(existing)
  })

  it('非数组数据返回现有列', () => {
    const existing = [makeJsonColumn()]
    expect(generateJsonColumnsFromSource('not array' as unknown as unknown[], existing)).toBe(
      existing
    )
  })

  it('从简单对象数组生成列', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]
    const result = generateJsonColumnsFromSource(data)
    expect(result.length).toBeGreaterThanOrEqual(2)

    const nameCol = result.find((c) => c.columnName === 'name')
    const ageCol = result.find((c) => c.columnName === 'age')
    expect(nameCol).toBeDefined()
    expect(ageCol).toBeDefined()
    expect(nameCol!.dataType).toBe('string')
    expect(ageCol!.dataType).toBe('number')
  })

  it('生成正确的 jsonPath', () => {
    const data = [{ name: 'Alice' }]
    const result = generateJsonColumnsFromSource(data)
    const nameCol = result.find((c) => c.columnName === 'name')
    expect(nameCol!.jsonPath).toBe('$.name')
  })

  it('嵌套对象生成子列', () => {
    const data = [{ address: { city: 'Beijing', zip: '100000' } }]
    const result = generateJsonColumnsFromSource(data)
    const addrCol = result.find((c) => c.columnName === 'address')
    expect(addrCol).toBeDefined()
    expect(addrCol!.dataType).toBe('object')
    expect(addrCol!.children).toBeDefined()
    expect(addrCol!.children!.length).toBeGreaterThanOrEqual(2)
  })

  it('数组类型列推断 arrayItemType', () => {
    const data = [{ tags: ['a', 'b', 'c'] }]
    const result = generateJsonColumnsFromSource(data)
    const tagsCol = result.find((c) => c.columnName === 'tags')
    expect(tagsCol).toBeDefined()
    expect(tagsCol!.dataType).toBe('array')
    expect(tagsCol!.arrayItemType).toBe('string')
  })

  it('对象数组生成嵌套子列', () => {
    const data = [{ items: [{ id: 1, name: 'item1' }] }]
    const result = generateJsonColumnsFromSource(data)
    const itemsCol = result.find((c) => c.columnName === 'items')
    expect(itemsCol!.dataType).toBe('array')
    expect(itemsCol!.arrayItemType).toBe('object')
    expect(itemsCol!.children).toBeDefined()
  })

  it('合并现有列：保留 ID 和约束', () => {
    const existing = [
      makeJsonColumn({
        id: 'uuid-123',
        columnName: 'name',
        jsonPath: '$.name',
        dataType: 'string',
        constraints: { notNull: true },
      }),
    ]
    const data = [{ name: 'Alice', age: 30 }]
    const result = generateJsonColumnsFromSource(data, existing)

    const nameCol = result.find((c) => c.columnName === 'name')
    expect(nameCol!.id).toBe('uuid-123')
    expect(nameCol!.constraints).toEqual({ notNull: true })
  })

  it('forceReinferTypes=false 保留现有类型', () => {
    const existing = [
      makeJsonColumn({
        id: 'uuid-1',
        columnName: 'age',
        jsonPath: '$.age',
        dataType: 'string',
      }),
    ]
    const data = [{ age: 30 }]
    const result = generateJsonColumnsFromSource(data, existing, { forceReinferTypes: false })
    const ageCol = result.find((c) => c.columnName === 'age')
    expect(ageCol!.dataType).toBe('string')
  })

  it('forceReinferTypes=true 重新推断类型', () => {
    const existing = [
      makeJsonColumn({
        id: 'uuid-1',
        columnName: 'age',
        jsonPath: '$.age',
        dataType: 'string',
      }),
    ]
    const data = [{ age: 30 }]
    const result = generateJsonColumnsFromSource(data, existing, { forceReinferTypes: true })
    const ageCol = result.find((c) => c.columnName === 'age')
    expect(ageCol!.dataType).toBe('number')
  })

  it('maxDepth 限制递归深度', () => {
    const data = [{ a: { b: { c: { d: 'deep' } } } }]
    const result = generateJsonColumnsFromSource(data, [], { maxDepth: 2 })
    const aCol = result.find((c) => c.columnName === 'a')
    expect(aCol).toBeDefined()
    // depth=1 时有 children，depth=2 时不再展开
    const bCol = aCol!.children?.find((c) => c.columnName === 'b')
    expect(bCol).toBeDefined()
    // b 在 depth=2，不应有 children（maxDepth=2 时 currentDepth < maxDepth 为 false）
    expect(bCol!.children).toBeUndefined()
  })

  it('所有记录为 null 时返回现有列', () => {
    const existing = [makeJsonColumn()]
    const result = generateJsonColumnsFromSource([null, null], existing)
    expect(result).toBe(existing)
  })

  it('新列默认 nullable=true', () => {
    const data = [{ name: 'Alice' }]
    const result = generateJsonColumnsFromSource(data)
    expect(result[0].nullable).toBe(true)
  })
})
