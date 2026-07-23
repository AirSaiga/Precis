import { describe, it, expect } from 'vitest'
import {
  findJsonSchemaColumnById,
  updateJsonSchemaColumnsRecursive,
  extractJsonTargetValues,
  getJsonValueByPath,
  extractJsonValuesByPath,
} from '@/utils/nodes/json/columnFinder'
import type { JsonSchemaColumn } from '@/types/graph'

function makeCol(overrides: Partial<JsonSchemaColumn> = {}): JsonSchemaColumn {
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

describe('findJsonSchemaColumnById', () => {
  it('undefined columns 返回 null', () => {
    expect(findJsonSchemaColumnById(undefined, 'col-1')).toBeNull()
  })

  it('空数组返回 null', () => {
    expect(findJsonSchemaColumnById([], 'col-1')).toBeNull()
  })

  it('在顶层找到列', () => {
    const cols = [makeCol({ id: 'col-1' }), makeCol({ id: 'col-2' })]
    const result = findJsonSchemaColumnById(cols, 'col-2')
    expect(result).not.toBeNull()
    expect(result!.column.id).toBe('col-2')
    expect(result!.index).toBe(1)
    expect(result!.parentArray).toBe(cols)
  })

  it('在嵌套 children 中找到列', () => {
    const child = makeCol({ id: 'child-1' })
    const parent = makeCol({ id: 'parent-1', children: [child] })
    const result = findJsonSchemaColumnById([parent], 'child-1')
    expect(result).not.toBeNull()
    expect(result!.column.id).toBe('child-1')
    expect(result!.parentArray).toEqual([child])
  })

  it('未找到返回 null', () => {
    const cols = [makeCol({ id: 'col-1' })]
    expect(findJsonSchemaColumnById(cols, 'nonexistent')).toBeNull()
  })

  it('跳过 null 列', () => {
    const cols = [null as unknown as JsonSchemaColumn, makeCol({ id: 'col-2' })]
    const result = findJsonSchemaColumnById(cols, 'col-2')
    expect(result).not.toBeNull()
    expect(result!.index).toBe(1)
  })
})

describe('updateJsonSchemaColumnsRecursive', () => {
  it('更新所有列', () => {
    const cols = [makeCol({ id: '1', columnName: 'a' }), makeCol({ id: '2', columnName: 'b' })]
    const result = updateJsonSchemaColumnsRecursive(cols, (col) => ({
      ...col,
      columnName: col.columnName.toUpperCase(),
    }))
    expect(result[0].columnName).toBe('A')
    expect(result[1].columnName).toBe('B')
  })

  it('递归更新嵌套 children', () => {
    const child = makeCol({ id: 'child', columnName: 'x' })
    const parent = makeCol({ id: 'parent', columnName: 'p', children: [child] })
    const result = updateJsonSchemaColumnsRecursive([parent], (col) => ({
      ...col,
      columnName: col.columnName.toUpperCase(),
    }))
    expect(result[0].columnName).toBe('P')
    expect(result[0].children![0].columnName).toBe('X')
  })

  it('不修改原数组', () => {
    const cols = [makeCol({ columnName: 'original' })]
    const result = updateJsonSchemaColumnsRecursive(cols, (col) => ({
      ...col,
      columnName: 'modified',
    }))
    expect(cols[0].columnName).toBe('original')
    expect(result[0].columnName).toBe('modified')
  })

  it('空 children 不递归', () => {
    const col = makeCol({ children: [] })
    const result = updateJsonSchemaColumnsRecursive([col], (c) => c)
    expect(result[0].children).toEqual([])
  })
})

describe('extractJsonTargetValues', () => {
  it('空数组返回空', () => {
    expect(extractJsonTargetValues([], 'id')).toEqual([])
    expect(extractJsonTargetValues(null as unknown as unknown[], 'id')).toEqual([])
  })

  it('提取非空唯一值', () => {
    const data = [{ id: '1' }, { id: '2' }, { id: '1' }, { id: null }]
    const result = extractJsonTargetValues(data, 'id')
    expect(result).toContain('1')
    expect(result).toContain('2')
    expect(result).toHaveLength(2)
  })

  it('跳过非对象记录', () => {
    const data = [null, 'string', 42, { id: 'valid' }]
    const result = extractJsonTargetValues(data, 'id')
    expect(result).toEqual(['valid'])
  })

  it('trim 处理', () => {
    const data = [{ id: '  value  ' }]
    const result = extractJsonTargetValues(data, 'id')
    expect(result).toEqual(['value'])
  })

  it('数字值转为字符串', () => {
    const data = [{ id: 123 }]
    const result = extractJsonTargetValues(data, 'id')
    expect(result).toEqual(['123'])
  })
})

describe('getJsonValueByPath', () => {
  it('空路径返回 undefined', () => {
    expect(getJsonValueByPath({ a: 1 }, '')).toBeUndefined()
  })

  it('简单路径取值', () => {
    expect(getJsonValueByPath({ name: 'Alice' }, '$.name')).toBe('Alice')
    expect(getJsonValueByPath({ name: 'Alice' }, 'name')).toBe('Alice')
  })

  it('嵌套路径取值', () => {
    const obj = { address: { city: 'Beijing' } }
    expect(getJsonValueByPath(obj, '$.address.city')).toBe('Beijing')
  })

  it('数组下标取值', () => {
    const obj = { items: ['a', 'b', 'c'] }
    expect(getJsonValueByPath(obj, '$.items[1]')).toBe('b')
  })

  it('路径不存在返回 undefined', () => {
    expect(getJsonValueByPath({ a: 1 }, '$.b')).toBeUndefined()
  })

  it('中间节点为 null 返回 undefined', () => {
    expect(getJsonValueByPath({ a: null }, '$.a.b')).toBeUndefined()
  })

  it('数组下标越界返回 undefined', () => {
    const obj = { items: ['a'] }
    expect(getJsonValueByPath(obj, '$.items[5]')).toBeUndefined()
  })

  it('非数组使用下标返回 undefined', () => {
    const obj = { items: 'not array' }
    expect(getJsonValueByPath(obj, '$.items[0]')).toBeUndefined()
  })
})

describe('extractJsonValuesByPath', () => {
  it('空数组返回空', () => {
    expect(extractJsonValuesByPath([], { targetKey: 'id' })).toEqual([])
  })

  it('使用 jsonPath 提取值', () => {
    const data = [{ name: 'Alice' }, { name: 'Bob' }]
    const result = extractJsonValuesByPath(data, { jsonPath: '$.name' })
    expect(result).toEqual(['Alice', 'Bob'])
  })

  it('jsonPath 失败时回退到 targetKey', () => {
    const data = [{ name: 'Alice' }]
    const result = extractJsonValuesByPath(data, { jsonPath: '$.missing', targetKey: 'name' })
    expect(result).toEqual(['Alice'])
  })

  it('非对象记录返回空字符串', () => {
    const data = [null, 'string', { name: 'Alice' }]
    const result = extractJsonValuesByPath(data, { targetKey: 'name' })
    expect(result).toEqual(['', '', 'Alice'])
  })

  it('null 值返回空字符串', () => {
    const data = [{ name: null }]
    const result = extractJsonValuesByPath(data, { targetKey: 'name' })
    expect(result).toEqual([''])
  })

  it('数字值转为字符串', () => {
    const data = [{ age: 30 }]
    const result = extractJsonValuesByPath(data, { targetKey: 'age' })
    expect(result).toEqual(['30'])
  })
})
