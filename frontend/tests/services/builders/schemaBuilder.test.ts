import { describe, it, expect } from 'vitest'
import {
  toBackendType,
  fromBackendType,
  toJsonBackendType,
  buildJSONOptions,
  flattenJsonColumns,
} from '@/services/builders/schemaBuilder'
import type { SchemaColumn, JsonSchemaColumn } from '@/types/graph'

describe('schemaBuilder - toBackendType', () => {
  it('maps String to Str', () => {
    expect(toBackendType('String')).toBe('Str')
  })

  it('maps Integer to Int', () => {
    expect(toBackendType('Integer')).toBe('Int')
  })

  it('maps Float to Float', () => {
    expect(toBackendType('Float')).toBe('Float')
  })

  it('maps Boolean to Boolean', () => {
    expect(toBackendType('Boolean')).toBe('Boolean')
  })

  it('maps Date to Date', () => {
    expect(toBackendType('Date')).toBe('Date')
  })

  it('maps Expression to Expr', () => {
    expect(toBackendType('Expression')).toBe('Expr')
  })

  it('maps unknown type to Str', () => {
    expect(toBackendType('Unknown' as any)).toBe('Str')
  })

  it('returns Expr config object when column has boundPattern', () => {
    const col: SchemaColumn = {
      id: 'col-1',
      columnName: 'email',
      dataType: 'String',
      boundPattern: '^\\S+@\\S+$',
      boundRegistry: 'my_registry',
    }
    const result = toBackendType('String', col)
    expect(result).toEqual({
      name: 'Expr',
      registry: 'my_registry',
      pattern: '^\\S+@\\S+$',
    })
  })

  it('uses default registry when boundRegistry not provided', () => {
    const col: SchemaColumn = {
      id: 'col-1',
      columnName: 'email',
      dataType: 'String',
      boundPattern: '^\\S+@\\S+$',
    }
    const result = toBackendType('String', col)
    expect(result).toEqual({
      name: 'Expr',
      registry: 'expression_registry',
      pattern: '^\\S+@\\S+$',
    })
  })

  it('returns Expr config regardless of dataType when boundPattern exists', () => {
    const col: SchemaColumn = {
      id: 'col-1',
      columnName: 'age',
      dataType: 'Integer',
      boundPattern: '^\\d+$',
    }
    const result = toBackendType('Integer', col)
    expect(result).toEqual({
      name: 'Expr',
      registry: 'expression_registry',
      pattern: '^\\d+$',
    })
  })
})

describe('schemaBuilder - fromBackendType', () => {
  it('maps Str to String', () => {
    expect(fromBackendType('Str')).toBe('String')
  })

  it('maps Int to Integer', () => {
    expect(fromBackendType('Int')).toBe('Integer')
  })

  it('maps Float to Float', () => {
    expect(fromBackendType('Float')).toBe('Float')
  })

  it('maps Boolean to Boolean', () => {
    expect(fromBackendType('Boolean')).toBe('Boolean')
  })

  it('maps Date to Date', () => {
    expect(fromBackendType('Date')).toBe('Date')
  })

  it('maps Expr to Expression', () => {
    expect(fromBackendType('Expr')).toBe('Expression')
  })

  it('maps CompositeExpr to Expression', () => {
    expect(fromBackendType('CompositeExpr')).toBe('Expression')
  })

  it('maps JsonObject to String', () => {
    expect(fromBackendType('JsonObject')).toBe('String')
  })

  it('maps JsonArray to String', () => {
    expect(fromBackendType('JsonArray')).toBe('String')
  })

  it('maps JsonNull to String', () => {
    expect(fromBackendType('JsonNull')).toBe('String')
  })

  it('maps unknown string to String', () => {
    expect(fromBackendType('UnknownType')).toBe('String')
  })

  it('maps non-string to String', () => {
    expect(fromBackendType(null)).toBe('String')
    expect(fromBackendType(undefined)).toBe('String')
    expect(fromBackendType({})).toBe('String')
    expect(fromBackendType(42)).toBe('String')
  })
})

describe('schemaBuilder - toJsonBackendType', () => {
  it('maps string to Str', () => {
    expect(toJsonBackendType('string')).toBe('Str')
  })

  it('maps number to Float', () => {
    expect(toJsonBackendType('number')).toBe('Float')
  })

  it('maps boolean to Boolean', () => {
    expect(toJsonBackendType('boolean')).toBe('Boolean')
  })

  it('maps object to JsonObject', () => {
    expect(toJsonBackendType('object')).toBe('JsonObject')
  })

  it('maps array to JsonArray', () => {
    expect(toJsonBackendType('array')).toBe('JsonArray')
  })

  it('maps null to JsonNull', () => {
    expect(toJsonBackendType('null')).toBe('JsonNull')
  })

  it('maps unknown type to Str', () => {
    expect(toJsonBackendType('unknown_type')).toBe('Str')
  })
})

describe('schemaBuilder - buildJSONOptions', () => {
  it('returns default options when data is empty', () => {
    const data = {} as any
    const result = buildJSONOptions(data)
    expect(result).toEqual({
      format: 'auto',
      sep: '.',
    })
  })

  it('includes format when provided', () => {
    const data = { format: 'csv' } as any
    const result = buildJSONOptions(data)
    expect(result!.format).toBe('csv')
  })

  it('includes json_path when provided', () => {
    const data = { jsonPath: '$.data.items' } as any
    const result = buildJSONOptions(data)
    expect(result!.json_path).toBe('$.data.items')
  })

  it('includes record_path when provided', () => {
    const data = { recordPath: 'records' } as any
    const result = buildJSONOptions(data)
    expect(result!.record_path).toBe('records')
  })

  it('includes all fields when fully specified', () => {
    const data = {
      format: 'jsonl',
      jsonPath: 'root',
      recordPath: 'items',
    } as any
    const result = buildJSONOptions(data)
    expect(result).toEqual({
      format: 'jsonl',
      json_path: 'root',
      record_path: 'items',
      sep: '.',
    })
  })
})

describe('schemaBuilder - flattenJsonColumns', () => {
  it('returns empty array for empty columns', () => {
    expect(flattenJsonColumns([])).toEqual([])
  })

  it('flattens simple columns without children', () => {
    const cols: JsonSchemaColumn[] = [
      { id: 'c1', columnName: 'name', dataType: 'string' },
      { id: 'c2', columnName: 'age', dataType: 'number' },
    ]
    const result = flattenJsonColumns(cols)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('name')
    expect(result[0].type).toBe('Str')
    expect(result[1].name).toBe('age')
    expect(result[1].type).toBe('Float')
  })

  it('handles duplicate names with _1, _2 suffix', () => {
    const cols: JsonSchemaColumn[] = [
      { id: 'c1', columnName: 'name', dataType: 'string' },
      { id: 'c2', columnName: 'name', dataType: 'string' },
    ]
    const result = flattenJsonColumns(cols)
    expect(result[0].name).toBe('name')
    expect(result[1].name).toBe('name_1')
  })

  it('recursively processes children columns', () => {
    const cols: JsonSchemaColumn[] = [
      {
        id: 'c1',
        columnName: 'address',
        dataType: 'object',
        children: [
          { id: 'c1a', columnName: 'street', dataType: 'string' },
          { id: 'c1b', columnName: 'city', dataType: 'string' },
        ],
      },
    ]
    const result = flattenJsonColumns(cols)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('address')
    expect(result[0].type).toBe('JsonObject')
    expect(result[0].children).toBeDefined()
    expect(result[0].children).toHaveLength(2)
    expect(result[0].children![0].name).toBe('street')
    expect(result[0].children![1].name).toBe('city')
  })

  it('maps boundPattern to Expr type config', () => {
    const cols: JsonSchemaColumn[] = [
      {
        id: 'c1',
        columnName: 'email',
        dataType: 'string',
        boundPattern: '^\\S+@\\S+$',
        boundRegistry: 'email_registry',
      },
    ]
    const result = flattenJsonColumns(cols)
    expect(result[0].type).toEqual({
      name: 'Expr',
      registry: 'email_registry',
      pattern: '^\\S+@\\S+$',
    })
  })

  it('includes primary_key, expand, json_path, nullable when set', () => {
    const cols: JsonSchemaColumn[] = [
      {
        id: 'c1',
        columnName: 'id',
        dataType: 'number',
        primaryKey: true,
        isExpanded: true,
        jsonPath: '$.id',
        nullable: false,
      },
    ]
    const result = flattenJsonColumns(cols)
    expect(result[0].primary_key).toBe(true)
    expect(result[0].expand).toBe(true)
    expect(result[0].json_path).toBe('$.id')
    expect(result[0].nullable).toBe(false)
  })

  it('handles nameSet dedup across recursive levels', () => {
    const cols: JsonSchemaColumn[] = [
      {
        id: 'c1',
        columnName: 'meta',
        dataType: 'object',
        children: [
          { id: 'c1a', columnName: 'name', dataType: 'string' },
        ],
      },
      { id: 'c2', columnName: 'name', dataType: 'string' },
    ]
    const result = flattenJsonColumns(cols)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('meta')
    expect(result[1].name).toBe('name_1')
  })
})
