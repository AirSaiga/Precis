import { describe, it, expect, vi } from 'vitest'
import type { CustomNode, SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'

const mockRegistry = vi.hoisted(() => {
  const v2TypeMap: Record<string, string> = {
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
  const constraintTypes = [
    'notNullConstraint', 'uniqueConstraint', 'foreignKeyConstraint',
    'allowedValuesConstraint', 'rangeConstraint', 'conditionalConstraint',
    'scriptedConstraint', 'charsetConstraint', 'dateLogicConstraint',
    'compositeConstraint',
  ]
  return {
    getV2ConstraintTypeByNodeType: (type: string | undefined) => v2TypeMap[type || ''] || '',
    isConstraintNodeType: (type: string | undefined) => constraintTypes.includes(type || ''),
  }
})

vi.mock('@/services/constraints/validationRegistry', () => mockRegistry)

vi.mock('@/services/constraints/constraintExportAdapter', () => ({
  buildConstraintExportPayload: () => ({
    refs: { table_id: 'sc_users', column_id: 'col-email' },
    params: {},
  }),
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
}))

import { buildSchemaIdByNodeId, buildV2Manifest } from '@/services/builders/v2/manifestBuilder'
import { sanitizeV2Id } from '@/services/builders/manifestBuilder'
import { buildV2ProjectView, buildV2FullConfig, buildV2RegexNodeFile, buildV2TransformFile } from '@/services/builders/v2ProjectBuilder'
import { generateSchemaId } from '@/utils/typeHelpers'

function schemaNode(overrides: Record<string, unknown> = {}): CustomNode {
  return {
    id: 'schema-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      tableName: 'users',
      columns: [{ id: 'col-id', columnName: 'id', dataType: 'Integer' }],
      sourceFilePath: '/data/users.csv',
      sheetName: undefined,
      ...overrides,
    },
  } as unknown as CustomNode
}

function jsonSchemaNode(overrides: Record<string, unknown> = {}): CustomNode {
  return {
    id: 'json-1',
    type: 'jsonSchema',
    position: { x: 0, y: 0 },
    data: {
      tableName: 'json_data',
      columns: [{ id: 'col-id', columnName: 'id', dataType: 'number' }],
      sourceFilePath: '/data/data.json',
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
    data: { column: 'col-id', configName: 'test', ...dataOverrides },
  } as unknown as CustomNode
}

describe('manifestBuilder - sanitizeV2Id', () => {
  it('trims whitespace', () => {
    expect(sanitizeV2Id('  my project  ')).toBe('my_project')
  })

  it('replaces spaces with underscores', () => {
    expect(sanitizeV2Id('My Test Project')).toBe('My_Test_Project')
  })

  it('removes unsafe characters', () => {
    expect(sanitizeV2Id('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('returns project for empty input', () => {
    expect(sanitizeV2Id('')).toBe('project')
    expect(sanitizeV2Id('   ')).toBe('')
  })

  it('handles nullish input', () => {
    expect(sanitizeV2Id(null as unknown as string)).toBe('project')
  })
})

describe('v2/manifestBuilder - buildSchemaIdByNodeId', () => {
  it('returns empty map for empty nodes', () => {
    expect(buildSchemaIdByNodeId([])).toEqual({})
  })

  it('maps schema nodes to their schema IDs', () => {
    const nodes: CustomNode[] = [schemaNode()]
    const result = buildSchemaIdByNodeId(nodes)
    const expectedId = generateSchemaId('/data/users.csv', undefined)
    expect(result['schema-1']).toBe(expectedId)
  })

  it('maps jsonSchema nodes', () => {
    const nodes: CustomNode[] = [jsonSchemaNode()]
    const result = buildSchemaIdByNodeId(nodes)
    const expectedId = generateSchemaId('/data/data.json', undefined)
    expect(result['json-1']).toBe(expectedId)
  })

  it('ignores non-schema nodes', () => {
    const nodes: CustomNode[] = [
      schemaNode(),
      constraintNode({ id: 'c1', type: 'notNullConstraint' }),
    ]
    const result = buildSchemaIdByNodeId(nodes)
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['c1']).toBeUndefined()
  })
})

describe('v2/manifestBuilder - buildV2Manifest', () => {
  it('builds basic manifest structure', () => {
    const nodes: CustomNode[] = [schemaNode()]
    const result = buildV2Manifest(nodes, 'TestProj', '/path/to/TestProj')
    expect(result.version).toBe(2)
    expect(result.project.name).toBe('TestProj')
    expect(result.project.id).toBe('TestProj')
  })

  it('sets project ID from path', () => {
    const result = buildV2Manifest([], 'Name', '/some/path/MyProject')
    expect(result.project.id).toBe('MyProject')
  })

  it('includes schema refs', () => {
    const nodes: CustomNode[] = [schemaNode({ tableName: 'users' })]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.schemas).toHaveLength(1)
    expect(result.schemas[0].path).toBe('schemas/users.schema.yaml')
  })

  it('includes jsonSchema refs', () => {
    const nodes: CustomNode[] = [jsonSchemaNode({ tableName: 'json_data' })]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.schemas).toHaveLength(1)
    expect(result.schemas[0].path).toBe('schemas/json_data.schema.yaml')
  })

  it('includes non-embedded constraint refs', () => {
    const nodes: CustomNode[] = [
      constraintNode({ id: 'c1', type: 'notNullConstraint' }),
      constraintNode({ id: 'c2', type: 'notNullConstraint', embedded: true }),
    ]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.constraints).toHaveLength(1)
    expect(result.constraints[0].id).toBe('c1')
  })

  it('includes regex refs', () => {
    const nodes: CustomNode[] = [
      { id: 'r1', type: 'regex', position: { x: 0, y: 0 }, data: {} } as CustomNode,
    ]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.regex_nodes).toHaveLength(1)
    expect(result.regex_nodes[0].id).toBe('r1')
  })

  it('includes transform refs', () => {
    const nodes: CustomNode[] = [
      { id: 't1', type: 'transform', position: { x: 0, y: 0 }, data: {} } as CustomNode,
    ]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.transforms).toHaveLength(1)
    expect(result.transforms[0].id).toBe('t1')
  })

  it('includes template instance refs', () => {
    const nodes: CustomNode[] = [
      {
        id: 'ti-1',
        type: 'templateInstance',
        position: { x: 0, y: 0 },
        data: { templateId: 'tpl-1', inputFromNode: 'schema-1', parameters: { key: 'val' } },
      } as any,
    ]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.template_instances).toBeDefined()
    expect(result.template_instances).toHaveLength(1)
    expect(result.template_instances![0].template_id).toBe('tpl-1')
  })

  it('excludes _expandedFromInstanceId nodes', () => {
    const nodes: CustomNode[] = [
      schemaNode(),
      {
        id: 'expanded-1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: { _expandedFromInstanceId: 'ti-1', tableName: 'hidden' },
      } as any,
    ]
    const result = buildV2Manifest(nodes, 'Proj', '/path')
    expect(result.schemas).toHaveLength(1)
  })

  it('includes settings with defaults', () => {
    const result = buildV2Manifest([], 'Proj', '/path')
    expect(result.settings.validation.auto_validate).toBe(true)
    expect(result.settings.validation.strict_mode).toBe(false)
    expect(result.settings.file_processing.default_encoding).toBe('utf-8')
    expect(result.settings.script_security.sandbox_mode).toBe(true)
  })

  it('uses schemaIdMap when provided', () => {
    const node = schemaNode()
    const result = buildV2Manifest(
      [node],
      'Proj',
      '/path',
      { 'schema-1': 'sc_custom_id' }
    )
    expect(result.schemas[0].id).toBe('sc_custom_id')
  })

  it('excludes template_instances when empty', () => {
    const result = buildV2Manifest([], 'Proj', '/path')
    expect(result.template_instances).toBeUndefined()
  })
})

describe('v2ProjectBuilder - buildV2ProjectView', () => {
  it('builds node position map', () => {
    const nodes: CustomNode[] = [
      { id: 'n1', type: 'regex', position: { x: 100, y: 200 }, data: {} } as any,
      { id: 'n2', type: 'transform', position: { x: 300, y: 400 }, data: {} } as any,
    ]
    const result = buildV2ProjectView(nodes)
    expect(result.version).toBe(1)
    expect(result.nodes['n1']).toEqual({ x: 100, y: 200 })
    expect(result.nodes['n2']).toEqual({ x: 300, y: 400 })
  })
})

describe('v2ProjectBuilder - buildV2FullConfig', () => {
  it('builds full config with manifest, schemas, constraints', () => {
    const nodes: CustomNode[] = [
      schemaNode({ id: 's1', tableName: 'users' }),
      constraintNode({ id: 'c1', type: 'notNullConstraint' }),
    ]
    const result = buildV2FullConfig(nodes, 'Test', '/path')
    expect(result.manifest).toBeDefined()
    expect(result.manifest.project.name).toBe('Test')
    expect(result.schemas).toBeDefined()
    expect(Object.keys(result.schemas).length).toBeGreaterThan(0)
    expect(result.constraints).toBeDefined()
    expect(Object.keys(result.constraints).length).toBeGreaterThan(0)
  })

  it('handles empty nodes', () => {
    const result = buildV2FullConfig([], 'Empty', '/path')
    expect(result.manifest.version).toBe(2)
    expect(Object.keys(result.schemas)).toHaveLength(0)
    expect(Object.keys(result.constraints)).toHaveLength(0)
  })
})

describe('v2ProjectBuilder - buildV2RegexNodeFile', () => {
  it('builds regex file with pattern', () => {
    const nodes: CustomNode[] = [
      {
        id: 'r1',
        type: 'regex',
        position: { x: 0, y: 0 },
        data: {
          configName: 'Email Regex',
          pattern: '\\S+@\\S+',
          matchMode: 'full',
          caseSensitive: true,
          enabled: true,
          rules: [],
          parameters: [],
        },
      } as any,
    ]
    const result = buildV2RegexNodeFile(nodes, 'r1')
    expect(result.version).toBe(2)
    expect(result.id).toBe('r1')
    expect(result.pattern).toBe('\\S+@\\S+')
    expect(result.match_mode).toBe('full')
    expect(result.case_sensitive).toBe(true)
  })

  it('throws when regex node not found', () => {
    expect(() => buildV2RegexNodeFile([], 'nonexistent')).toThrow()
  })
})

describe('v2ProjectBuilder - buildV2TransformFile', () => {
  it('builds transform file', () => {
    const nodes: CustomNode[] = [
      {
        id: 't1',
        type: 'transform',
        position: { x: 0, y: 0 },
        data: {
          transformType: 'rename',
          description: 'Rename column',
          enabled: true,
          params: { from: 'old', to: 'new' },
          outputColumns: [],
        },
      } as any,
    ]
    const result = buildV2TransformFile(nodes, 't1')
    expect(result.version).toBe(2)
    expect(result.id).toBe('t1')
    expect(result.type).toBe('rename')
    expect(result.params).toEqual({ from: 'old', to: 'new' })
  })

  it('throws when transform node not found', () => {
    expect(() => buildV2TransformFile([], 'nonexistent')).toThrow()
  })
})
