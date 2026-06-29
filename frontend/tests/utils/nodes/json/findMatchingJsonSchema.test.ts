import { describe, it, expect } from 'vitest'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import type { TableSchemaFileV2 } from '@/types/projectV2'

function makeSchema(overrides: Partial<TableSchemaFileV2> = {}): TableSchemaFileV2 {
  return {
    version: 2,
    id: 'users',
    name: 'users',
    columns: [],
    source: { path: 'data/users.json', type: 'file' },
    ...overrides,
  } as unknown as TableSchemaFileV2
}

describe('findMatchingJsonSchema', () => {
  // configDir='/proj',相对路径 'data/users.json' 解析为 '/proj/data/users.json'
  // localPath 须传解析后的绝对路径(与 tryLoadJsonSchemaConfig 的调用约定一致)
  const resolved = '/proj/data/users.json'

  it('path 精确匹配返回 schema', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, resolved, undefined, '/proj')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('users')
  })

  it('recordPath 匹配时区分不同 recordPath', () => {
    const schemas = {
      users: makeSchema({
        id: 'users',
        source: { path: 'data/users.json', type: 'file', options: { record_path: 'records' } },
      } as unknown as TableSchemaFileV2),
    }
    // recordPath 不匹配时应返回 null
    const result = findMatchingJsonSchema(schemas, resolved, 'items', '/proj')
    expect(result).toBeNull()
    // recordPath 匹配
    const matched = findMatchingJsonSchema(schemas, resolved, 'records', '/proj')
    expect(matched?.id).toBe('users')
  })

  it('无 recordPath 约束时只按 path 匹配', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, resolved, 'anything', '/proj')
    expect(result?.id).toBe('users')
  })

  it('路径不匹配返回 null', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, '/proj/data/other.json', undefined, '/proj')
    expect(result).toBeNull()
  })
})
