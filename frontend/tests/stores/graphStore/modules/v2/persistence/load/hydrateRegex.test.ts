import { describe, it, expect } from 'vitest'
import { hydrateRegexNodesFromV2Config } from '@/stores/graphStore/modules/v2/persistence/load/hydrateRegex'
import type { FullConfigV2Response, RegexNodeFileV2 } from '@/types/projectV2'
import type { CustomNode, CustomNodeData } from '@/types/graph'

const baseManifest = {
  version: 2,
  project: { id: 'p', name: 'P' },
  settings: {} as any,
  schemas: [],
  constraints: [],
  regex_nodes: [] as { id: string; path: string }[],
  transforms: [],
  patterns_dir: 'patterns',
}

function makeRegexNodeFile(id: string, overrides: Partial<RegexNodeFileV2> = {}): RegexNodeFileV2 {
  return {
    version: 2,
    id,
    name: 'Regex',
    pattern: '',
    match_mode: 'full',
    enabled: true,
    ...overrides,
  }
}

function makeConfig(overrides: Partial<FullConfigV2Response> = {}): FullConfigV2Response {
  return {
    version: 2,
    project: { id: 'p', name: 'P' },
    schemas: {},
    constraints: {},
    regex_nodes: {},
    transforms: {},
    manifest: baseManifest,
    ...overrides,
  } as FullConfigV2Response
}

describe('hydrateRegexNodesFromV2Config', () => {
  it('creates regexExtract node for match_mode=extract', () => {
    const config = makeConfig({
      regex_nodes: {
        rex1: makeRegexNodeFile('rex1', {
          name: 'ExtractName',
          pattern: '(?P<name>.+)',
          match_mode: 'extract',
          case_sensitive: true,
          flags: 'g',
          capture_groups: [{ name: 'name', group_index: 1 }],
          output_columns: ['name'],
          source_ref: { table_id: 'sch1', column_id: 'col1' },
          source_column_name: 'name',
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'rex1', path: 'regex/rex1.regex.yaml' }],
      },
    })
    const existingNodes: CustomNode[] = [
      {
        id: 'sch1',
        type: 'jsonSchema',
        position: { x: 0, y: 0 },
        data: {
          columns: [{ id: 'col1', columnName: 'name', jsonPath: '$.name' }],
        },
      } as CustomNode,
    ]
    const { nodes, edges } = hydrateRegexNodesFromV2Config({ config, existingNodes })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('regexExtract')
    expect((nodes[0].data as any).sourceRef).toEqual({ nodeId: 'sch1', columnId: 'col1' })
  })

  it('finds jsonSchema as source for regexExtract', () => {
    const config = makeConfig({
      regex_nodes: {
        rex1: makeRegexNodeFile('rex1', {
          name: 'ExtractName',
          pattern: '(?P<name>.+)',
          match_mode: 'extract',
          source_ref: { table_id: 'sch1', column_id: 'col1' },
          source_column_name: 'name',
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'rex1', path: 'regex/rex1.regex.yaml' }],
      },
    })
    const existingNodes: CustomNode[] = [
      {
        id: 'sch1',
        type: 'jsonSchema',
        position: { x: 0, y: 0 },
        data: {
          columns: [{ id: 'col1', columnName: 'name', jsonPath: '$.name' }],
        },
      } as CustomNode,
    ]
    const { edges } = hydrateRegexNodesFromV2Config({ config, existingNodes })
    expect(edges).toHaveLength(1)
    expect(edges[0].targetHandle).toBe('regexExtract-input')
    expect(edges[0].source).toBe('sch1')
  })

  it('returns empty result for empty regex_nodes list', () => {
    const config = makeConfig({
      regex_nodes: {},
      manifest: { ...baseManifest, regex_nodes: [] },
    })
    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('creates a regex node', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', {
          name: 'EmailRegex',
          pattern: '^[\\w]+@[\\w]+\\.[\\w]+$',
          description: 'email validation',
          match_mode: 'full',
          enabled: true,
          case_sensitive: false,
          flags: 'gm',
          rules: [],
          source_ref: { table_id: 's1', column_id: 'col1' },
          source_column_name: 'email',
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })
    const existingNodes: CustomNode[] = [
      {
        id: 's1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          columns: [{ id: 'col1', columnName: 'email' }],
        } as CustomNodeData,
      } as CustomNode,
    ]

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('r1')
    expect(result.nodes[0].type).toBe('regex')
    expect((result.nodes[0].data as any).configName).toBe('EmailRegex')
    expect((result.nodes[0].data as any).pattern).toBe('^[\\w]+@[\\w]+\\.[\\w]+$')
    expect((result.nodes[0].data as any).description).toBe('email validation')
    expect((result.nodes[0].data as any).matchMode).toBe('full')
    expect((result.nodes[0].data as any).enabled).toBe(true)
    expect((result.nodes[0].data as any).caseSensitive).toBe(false)
    expect((result.nodes[0].data as any).flags).toBe('gm')
    expect((result.nodes[0].data as any).saveState).toBe('saved')
  })

  it('creates an edge when sourceRef is present', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', {
          name: 'TestRegex',
          pattern: '\\d+',
          source_ref: { table_id: 's1', column_id: 'col1' },
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })
    const existingNodes: CustomNode[] = [
      {
        id: 's1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          columns: [{ id: 'col1', columnName: 'phone' }],
        } as CustomNodeData,
      } as CustomNode,
    ]

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes })

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('s1')
    expect(result.edges[0].target).toBe('r1')
    expect(result.edges[0].sourceHandle).toBe('source-right-col1')
    expect(result.edges[0].targetHandle).toBe('regex-input')
    expect(result.edges[0].animated).toBe(true)
  })

  it('does not create an edge when sourceRef is absent', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', {
          name: 'TestRegex',
          pattern: '\\d+',
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
  })

  it('skips when regex_nodes map is missing', () => {
    const config = makeConfig({
      regex_nodes: undefined as any,
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(0)
  })

  it('creates a node with defaults when a single regex entry is missing', () => {
    const config = makeConfig({
      regex_nodes: {},
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'missing', path: 'regex/missing.regex.yaml' }],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('missing')
    expect((result.nodes[0].data as any).configName).toBe('Regex')
  })

  it('defaults matchMode to full', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', {
          name: 'R1',
          pattern: '\\w+',
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect((result.nodes[0].data as any).matchMode).toBe('full')
  })

  it('places nodes on a grid layout', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', { name: 'A', pattern: 'a' }),
        r2: makeRegexNodeFile('r2', { name: 'B', pattern: 'b' }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [
          { id: 'r1', path: 'regex/r1.regex.yaml' },
          { id: 'r2', path: 'regex/r2.regex.yaml' },
        ],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes[0].position).toEqual({ x: 980, y: 80 })
    expect(result.nodes[1].position).toEqual({ x: 1400, y: 80 })
  })

  it('still creates an edge based on sourceRef when the source node does not exist', () => {
    const config = makeConfig({
      regex_nodes: {
        r1: makeRegexNodeFile('r1', {
          name: 'R1',
          pattern: '\\d+',
          source_ref: { table_id: 'nonexistent', column_id: 'col1' },
        }),
      },
      manifest: {
        ...baseManifest,
        regex_nodes: [{ id: 'r1', path: 'regex/r1.regex.yaml' }],
      },
    })

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('nonexistent')
  })
})
