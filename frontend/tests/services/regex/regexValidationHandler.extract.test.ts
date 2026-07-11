import { describe, it, expect, vi } from 'vitest'
import { validateRegexNode } from '@/services/regex/regexValidationHandler'
import type { CustomNode } from '@/types/graph'

vi.mock('@/features/regex/services/regexExtractService', () => ({
  validateAndExtractRegex: vi.fn().mockResolvedValue({
    error_count: 0,
    total_rows: 2,
    match_count: 2,
    group_names: ['name'],
    extracted_columns: { name: ['Alice', 'Bob'] },
  }),
}))

describe('validateRegexNode extract path', () => {
  it('invokes extract for regexExtract node', async () => {
    const regexNode: CustomNode = {
      id: 'rex1',
      type: 'regexExtract',
      position: { x: 0, y: 0 },
      data: {
        configName: 'Extract',
        pattern: '(?P<name>.+)',
        flags: '',
        caseSensitive: true,
        enabled: true,
        captureGroups: [],
        outputColumns: [],
        rules: [],
        sourceRef: { nodeId: 'sch1', columnId: 'col1' },
        saveState: 'draft',
      },
    } as CustomNode

    const schemaNode: CustomNode = {
      id: 'sch1',
      type: 'schema',
      position: { x: 0, y: 0 },
      data: {
        configName: 'Schema',
        tableName: 'users',
        sourceFile: 'users.csv',
        sourceNodeId: 'sp1',
        headerRow: 0,
        columns: [{ id: 'col1', columnName: 'full_name', dataType: 'String' }],
        saveState: 'saved',
      },
    } as CustomNode

    const sourcePreview: CustomNode = {
      id: 'sp1',
      type: 'sourcePreview',
      position: { x: 0, y: 0 },
      data: {
        data: [['full_name'], ['Alice'], ['Bob']],
      },
    } as CustomNode

    const updates: Record<string, Record<string, unknown>> = {}
    const result = await validateRegexNode({
      regexNode,
      sourceNode: schemaNode,
      columnName: 'full_name',
      columnId: 'col1',
      nodes: [schemaNode, sourcePreview, regexNode],
      edges: [],
      updateNodeData: (id, data) => {
        updates[id] = { ...updates[id], ...data }
      },
    })

    expect(result).not.toBeNull()
    expect(result?.matchCount).toBe(2)
    expect(updates['rex1']).toBeDefined()
    expect(updates['sch1']).toBeDefined()
    expect(updates['sp1']).toBeDefined()

    const sp1Data = updates['sp1'] as Record<string, unknown>
    expect(sp1Data.data).toEqual([
      ['full_name', 'name'],
      ['Alice', 'Alice'],
      ['Bob', 'Bob'],
    ])

    const sch1Data = updates['sch1'] as Record<string, unknown>
    const columns = sch1Data.columns as Array<Record<string, unknown>>
    const derivedColumn = columns.find((c) => c.columnName === 'name')
    expect(derivedColumn).toBeDefined()
    expect(derivedColumn).toMatchObject({
      id: 'name',
      columnName: 'name',
      dataType: 'String',
      extractedConfig: {
        sourceColumn: 'full_name',
        extractKey: 'name',
        resultType: 'String',
      },
    })
  })
})
