import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode } from '@/types/graph'

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (_key: string) => _key,
    },
  },
}))

const mockRegistry = vi.hoisted(() => {
  const CONSTRAINT_NODE_TYPES = [
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
  ]
  const NODE_TYPE_TO_V2_TYPE: Record<string, string> = {
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
  return {
    getV2ConstraintTypeByNodeType: (nodeType: string | undefined) =>
      NODE_TYPE_TO_V2_TYPE[nodeType || ''] || '',
    isConstraintNodeType: (type: string | undefined) => CONSTRAINT_NODE_TYPES.includes(type || ''),
  }
})

vi.mock('@/services/constraints/validationRegistry', () => mockRegistry)

vi.mock('@/services/constraints/constraintExportAdapter', () => ({
  buildConstraintExportPayload: () => ({
    refs: { table_id: 'sc_users', column_id: 'col-email' },
    params: {},
  }),
}))

import { buildV2SchemaFile, buildV2JsonSchemaFile } from '@/services/builders/v2/schemaBuilder'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

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
        { id: 'col-age', columnName: 'age', dataType: 'Integer' },
      ],
      sourceFilePath: '/data/users.csv',
      sheetName: undefined,
      sourcePathMode: 'relative_file',
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
    data: {
      column: 'col-id',
      configName: 'id not null',
      ...dataOverrides,
    },
  } as unknown as CustomNode
}

function childrenIds(ids: string[]): Record<string, unknown> {
  return { children: ids } as unknown as Record<string, unknown>
}

describe('v2/schemaBuilder - buildV2SchemaFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds basic schema file structure', () => {
    const nodes: CustomNode[] = [schemaNode()]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.version).toBe(2)
    expect(result.name).toBe('users')
    expect(result.columns).toHaveLength(3)
    expect(result.columns[0].id).toBe('col-id')
    expect(result.columns[0].name).toBe('id')
    expect(result.columns[0].type).toBe('Int')
    expect(result.columns[1].name).toBe('name')
    expect(result.columns[1].type).toBe('Str')
    expect(result.columns[2].name).toBe('age')
    expect(result.columns[2].type).toBe('Int')
  })

  it('includes source config with relative_file mode', () => {
    const nodes: CustomNode[] = [schemaNode({ sourcePathMode: 'relative_file' })]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.source).toBeDefined()
    expect(result.source!.mode).toBe('relative_file')
    expect(result.source!.path).toBe('/data/users.csv')
  })

  it('includes source config with absolute_file mode', () => {
    const nodes: CustomNode[] = [
      schemaNode({
        sourcePathMode: 'absolute_file',
        localPath: '/abs/path/data.csv',
        sourceFilePath: '/data/users.csv',
      }),
    ]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.source).toBeDefined()
    expect(result.source!.mode).toBe('absolute_file')
    expect(result.source!.path).toBe('/abs/path/data.csv')
  })

  it('includes source config with legacy localfile mode', () => {
    const nodes: CustomNode[] = [
      schemaNode({
        sourcePathMode: undefined,
        sourceMode: 'localfile',
        sourceFilePath: undefined,
        localPath: '/legacy/path/data.csv',
      }),
    ]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.source).toBeDefined()
    expect(result.source!.mode).toBe('absolute_file')
    expect(result.source!.path).toBe('/legacy/path/data.csv')
  })

  it('falls back to relative when no sourcePathMode set but sourceFilePath exists', () => {
    const nodes: CustomNode[] = [
      schemaNode({
        sourcePathMode: undefined,
        sourceMode: undefined,
      }),
    ]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.source).toBeDefined()
    expect(result.source!.mode).toBe('relative_file')
    expect(result.source!.path).toBe('/data/users.csv')
  })

  it('has no source when no file path available', () => {
    const nodes: CustomNode[] = [schemaNode({ sourceFilePath: undefined, localPath: undefined })]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.source).toBeUndefined()
  })

  it('uses node ID as schema ID', () => {
    const nodes: CustomNode[] = [schemaNode()]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    // 语义化 ID 方案：节点 ID 直接作为 schema ID
    expect(result.id).toBe('schema-1')
  })

  it('throws when node not found', () => {
    expect(() => buildV2SchemaFile([], 'nonexistent')).toThrow()
  })

  it('includes column-level constraints (notNull, unique, allowedValues)', () => {
    const node = schemaNode({
      columns: [
        {
          id: 'col-email',
          columnName: 'email',
          dataType: 'String',
          constraints: {
            notNull: true,
            unique: true,
            allowedValues: ['a@b.com', 'c@d.com'],
          },
        },
      ],
    })
    const result = buildV2SchemaFile([node], 'schema-1')
    expect(result.constraints).toBeDefined()
    const colConstraints = result.constraints!.filter((c: any) =>
      ['_notNull', '_unique', '_allowedValues'].some((s) => c.id.includes(s))
    )
    expect(colConstraints).toHaveLength(3)
    const notNull = colConstraints.find((c: any) => c.type === 'NotNull')
    expect(notNull).toBeDefined()
    expect(notNull!.column).toBe('email')
    const unique = colConstraints.find((c: any) => c.type === 'Unique')
    expect(unique).toBeDefined()
    const allowedValues = colConstraints.find((c: any) => c.type === 'AllowedValues')
    expect(allowedValues).toBeDefined()
    expect(allowedValues!.params!.allowed_values).toEqual(['a@b.com', 'c@d.com'])
  })

  it('skips column-level constraints when none set', () => {
    const node = schemaNode({
      columns: [{ id: 'col-1', columnName: 'col', dataType: 'String', constraints: undefined }],
    })
    const result = buildV2SchemaFile([node], 'schema-1')
    const columnConstraintIds = result.constraints!.filter((c: any) => !(c as any).from_table)
    expect(columnConstraintIds).toHaveLength(0)
  })

  it('collects embedded constraints from children IDs', () => {
    const child = constraintNode({ id: 'child-1', type: 'notNullConstraint', embedded: true })
    const node = schemaNode(childrenIds(['child-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    expect(result.constraints).toBeDefined()
    expect(result.constraints!.length).toBeGreaterThanOrEqual(1)
    expect(result.constraints![0].id).toBe('child-1')
  })

  it('collects embedded constraints using legacy method (sourceRef)', () => {
    const child = constraintNode({
      id: 'legacy-1',
      type: 'uniqueConstraint',
      embedded: true,
      sourceRef: { nodeId: 'schema-1', columnId: 'col-1', columnName: 'name' },
    })
    const node = schemaNode({})
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const legacy = result.constraints!.find((c: any) => c.id === 'legacy-1')
    expect(legacy).toBeDefined()
    expect(legacy!.type).toBe('Unique')
  })

  it('deduplicates embedded constraints from children and legacy', () => {
    const child = constraintNode({ id: 'dup-1', type: 'notNullConstraint' })
    const dupLegacy = constraintNode({
      id: 'dup-1',
      type: 'notNullConstraint',
      embedded: true,
      sourceRef: { nodeId: 'schema-1', columnId: 'col-1', columnName: 'name' },
    })
    const node = schemaNode(childrenIds(['dup-1']))
    const nodes: CustomNode[] = [node, child, dupLegacy]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const dups = result.constraints!.filter((c: any) => c.id === 'dup-1')
    expect(dups).toHaveLength(1)
  })

  it('handles AllowedValues embedded constraint', () => {
    const child = constraintNode({
      id: 'av-1',
      type: 'allowedValuesConstraint',
      column: 'col-id',
      allowedValues: ['a', 'b', 'c'],
    })
    const node = schemaNode(childrenIds(['av-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const av = result.constraints!.find((c: any) => c.id === 'av-1')
    expect(av).toBeDefined()
    expect(av!.type).toBe('AllowedValues')
    expect((av as any).params.allowed_values).toEqual(['a', 'b', 'c'])
  })

  it('handles ForeignKey embedded constraint', () => {
    const child = constraintNode({
      id: 'fk-1',
      type: 'foreignKeyConstraint',
      sourceTable: 'users',
      sourceColumn: 'id',
      targetTable: 'orders',
      targetColumn: 'user_id',
    })
    const node = schemaNode(childrenIds(['fk-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const fk = result.constraints!.find((c: any) => c.id === 'fk-1')
    expect(fk).toBeDefined()
    expect(fk!.type).toBe('ForeignKey')
    expect((fk as any).from_table).toBe('users')
    expect((fk as any).to_table).toBe('orders')
  })

  it('handles Scripted embedded constraint', () => {
    const child = constraintNode({
      id: 'sc-1',
      type: 'scriptedConstraint',
      column: 'col-age',
      script: 'age > 0',
      constraintName: 'age_positive',
    })
    const node = schemaNode(childrenIds(['sc-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const sc = result.constraints!.find((c: any) => c.id === 'sc-1')
    expect(sc).toBeDefined()
    expect(sc!.type).toBe('Scripted')
    expect((sc as any).params.expression).toBe('age > 0')
    expect((sc as any).params.name).toBe('age_positive')
  })

  it('handles Range embedded constraint', () => {
    const child = constraintNode({
      id: 'rg-1',
      type: 'rangeConstraint',
      column: 'col-age',
      minValue: 0,
      maxValue: 150,
      boundaryMode: 'inclusive',
    })
    const node = schemaNode(childrenIds(['rg-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const rg = result.constraints!.find((c: any) => c.id === 'rg-1')
    expect(rg).toBeDefined()
    expect(rg!.type).toBe('Range')
    expect((rg as any).params.min).toBe(0)
    expect((rg as any).params.max).toBe(150)
    expect((rg as any).params.boundary_mode).toBe('inclusive')
  })

  it('handles Charset embedded constraint', () => {
    const child = constraintNode({
      id: 'ch-1',
      type: 'charsetConstraint',
      column: 'col-name',
      charsetMode: 'ascii',
      allowedChars: 'a-zA-Z',
    })
    const node = schemaNode(childrenIds(['ch-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const ch = result.constraints!.find((c: any) => c.id === 'ch-1')
    expect(ch).toBeDefined()
    expect(ch!.type).toBe('Charset')
    expect((ch as any).params.charset_mode).toBe('ascii')
    expect((ch as any).params.allowed_chars).toBe('a-zA-Z')
  })

  it('handles DateLogic embedded constraint (compare mode)', () => {
    const child = constraintNode({
      id: 'dl-1',
      type: 'dateLogicConstraint',
      column: 'col-date',
      logicMode: 'compare',
      compareOp: 'gt',
      referenceDate: '2024-01-01',
    })
    const node = schemaNode(childrenIds(['dl-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const dl = result.constraints!.find((c: any) => c.id === 'dl-1')
    expect(dl).toBeDefined()
    expect(dl!.type).toBe('DateLogic')
    expect((dl as any).params.logic_mode).toBe('compare')
    expect((dl as any).params.compare_op).toBe('gt')
    expect((dl as any).params.reference_date).toBe('2024-01-01')
  })

  it('handles DateLogic embedded constraint (calculation mode)', () => {
    const child = constraintNode({
      id: 'dl-2',
      type: 'dateLogicConstraint',
      column: 'col-date',
      logicMode: 'calculation',
      calculationType: 'age',
      targetValue: '18',
    })
    const node = schemaNode(childrenIds(['dl-2']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const dl = result.constraints!.find((c: any) => c.id === 'dl-2')
    expect(dl).toBeDefined()
    expect(dl!.type).toBe('DateLogic')
    expect((dl as any).params.logic_mode).toBe('calculation')
    expect((dl as any).params.calculation_type).toBe('age')
    expect((dl as any).params.target_value).toBe('18')
  })

  it('handles Composite embedded constraint with warning', () => {
    const child = constraintNode({
      id: 'cp-1',
      type: 'compositeConstraint',
      logic: 'all',
    })
    const node = schemaNode(childrenIds(['cp-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const cp = result.constraints!.find((c: any) => c.id === 'cp-1')
    expect(cp).toBeDefined()
    expect(cp!.type).toBe('Composite')
    expect((cp as any).params.logic).toBe('all')
  })

  it('handles Conditional embedded constraint', () => {
    const child = constraintNode({
      id: 'cd-1',
      type: 'conditionalConstraint',
      thenColumn: 'col-status',
      thenConditionConfig: { operator: 'equals', value: 'active' },
      ifLogic: 'all',
      ifConditions: [
        { operator: 'eq', column: 'col-age', value: '18', ref: { columnId: 'col-age' } },
      ],
      thenRef: { nodeId: 'schema-1', columnId: 'col-status' },
    })
    const node = schemaNode(childrenIds(['cd-1']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const cd = result.constraints!.find((c: any) => c.id === 'cd-1')
    expect(cd).toBeDefined()
    expect(cd!.type).toBe('Conditional')
    expect((cd as any).params.then_condition).toEqual({ operator: 'equals', value: 'active' })
    expect((cd as any).params.if_conditions).toBeDefined()
    expect((cd as any).params.if_conditions[0].if_column_id).toBe('col-age')
  })

  it('handles conditional with missing thenRef fields', () => {
    const child = constraintNode({
      id: 'cd-2',
      type: 'conditionalConstraint',
      thenColumn: 'col-status',
      ifRef: { nodeId: 'schema-1' },
      thenRef: undefined,
      ifLogic: 'all',
      ifConditions: [
        { operator: 'eq', column: 'col-name', value: 'test', ref: { columnId: 'col-name' } },
      ],
    })
    const node = schemaNode(childrenIds(['cd-2']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const cd = result.constraints!.find((c: any) => c.id === 'cd-2')
    expect(cd).toBeDefined()
  })

  it('filters out invalid if conditions', () => {
    const child = constraintNode({
      id: 'cd-3',
      type: 'conditionalConstraint',
      thenColumn: 'col-1',
      thenRef: { nodeId: 'schema-1', columnId: 'col-1' },
      ifConditions: [
        { operator: '', column: 'col-age', ref: { columnId: 'col-age' } },
        { operator: 'eq', column: 'col-name', ref: { columnId: 'col-name' } },
      ],
    })
    const node = schemaNode(childrenIds(['cd-3']))
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const cd = result.constraints!.find((c: any) => c.id === 'cd-3')
    const conditions = (cd as any)?.params?.if_conditions || []
    expect(conditions).toHaveLength(1)
    expect(conditions[0].if_column_id).toBe('col-name')
  })

  it('handles extractedConfig on column', () => {
    const node = schemaNode({
      columns: [
        {
          id: 'col-ext',
          columnName: 'extracted',
          dataType: 'String',
          extractedConfig: {
            sourceColumn: 'raw',
            extractKey: 'email',
            resultType: 'String',
          },
        },
      ],
    })
    const result = buildV2SchemaFile([node], 'schema-1')
    const col = result.columns[0]
    expect((col as any).type).toEqual({
      name: 'Extracted',
      source_column: 'raw',
      extract_key: 'email',
      result_type: 'String',
    })
  })

  it('returns unknown v2Type as null from buildConstraintItemFromNode', () => {
    const unknownChild = constraintNode({ id: 'unknown', type: 'unknownConstraint' })
    const node = schemaNode({ children: ['unknown'] as any })
    const nodes: CustomNode[] = [node as CustomNode, unknownChild as CustomNode]
    const result = buildV2SchemaFile(nodes, 'schema-1')
    const found = result.constraints!.find((c: any) => c.id === 'unknown')
    expect(found).toBeUndefined()
  })
})

describe('v2/schemaBuilder - buildV2JsonSchemaFile', () => {
  function jsonSchemaNode(overrides: Record<string, unknown> = {}): CustomNode {
    return {
      id: 'json-schema-1',
      type: 'jsonSchema',
      position: { x: 0, y: 0 },
      data: {
        tableName: 'json_users',
        columns: [
          { id: 'c-id', columnName: 'id', dataType: 'number' },
          { id: 'c-name', columnName: 'name', dataType: 'string' },
        ],
        sourceFilePath: '/data/users.json',
        sourcePathMode: 'relative_file',
        format: 'json',
        ...overrides,
      },
    } as unknown as CustomNode
  }

  it('builds basic JSON schema file', () => {
    const result = buildV2JsonSchemaFile(jsonSchemaNode(), [])
    expect(result.version).toBe(2)
    expect(result.name).toBe('json_users')
    expect(result.columns).toHaveLength(2)
    expect(result.columns[0].type).toBe('Float')
    expect(result.columns[1].type).toBe('Str')
  })

  it('includes jsonOptions in source config', () => {
    const result = buildV2JsonSchemaFile(jsonSchemaNode(), [])
    expect(result.source).toBeDefined()
    expect(result.source!.options).toBeDefined()
    expect(result.source!.options!.format).toBe('json')
  })

  it('uses node ID as schema ID', () => {
    const result = buildV2JsonSchemaFile(jsonSchemaNode(), [])
    // 语义化 ID 方案：节点 ID 直接作为 schema ID
    expect(result.id).toBe('json-schema-1')
  })

  it('collects embedded constraints via children for JSON schema', () => {
    const child = constraintNode({
      id: 'legacy-json',
      type: 'notNullConstraint',
    })
    const node = jsonSchemaNode({ children: ['legacy-json'] })
    const result = buildV2JsonSchemaFile(node, [child])
    expect(result.constraints!.length).toBeGreaterThan(0)
    const found = result.constraints!.find((c: any) => c.id === 'legacy-json')
    expect(found).toBeDefined()
    expect(found!.type).toBe('NotNull')
  })

  it('collects embedded constraints via buildV2SchemaFile for JSON schema', () => {
    const child = constraintNode({
      id: 'legacy-json-2',
      type: 'notNullConstraint',
    })
    const node = jsonSchemaNode({ children: ['legacy-json-2'] })
    const nodes: CustomNode[] = [node, child]
    const result = buildV2SchemaFile(nodes, 'json-schema-1')
    expect(result.constraints!.length).toBeGreaterThan(0)
    const found = result.constraints!.find((c: any) => c.id === 'legacy-json-2')
    expect(found).toBeDefined()
  })

  it('handles source with absolute_file mode for JSON', () => {
    const node = jsonSchemaNode({
      sourcePathMode: 'absolute_file',
      localPath: '/abs/users.json',
    })
    const result = buildV2JsonSchemaFile(node, [])
    expect(result.source!.mode).toBe('absolute_file')
    expect(result.source!.path).toBe('/abs/users.json')
  })

  it('has no source when file paths missing', () => {
    const node = jsonSchemaNode({ sourceFilePath: undefined, localPath: undefined })
    const result = buildV2JsonSchemaFile(node, [])
    expect(result.source).toBeUndefined()
  })
})
