import { describe, it, expect } from 'vitest'
import { findMatchingSchema } from '@/utils/nodes/schema/findMatchingSchema'
import type { TableSchemaFileV2 } from '@/types/projectV2'

function makeSchema(overrides: Partial<TableSchemaFileV2> = {}): TableSchemaFileV2 {
  return {
    version: '2.0',
    id: 'schema-1',
    name: 'Test Schema',
    source: { path: 'data/users.csv' },
    columns: [],
    ...overrides,
  } as TableSchemaFileV2
}

describe('findMatchingSchema', () => {
  const configDir = '/project'

  it('精确匹配 CSV 路径', () => {
    const schemas = {
      s1: makeSchema({ source: { path: '/project/data/users.csv' } }),
    }
    const result = findMatchingSchema(schemas, '/project/data/users.csv', null, configDir)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('s1')
  })

  it('路径不匹配返回 null', () => {
    const schemas = {
      s1: makeSchema({ source: { path: '/project/data/users.csv' } }),
    }
    const result = findMatchingSchema(schemas, '/project/data/orders.csv', null, configDir)
    expect(result).toBeNull()
  })

  it('Excel 精确匹配路径 + sheet', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx', sheet: 'Sheet1' },
      }),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', 'Sheet1', configDir)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('s1')
  })

  it('Excel sheet 不匹配时精确匹配失败', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx', sheet: 'Sheet1' },
      }),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', 'Sheet2', configDir)
    // 精确匹配失败，但模糊匹配可能成功（schema 有 sheet 且传入 sheet 不为空）
    // 由于 schemaSheet='Sheet1' 且 sheetName='Sheet2'，模糊匹配也不接受
    expect(result).toBeNull()
  })

  it('Excel 模糊匹配：schema 未指定 sheet', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx' },
      }),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', 'AnySheet', configDir)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('s1')
  })

  it('Excel 模糊匹配：传入 sheetName 为空', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx', sheet: 'Sheet1' },
      }),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', null, configDir)
    expect(result).not.toBeNull()
  })

  it('sheet 匹配忽略大小写', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx', sheet: 'Sheet1' },
      }),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', 'sheet1', configDir)
    expect(result).not.toBeNull()
  })

  it('source.path 为空时跳过该 schema', () => {
    const schemas = {
      s1: makeSchema({ source: undefined }),
    }
    const result = findMatchingSchema(schemas, '/project/data/users.csv', null, configDir)
    expect(result).toBeNull()
  })

  it('空 schemas 返回 null', () => {
    const result = findMatchingSchema({}, '/project/data/users.csv', null, configDir)
    expect(result).toBeNull()
  })

  it('相对路径解析后匹配', () => {
    const schemas = {
      s1: makeSchema({ source: { path: 'data/users.csv' } }),
    }
    // resolveRelativePath('data/users.csv', '/project') → '/project/data/users.csv'
    const result = findMatchingSchema(schemas, '/project/data/users.csv', null, configDir)
    expect(result).not.toBeNull()
  })

  it('非 Excel 文件不需要 sheet 匹配', () => {
    const schemas = {
      s1: makeSchema({ source: { path: '/project/data/users.csv' } }),
    }
    const result = findMatchingSchema(schemas, '/project/data/users.csv', 'SomeSheet', configDir)
    expect(result).not.toBeNull()
  })

  it('使用 schema.sheet 作为回退（source.sheet 不存在时）', () => {
    const schemas = {
      s1: makeSchema({
        source: { path: '/project/data/report.xlsx' },
        sheet: 'Sheet1',
      } as Partial<TableSchemaFileV2>),
    }
    const result = findMatchingSchema(schemas, '/project/data/report.xlsx', 'Sheet1', configDir)
    expect(result).not.toBeNull()
  })
})
