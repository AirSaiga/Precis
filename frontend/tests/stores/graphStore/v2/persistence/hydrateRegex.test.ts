import { describe, it, expect, vi } from 'vitest'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { hydrateRegexNodesFromV2Config } from '@/stores/graphStore/modules/v2/persistence/load/hydrateRegex'

describe('hydrateRegexNodesFromV2Config', () => {
  it('空 regex_nodes 列表返回空结果', () => {
    const config = { manifest: { regex_nodes: [] }, regex_nodes: {} }
    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('创建 Regex 节点', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
      regex_nodes: {
        r1: {
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
        },
      },
    }
    const existingNodes: CustomNode[] = [
      {
        id: 's1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: { tableName: 'users', columns: [{ id: 'col1', columnName: 'email' }] } as CustomNodeData,
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

  it('有 sourceRef 时创建边', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
      regex_nodes: {
        r1: {
          name: 'TestRegex',
          pattern: '\\d+',
          source_ref: { table_id: 's1', column_id: 'col1' },
        },
      },
    }
    const existingNodes: CustomNode[] = [
      {
        id: 's1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: { tableName: 'users', columns: [{ id: 'col1', columnName: 'phone' }] } as CustomNodeData,
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

  it('无 sourceRef 时不创建边', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
      regex_nodes: {
        r1: { name: 'TestRegex', pattern: '\\d+' },
      },
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
  })

  it('缺失 regex_nodes map 时跳过', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(0)
  })

  it('缺失单个 regex 时仍创建节点（使用默认值）', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'missing' }] },
      regex_nodes: {},
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('missing')
    expect((result.nodes[0].data as any).configName).toBe('Regex')
  })

  it('默认 matchMode 为 full', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
      regex_nodes: {
        r1: { name: 'R1', pattern: '\\w+' },
      },
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect((result.nodes[0].data as any).matchMode).toBe('full')
  })

  it('网格布局位置', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }, { id: 'r2' }] },
      regex_nodes: {
        r1: { name: 'A', pattern: 'a' },
        r2: { name: 'B', pattern: 'b' },
      },
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes[0].position).toEqual({ x: 980, y: 80 })
    expect(result.nodes[1].position).toEqual({ x: 1400, y: 80 })
  })

  it('源节点不存在时仍创建边（基于 sourceRef）', () => {
    const config = {
      manifest: { regex_nodes: [{ id: 'r1' }] },
      regex_nodes: {
        r1: {
          name: 'R1',
          pattern: '\\d+',
          source_ref: { table_id: 'nonexistent', column_id: 'col1' },
        },
      },
    }

    const result = hydrateRegexNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('nonexistent')
  })
})
