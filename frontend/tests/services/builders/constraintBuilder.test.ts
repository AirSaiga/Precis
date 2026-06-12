import { describe, it, expect, vi } from 'vitest'
import type { CustomNode } from '@/types/graph'

vi.mock('@/services/constraints/validationRegistry', () => ({
  getV2ConstraintTypeByNodeType: (type: string | undefined) => {
    const map: Record<string, string> = {
      notNullConstraint: 'NotNull',
      uniqueConstraint: 'Unique',
      foreignKeyConstraint: 'ForeignKey',
      allowedValuesConstraint: 'AllowedValues',
      rangeConstraint: 'Range',
      conditionalConstraint: 'Conditional',
      scriptedConstraint: 'Scripted',
      charsetConstraint: 'Charset',
      dateLogicConstraint: 'DateLogic',
      compositeConstraint: 'Composite',
    }
    return map[type || ''] || ''
  },
  isConstraintNodeType: (type: string | undefined) => {
    if (!type) return false
    return [
      'notNullConstraint',
      'uniqueConstraint',
      'foreignKeyConstraint',
      'allowedValuesConstraint',
      'rangeConstraint',
      'conditionalConstraint',
      'scriptedConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
      'compositeConstraint',
    ].includes(type)
  },
}))

vi.mock('@/services/constraints/constraintExportAdapter', () => ({
  buildConstraintExportPayload: vi.fn(() => ({
    refs: { table_id: 'sc_users', column_id: 'col-email' },
    params: { mock_param: true },
  })),
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
}))

import {
  resolveSchemaAndColumnIdByName,
  buildV2ConstraintFile,
} from '@/services/builders/constraintBuilder'

function schemaNode(overrides: Record<string, unknown> = {}): CustomNode {
  return {
    id: 'schema-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      tableName: 'users',
      columns: [
        { id: 'col-id', columnName: 'id', dataType: 'Integer' },
        { id: 'col-name', columnName: 'name', dataType: 'String' },
      ],
      sourceFilePath: '/data/users.csv',
      sheetName: undefined,
      ...overrides,
    },
  } as unknown as CustomNode
}

function constraintNode(overrides: Record<string, unknown> = {}): CustomNode {
  const { id: overrideId, type: overrideType, ...dataOverrides } = overrides as any
  return {
    id: overrideId || 'constraint-1',
    type: overrideType || 'notNullConstraint',
    position: { x: 0, y: 0 },
    data: { configName: 'test-constraint', ...dataOverrides },
  } as unknown as CustomNode
}

describe('constraintBuilder - resolveSchemaAndColumnIdByName', () => {
  it('returns tableId and columnId when found', () => {
    const nodes: CustomNode[] = [schemaNode()]
    const result = resolveSchemaAndColumnIdByName(nodes, 'users', 'id')
    expect(result).not.toBeNull()
    expect(result!.tableId).toBeTruthy()
    expect(result!.columnId).toBe('col-id')
  })

  it('returns null when schema not found', () => {
    expect(resolveSchemaAndColumnIdByName([], 'users', 'id')).toBeNull()
  })

  it('returns null when column not found', () => {
    const nodes: CustomNode[] = [schemaNode()]
    expect(resolveSchemaAndColumnIdByName(nodes, 'users', 'nonexistent')).toBeNull()
  })
})

describe('constraintBuilder - buildV2ConstraintFile', () => {
  it('builds constraint file for valid constraint node', () => {
    const node = constraintNode({ id: 'c1', type: 'notNullConstraint', enabled: true })
    const nodes: CustomNode[] = [schemaNode(), node]
    const result = buildV2ConstraintFile('c1', nodes)
    expect(result.version).toBe(2)
    expect(result.id).toBe('c1')
    expect(result.type).toBe('NotNull')
    expect(result.enabled).toBe(true)
    expect(result.description).toBe('test-constraint')
    expect(result.refs).toEqual({ table_id: 'sc_users', column_id: 'col-email' })
    expect(result.params).toEqual({ mock_param: true })
  })

  it('throws when constraint node not found', () => {
    expect(() => buildV2ConstraintFile('nonexistent', [])).toThrow()
  })

  it('throws for non-constraint node type', () => {
    const nodes: CustomNode[] = [
      { id: 's1', type: 'schema', position: { x: 0, y: 0 }, data: {} } as any,
    ]
    expect(() => buildV2ConstraintFile('s1', nodes)).toThrow()
  })

  it('falls back to description when configName missing', () => {
    const node = constraintNode({ id: 'c2', type: 'notNullConstraint', configName: undefined })
    const nodes: CustomNode[] = [schemaNode(), node]
    const result = buildV2ConstraintFile('c2', nodes)
    expect(result.description).toBeUndefined()
  })

  it('defaults enabled to true', () => {
    const node = constraintNode({ id: 'c3', type: 'notNullConstraint', enabled: undefined })
    const nodes: CustomNode[] = [schemaNode(), node]
    const result = buildV2ConstraintFile('c3', nodes)
    expect(result.enabled).toBe(true)
  })

  it('honors enabled=false', () => {
    const node = constraintNode({ id: 'c4', type: 'notNullConstraint', enabled: false })
    const nodes: CustomNode[] = [schemaNode(), node]
    const result = buildV2ConstraintFile('c4', nodes)
    expect(result.enabled).toBe(false)
  })
})
