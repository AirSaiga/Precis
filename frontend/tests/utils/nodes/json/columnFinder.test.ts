import { describe, it, expect } from 'vitest'
import type { JsonSchemaColumn } from '@/types/graph'
import {
  findJsonSchemaColumnById,
  updateJsonSchemaColumnsRecursive,
  extractJsonTargetValues,
} from '@/utils/nodes/json/columnFinder'

function makeJsonColumn(overrides: Partial<JsonSchemaColumn> = {}): JsonSchemaColumn {
  return {
    id: 'col-id',
    columnName: 'column',
    dataType: 'string',
    ...overrides,
  } as JsonSchemaColumn
}

describe('findJsonSchemaColumnById', () => {
  it('空数组返回 null', () => {
    expect(findJsonSchemaColumnById([], 'col-1')).toBeNull()
  })

  it('undefined 返回 null', () => {
    expect(findJsonSchemaColumnById(undefined, 'col-1')).toBeNull()
  })

  it('在顶层找到列', () => {
    const columns = [makeJsonColumn({ id: 'col-1' }), makeJsonColumn({ id: 'col-2' })]
    const result = findJsonSchemaColumnById(columns, 'col-2')
    expect(result).not.toBeNull()
    expect(result?.column.id).toBe('col-2')
    expect(result?.index).toBe(1)
    expect(result?.parentArray).toBe(columns)
  })

  it('在嵌套子列中找到列', () => {
    const child = makeJsonColumn({ id: 'child-1' })
    const parent = makeJsonColumn({ id: 'parent-1', children: [child] })
    const columns = [parent]

    const result = findJsonSchemaColumnById(columns, 'child-1')
    expect(result).not.toBeNull()
    expect(result?.column.id).toBe('child-1')
    expect(result?.parentArray).toEqual([child])
  })

  it('未找到返回 null', () => {
    const columns = [makeJsonColumn({ id: 'col-1' })]
    expect(findJsonSchemaColumnById(columns, 'missing')).toBeNull()
  })

  it('跳过 undefined 列', () => {
    const columns = [undefined as unknown as JsonSchemaColumn, makeJsonColumn({ id: 'col-1' })]
    const result = findJsonSchemaColumnById(columns, 'col-1')
    expect(result?.column.id).toBe('col-1')
    expect(result?.index).toBe(1)
  })
})

describe('updateJsonSchemaColumnsRecursive', () => {
  it('对所有顶层列应用 updater', () => {
    const columns = [makeJsonColumn({ id: 'col-1', columnName: 'A' })]
    const result = updateJsonSchemaColumnsRecursive(columns, (col) => ({
      ...col,
      columnName: `${col.columnName}_updated`,
    }))
    expect(result[0].columnName).toBe('A_updated')
  })

  it('递归更新子列', () => {
    const child = makeJsonColumn({ id: 'child-1', columnName: 'Child' })
    const parent = makeJsonColumn({ id: 'parent-1', columnName: 'Parent', children: [child] })
    const columns = [parent]

    const result = updateJsonSchemaColumnsRecursive(columns, (col) => ({
      ...col,
      columnName: `${col.columnName}_updated`,
    }))

    expect(result[0].columnName).toBe('Parent_updated')
    expect(result[0].children?.[0].columnName).toBe('Child_updated')
  })

  it('空数组返回空数组', () => {
    expect(updateJsonSchemaColumnsRecursive([], (col) => col)).toEqual([])
  })
})

describe('extractJsonTargetValues', () => {
  it('空数组返回空数组', () => {
    expect(extractJsonTargetValues([], 'id')).toEqual([])
  })

  it('提取唯一非空值', () => {
    const data = [
      { id: 'a' },
      { id: 'b' },
      { id: 'a' },
      { id: null },
      { id: undefined },
      { id: '' },
    ]
    const result = extractJsonTargetValues(data as unknown[], 'id')
    expect(result.sort()).toEqual(['a', 'b'])
  })

  it('trim 后去重', () => {
    const data = [{ id: ' a ' }, { id: 'a' }]
    const result = extractJsonTargetValues(data as unknown[], 'id')
    expect(result).toEqual(['a'])
  })

  it('非对象记录被忽略', () => {
    const data = [{ id: 'a' }, 'invalid', 123, null]
    const result = extractJsonTargetValues(data as unknown[], 'id')
    expect(result).toEqual(['a'])
  })

  it('超过 50000 条时提前终止', () => {
    const data = Array.from({ length: 50010 }, (_, i) => ({ id: String(i) }))
    const result = extractJsonTargetValues(data, 'id')
    expect(result.length).toBe(50001)
  })
})
